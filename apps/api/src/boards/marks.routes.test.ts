import type { FastifyInstance } from 'fastify';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { enroll, giveBaseline, seedBoard, seedProgram, type SeededBoard, type SeededProgram } from '../../test-support/seed-program.ts';
import { createSeeder } from '../../test-support/seed.ts';
import { createSignedInApp, TEST_PUBLIC_URL } from '../../test-support/signed-in-app.ts';

type Method = 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';

describe('marks on the capabilities of a board', () => {
  let ownerPool: pg.Pool;
  let appPool: pg.Pool;
  let app: FastifyInstance;
  let program: SeededProgram;
  let board: SeededBoard;
  let sessions: Record<'owner' | 'leader' | 'programLeader' | 'otherParticipant', string>;
  let experimentId: string;
  let signInAs: (email: string) => Promise<string>;
  const emailOf = async (personId: string) =>
    (await ownerPool.query<{ email: string }>('select email from persons where id = $1', [personId])).rows[0]!.email;

  const call = (session: string, method: Method, url: string, body?: unknown, boardId = board.boardId) =>
    app.inject({
      method,
      url: `/api/boards/${boardId}${url}`,
      cookies: { session },
      headers: method === 'GET' ? {} : { origin: TEST_PUBLIC_URL.origin },
      ...(body === undefined ? {} : { payload: body as Record<string, unknown> }),
    });
  const view = async (session: string, boardId = board.boardId) => (await call(session, 'GET', '', undefined, boardId)).json();
  const mark = (session: string, method: 'PUT' | 'DELETE', capability: number, name: string, boardId = board.boardId) =>
    call(session, method, `/capabilities/${program.capabilityIds[capability]}/marks/${name}`, undefined, boardId);
  const marksOf = async (session: string, boardId = board.boardId) =>
    (await view(session, boardId)).placements.map((placement: { marks: string[] }) => placement.marks);

  beforeAll(async () => {
    ownerPool = new pg.Pool({ connectionString: inject('ownerDatabaseUrl') });
    appPool = new pg.Pool({ connectionString: inject('appDatabaseUrl') });
    const signedIn = createSignedInApp(appPool);
    app = signedIn.app;
    signInAs = signedIn.signInAs;
    const seed = createSeeder(ownerPool);
    const organization = await seed.organization();
    program = await seedProgram(ownerPool, organization);
    board = await seedBoard(ownerPool, program, (organizationId) => seed.person(organizationId));
    await ownerPool.query('update placements set level_id = $1 where board_id = $2', [program.levelIds[0], board.boardId]);
    await giveBaseline(ownerPool, board.boardId, 'calibrated');
    // A leader of the program, off this panel: reads the board only.
    const programLeader = await seed.person(organization);
    await enroll(ownerPool, program, programLeader, 'leader');
    sessions = {
      owner: await signedIn.signInAs(await emailOf(board.owner)),
      leader: await signedIn.signInAs(await emailOf(board.leader)),
      programLeader: await signedIn.signInAs(await emailOf(programLeader)),
      otherParticipant: await signedIn.signInAs(await emailOf(board.otherParticipant)),
    };
  });

  afterAll(async () => {
    await app.close();
    await appPool.end();
    await ownerPool.end();
  });

  it('lets the owner and the panel put marks that every reader of the board sees', async () => {
    expect((await view(sessions.owner)).viewer.canMark).toBe(true);
    expect((await view(sessions.leader)).viewer.canMark).toBe(true);
    expect((await view(sessions.programLeader)).viewer.canMark).toBe(false);
    expect(await marksOf(sessions.owner)).toEqual([[], []]);

    expect((await mark(sessions.owner, 'PUT', 0, 'wip')).statusCode).toBe(204);
    expect((await mark(sessions.leader, 'PUT', 0, 'candidate')).statusCode).toBe(204);
    expect((await mark(sessions.owner, 'PUT', 1, 'candidate')).statusCode).toBe(204);
    // Putting a mark twice changes nothing.
    expect((await mark(sessions.leader, 'PUT', 1, 'candidate')).statusCode).toBe(204);

    // In catalog order, whatever order they were put in.
    expect(await marksOf(sessions.owner)).toEqual([['candidate', 'wip'], ['candidate']]);
    expect(await marksOf(sessions.programLeader)).toEqual([['candidate', 'wip'], ['candidate']]);
  });

  it('refuses unknown marks, capabilities off the board and people who do not work on it', async () => {
    expect((await mark(sessions.owner, 'PUT', 0, 'urgent')).statusCode).toBe(400);
    const offBoard = await mark(sessions.owner, 'PUT', 2, 'candidate');
    expect(offBoard.statusCode).toBe(404);
    const reader = await mark(sessions.programLeader, 'PUT', 1, 'wip');
    expect([reader.statusCode, reader.json()]).toEqual([403, { error: 'forbidden' }]);
    expect((await mark(sessions.programLeader, 'DELETE', 0, 'candidate')).statusCode).toBe(403);
    expect((await mark(sessions.otherParticipant, 'PUT', 1, 'wip')).statusCode).toBe(404);
    expect(await marksOf(sessions.owner)).toEqual([['candidate', 'wip'], ['candidate']]);
  });

  it('takes marks off, keeping WIP while an experiment on the capability is in progress', async () => {
    const cycleId = (await call(sessions.owner, 'POST', '/cycles', { startsOn: '2026-12-01', endsOn: '2027-02-28' })).json().cycleId;
    const focusId = (
      await call(sessions.owner, 'POST', `/cycles/${cycleId}/focuses`, {
        capabilityId: program.capabilityIds[0],
        targetLevelId: program.levelIds[1],
      })
    ).json().focusId;
    experimentId = (
      await call(sessions.owner, 'POST', `/cycles/${cycleId}/focuses/${focusId}/experiments`, {
        description: 'Facilitar la revisión del sprint con datos de uso',
      })
    ).json().experimentId;
    // A second focus, on a capability marked only as a candidate.
    const otherFocusId = (
      await call(sessions.owner, 'POST', `/cycles/${cycleId}/focuses`, {
        capabilityId: program.capabilityIds[1],
        targetLevelId: program.levelIds[1],
      })
    ).json().focusId;
    const otherExperimentId = (
      await call(sessions.owner, 'POST', `/cycles/${cycleId}/focuses/${otherFocusId}/experiments`, {
        description: 'Escribir el resumen semanal del producto',
      })
    ).json().experimentId;
    expect((await call(sessions.leader, 'POST', `/cycles/${cycleId}/start`)).statusCode).toBe(200);
    expect((await call(sessions.owner, 'PATCH', `/experiments/${otherExperimentId}`, { state: 'in_progress' })).statusCode).toBe(200);

    // Planned, not in progress yet: WIP comes off and goes back on.
    expect((await mark(sessions.owner, 'DELETE', 0, 'wip')).statusCode).toBe(204);
    expect((await mark(sessions.owner, 'PUT', 0, 'wip')).statusCode).toBe(204);

    expect((await call(sessions.owner, 'PATCH', `/experiments/${experimentId}`, { state: 'in_progress' })).statusCode).toBe(200);
    for (const session of [sessions.owner, sessions.leader]) {
      const refused = await mark(session, 'DELETE', 0, 'wip');
      expect([refused.statusCode, refused.json()]).toEqual([409, { error: 'wip_in_progress' }]);
    }
    // The database keeps the rule too, whatever the caller.
    await expect(
      ownerPool.query("delete from placement_marks where board_id = $1 and capability_id = $2 and mark = 'wip'", [
        board.boardId,
        program.capabilityIds[0],
      ]),
    ).rejects.toMatchObject({ code: 'PM050' });
    // Taking off a WIP mark that is not there changes nothing, even with an experiment in progress.
    expect((await mark(sessions.owner, 'DELETE', 1, 'wip')).statusCode).toBe(204);
    // Other marks come off at any time.
    expect((await mark(sessions.owner, 'DELETE', 0, 'candidate')).statusCode).toBe(204);
    // Taking off a mark that is not there changes nothing.
    expect((await mark(sessions.owner, 'DELETE', 0, 'candidate')).statusCode).toBe(204);
    expect(await marksOf(sessions.owner)).toEqual([['wip'], ['candidate']]);

    const reviewed = await call(sessions.leader, 'PATCH', `/experiments/${experimentId}`, {
      state: 'reviewed',
      result: 'consolidated',
      learnings: 'Mostrar datos antes de opinar cambió la conversación',
    });
    expect(reviewed.statusCode).toBe(200);
    expect((await mark(sessions.leader, 'DELETE', 0, 'wip')).statusCode).toBe(204);
    expect(await marksOf(sessions.owner)).toEqual([[], ['candidate']]);
  });

  it('keeps the marks of a closed board as they are', async () => {
    await ownerPool.query("update boards set status = 'closed' where id = $1", [board.boardId]);
    expect((await view(sessions.leader)).viewer.canMark).toBe(false);
    const refused = await mark(sessions.leader, 'PUT', 0, 'wip');
    expect([refused.statusCode, refused.json()]).toEqual([409, { error: 'board_closed' }]);
    expect((await mark(sessions.owner, 'DELETE', 1, 'candidate')).json()).toEqual({ error: 'board_closed' });
    expect(await marksOf(sessions.owner)).toEqual([[], ['candidate']]);
  });

  it('takes the marks off with the capability before the baseline', async () => {
    const seed = createSeeder(ownerPool);
    const fresh = await seedBoard(ownerPool, program, (organizationId) => seed.person(organizationId));
    const leader = await signInAs(await emailOf(fresh.leader));
    expect((await mark(leader, 'PUT', 1, 'candidate', fresh.boardId)).statusCode).toBe(204);
    const removed = await call(leader, 'DELETE', `/capabilities/${program.capabilityIds[1]}`, undefined, fresh.boardId);
    expect(removed.statusCode).toBe(204);
    await call(leader, 'POST', '/capabilities', { capabilityId: program.capabilityIds[1] }, fresh.boardId);
    expect(await marksOf(leader, fresh.boardId)).toEqual([[], []]);
  });
});
