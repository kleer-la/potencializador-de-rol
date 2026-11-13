import type { FastifyInstance } from 'fastify';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { seedBoard, seedProgram, type SeededBoard, type SeededProgram } from '../../test-support/seed-program.ts';
import { createSeeder } from '../../test-support/seed.ts';
import { createSignedInApp, TEST_PUBLIC_URL } from '../../test-support/signed-in-app.ts';

type Method = 'GET' | 'PUT' | 'POST';

describe('self-assessment', () => {
  let ownerPool: pg.Pool;
  let appPool: pg.Pool;
  let app: FastifyInstance;
  let program: SeededProgram;
  let board: SeededBoard;
  let sessions: Record<'owner' | 'leader' | 'otherParticipant', string>;

  const call = (session: string, method: Method, url: string, body?: unknown) =>
    app.inject({
      method,
      url: `/api/boards/${board.boardId}${url}`,
      cookies: { session },
      headers: method === 'GET' ? {} : { origin: TEST_PUBLIC_URL.origin },
      ...(body === undefined ? {} : { payload: body as Record<string, unknown> }),
    });
  const save = (session: string, levels: { capabilityId: string; levelId: string }[]) =>
    call(session, 'PUT', '/self-assessment', { levels });
  const view = async (session: string) => (await call(session, 'GET', '')).json();

  beforeAll(async () => {
    ownerPool = new pg.Pool({ connectionString: inject('ownerDatabaseUrl') });
    appPool = new pg.Pool({ connectionString: inject('appDatabaseUrl') });
    const signedIn = createSignedInApp(appPool);
    app = signedIn.app;
    const seed = createSeeder(ownerPool);
    program = await seedProgram(ownerPool, await seed.organization());
    board = await seedBoard(ownerPool, program, (organizationId) => seed.person(organizationId));
    const emailOf = async (personId: string) =>
      (await ownerPool.query<{ email: string }>('select email from persons where id = $1', [personId])).rows[0]!.email;
    sessions = {
      owner: await signedIn.signInAs(await emailOf(board.owner)),
      leader: await signedIn.signInAs(await emailOf(board.leader)),
      otherParticipant: await signedIn.signInAs(await emailOf(board.otherParticipant)),
    };
  });

  afterAll(async () => {
    await app.close();
    await appPool.end();
    await ownerPool.end();
  });

  it('starts empty for the owner, who may write it', async () => {
    const board_ = await view(sessions.owner);

    expect(board_.selfAssessment).toEqual({ submittedAt: null, levels: [] });
    expect(board_.viewer.canSelfAssess).toBe(true);
  });

  it('saves a draft the owner can change, and the panel does not see it', async () => {
    const [first, second] = program.capabilityIds;
    await save(sessions.owner, [{ capabilityId: first!, levelId: program.levelIds[1]! }]);
    const changed = await save(sessions.owner, [
      { capabilityId: first!, levelId: program.levelIds[0]! },
      { capabilityId: second!, levelId: program.levelIds[1]! },
    ]);
    const byOwner = await view(sessions.owner);
    const byLeader = await view(sessions.leader);

    expect(changed.statusCode, changed.body).toBe(200);
    expect(byOwner.selfAssessment.levels).toEqual([
      { capabilityId: first, levelId: program.levelIds[0] },
      { capabilityId: second, levelId: program.levelIds[1] },
    ]);
    expect(byLeader.selfAssessment).toBeNull();
    expect(byLeader.viewer.canSelfAssess).toBe(false);
  });

  it('refuses a draft from the panel, a level off the scale and a capability off the board', async () => {
    const byLeader = await save(sessions.leader, [{ capabilityId: program.capabilityIds[0]!, levelId: program.levelIds[0]! }]);
    const offBoard = await save(sessions.owner, [{ capabilityId: program.capabilityIds[2]!, levelId: program.levelIds[0]! }]);
    const byStranger = await save(sessions.otherParticipant, []);

    expect([byLeader.statusCode, offBoard.statusCode, byStranger.statusCode]).toEqual([403, 400, 404]);
    expect(offBoard.json()).toEqual({ error: 'unknown_reference' });
    expect((await view(sessions.owner)).selfAssessment.levels).toHaveLength(2);
  });

  it('names the capabilities still missing a level before it can be submitted', async () => {
    await save(sessions.owner, [{ capabilityId: program.capabilityIds[0]!, levelId: program.levelIds[0]! }]);

    const response = await call(sessions.owner, 'POST', '/self-assessment/submit');

    expect(response.statusCode).toBe(422);
    expect(response.json()).toEqual({ error: 'incomplete', missing: [program.capabilityIds[1]] });
  });

  it('INV-2 submits once: the board becomes self-assessed, placements and score stay untouched', async () => {
    await save(sessions.owner, [
      { capabilityId: program.capabilityIds[0]!, levelId: program.levelIds[0]! },
      { capabilityId: program.capabilityIds[1]!, levelId: program.levelIds[1]! },
    ]);

    const submitted = await call(sessions.owner, 'POST', '/self-assessment/submit');
    const again = await call(sessions.owner, 'POST', '/self-assessment/submit');
    const changeAfter = await save(sessions.owner, []);
    const byOwner = await view(sessions.owner);

    expect([submitted.statusCode, again.statusCode, changeAfter.statusCode]).toEqual([200, 409, 409]);
    expect(again.json()).toEqual({ error: 'already_submitted' });
    expect(byOwner.status).toBe('self_assessed');
    expect(byOwner.selfAssessment.submittedAt).toEqual(expect.any(String));
    expect(byOwner.placements.every((placement: { levelId: string | null }) => placement.levelId === null)).toBe(true);
    expect(JSON.stringify(byOwner)).not.toMatch(/score|puntaje/i);
  });

  it('INV-9 shows the submitted self-assessment to the panel, and to nobody else', async () => {
    const byLeader = await view(sessions.leader);
    const byStranger = await call(sessions.otherParticipant, 'GET', '');

    expect(byLeader.selfAssessment.levels).toHaveLength(2);
    expect(byStranger.statusCode).toBe(404);
  });
});
