import type { FastifyInstance } from 'fastify';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { giveBaseline, seedBoard, seedProgram, type SeededBoard, type SeededProgram } from '../../test-support/seed-program.ts';
import { createSeeder } from '../../test-support/seed.ts';
import { createSignedInApp, TEST_PUBLIC_URL } from '../../test-support/signed-in-app.ts';

type Method = 'GET' | 'POST';

describe('score, evolution, closing and recalibration', () => {
  let ownerPool: pg.Pool;
  let appPool: pg.Pool;
  let app: FastifyInstance;
  let organizationId: string;
  let program: SeededProgram;
  let board: SeededBoard;
  let sessions: Record<'owner' | 'leader' | 'administrator', string>;
  let cycleId: string;

  const call = (session: string, method: Method, url: string, body?: unknown) =>
    app.inject({
      method,
      url: `/api/boards/${board.boardId}${url}`,
      cookies: { session },
      headers: method === 'GET' ? {} : { origin: TEST_PUBLIC_URL.origin },
      ...(body === undefined ? {} : { payload: body as Record<string, unknown> }),
    });
  const view = async (session: string) => (await call(session, 'GET', '')).json();
  const points = async () =>
    (await view(sessions.owner)).evolution.map((point: { kind: string; total: number; change: number | null }) => [
      point.kind,
      point.total,
      point.change,
    ]);
  const recalibrate = (session: string, attendees: string[]) =>
    call(session, 'POST', '/recalibration', {
      heldOn: '2027-03-05',
      notes: 'Revisión del trimestre',
      attendees,
      levels: [
        { capabilityId: program.capabilityIds[0], levelId: program.levelIds[0] },
        { capabilityId: program.capabilityIds[1], levelId: program.levelIds[1] },
      ],
    });

  beforeAll(async () => {
    ownerPool = new pg.Pool({ connectionString: inject('ownerDatabaseUrl') });
    appPool = new pg.Pool({ connectionString: inject('appDatabaseUrl') });
    const signedIn = createSignedInApp(appPool);
    app = signedIn.app;
    const seed = createSeeder(ownerPool);
    organizationId = await seed.organization();
    program = await seedProgram(ownerPool, organizationId);
    await ownerPool.query("update programs set mandatory_panel_roles = '{leader}' where id = $1", [program.programId]);
    board = await seedBoard(ownerPool, program, (organization) => seed.person(organization));
    const administrator = await seed.person(organizationId);
    await seed.membership(organizationId, administrator, 'administrator');
    const emailOf = async (personId: string) =>
      (await ownerPool.query<{ email: string }>('select email from persons where id = $1', [personId])).rows[0]!.email;
    sessions = {
      owner: await signedIn.signInAs(await emailOf(board.owner)),
      leader: await signedIn.signInAs(await emailOf(board.leader)),
      administrator: await signedIn.signInAs(await emailOf(administrator)),
    };
  });

  afterAll(async () => {
    await app.close();
    await appPool.end();
    await ownerPool.end();
  });

  it('shows no score before the baseline, then the score, its breakdowns and its evolution', async () => {
    const before = await view(sessions.owner);
    expect([before.score, before.evolution]).toEqual([null, []]);

    await ownerPool.query('update placements set level_id = $1 where board_id = $2', [program.levelIds[0], board.boardId]);
    await giveBaseline(ownerPool, board.boardId, 'calibrated');
    await ownerPool.query(
      "insert into baseline_entries (organization_id, board_id, capability_id, level_id, origin) select organization_id, board_id, capability_id, level_id, 'calibration' from placements where board_id = $1",
      [board.boardId],
    );

    const owned = await view(sessions.owner);
    expect(owned.score).toMatchObject({ total: 0, maximum: 2, capabilities: 2 });
    expect(owned.score.byDimension).toEqual([{ dimensionId: expect.any(String), total: 0, maximum: 2, capabilities: 2 }]);
    expect(owned.score.byDifficulty).toEqual([{ difficulty: null, total: 0, maximum: 2, capabilities: 2 }]);
    expect(await points()).toEqual([
      ['baseline', 0, null],
      ['today', 0, 0],
    ]);
  });

  it('closes the active cycle for the panel and adds its snapshot to the evolution', async () => {
    cycleId = (await call(sessions.owner, 'POST', '/cycles', { startsOn: '2026-12-01', endsOn: '2027-02-28' })).json().cycleId;
    const focusId = (
      await call(sessions.owner, 'POST', `/cycles/${cycleId}/focuses`, {
        capabilityId: program.capabilityIds[0],
        targetLevelId: program.levelIds[1],
      })
    ).json().focusId;
    await call(sessions.owner, 'POST', `/cycles/${cycleId}/focuses/${focusId}/experiments`, { description: 'Probar' });
    await call(sessions.leader, 'POST', `/cycles/${cycleId}/start`);
    const evidenceId = (await call(sessions.owner, 'POST', '/evidence', { description: 'Lo logró', occurredOn: '2027-01-10' })).json()
      .evidenceId;
    const proposalId = (
      await call(sessions.owner, 'POST', '/level-proposals', {
        capabilityId: program.capabilityIds[0],
        levelId: program.levelIds[1],
        evidenceIds: [evidenceId],
      })
    ).json().proposalId;
    await call(sessions.leader, 'POST', `/level-proposals/${proposalId}/decision`, { approve: true });

    expect((await view(sessions.leader)).viewer.canCloseCycle).toBe(true);
    expect((await call(sessions.owner, 'POST', `/cycles/${cycleId}/close`)).statusCode).toBe(403);
    expect((await call(sessions.leader, 'POST', `/cycles/${cycleId}/close`)).statusCode).toBe(200);
    expect((await call(sessions.leader, 'POST', `/cycles/${cycleId}/close`)).json()).toEqual({ error: 'cycle_not_active' });

    expect((await view(sessions.owner)).status).toBe('between_cycles');
    expect(await points()).toEqual([
      ['baseline', 0, null],
      ['cycle_close', 1, 1],
      ['today', 1, 0],
    ]);
  });

  it('recalibrates between cycles with the attendance of the calibration, once', async () => {
    const absent = await recalibrate(sessions.leader, [board.owner]);
    expect([absent.statusCode, absent.json()]).toEqual([422, { error: 'attendance', participantMissing: false, missingRoles: ['leader'] }]);
    expect((await recalibrate(sessions.owner, [board.owner, board.leader])).statusCode).toBe(403);

    expect((await recalibrate(sessions.leader, [board.owner, board.leader])).statusCode).toBe(201);
    expect((await recalibrate(sessions.leader, [board.owner, board.leader])).json()).toEqual({ error: 'already_recalibrated' });

    const owned = await view(sessions.owner);
    expect(owned.recalibrations).toEqual([
      {
        id: expect.any(String),
        heldOn: '2027-03-05',
        notes: 'Revisión del trimestre',
        attendees: expect.arrayContaining([expect.objectContaining({ personId: board.owner })]),
      },
    ]);
    expect(await points()).toEqual([
      ['baseline', 0, null],
      ['cycle_close', 1, 1],
      ['recalibration', 1, 0],
      ['today', 1, 0],
    ]);
  });

  it('closes the board for the panel; afterwards it only answers board_closed to changes', async () => {
    expect((await call(sessions.owner, 'POST', '/close')).statusCode).toBe(403);
    expect((await call(sessions.leader, 'POST', '/close')).statusCode).toBe(200);

    const led = await view(sessions.leader);
    expect(led.status).toBe('closed');
    expect(led.viewer).toMatchObject({ canCloseBoard: false, canRecordEvidence: false, canPlanCycle: false, canAdd: false });
    expect((await call(sessions.owner, 'POST', '/evidence', { description: 'x', occurredOn: '2027-04-01' })).json()).toEqual({
      error: 'board_closed',
    });
    expect((await call(sessions.leader, 'POST', '/capabilities', { capabilityId: program.capabilityIds[2] })).json()).toEqual({
      error: 'board_closed',
    });
    expect((await view(sessions.owner)).score).toMatchObject({ total: 1 });
  });

  it('INV-9 lists of boards and program views carry no score', async () => {
    const mine = await app.inject({ method: 'GET', url: '/api/boards', cookies: { session: sessions.owner } });
    const detail = await app.inject({
      method: 'GET',
      url: `/api/organizations/${organizationId}/programs/${program.programId}`,
      cookies: { session: sessions.administrator },
    });

    expect(mine.statusCode).toBe(200);
    expect(detail.statusCode).toBe(200);
    for (const body of [mine.body, detail.body]) {
      expect(body).not.toMatch(/score|evolution|puntaje/i);
    }
  });
});
