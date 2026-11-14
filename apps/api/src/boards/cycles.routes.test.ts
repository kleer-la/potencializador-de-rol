import type { FastifyInstance } from 'fastify';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { seedMap } from '../../test-support/seed-map.ts';
import { giveBaseline, seedBoard, seedProgram, type SeededBoard, type SeededProgram } from '../../test-support/seed-program.ts';
import { createSeeder } from '../../test-support/seed.ts';
import { createSignedInApp, TEST_PUBLIC_URL } from '../../test-support/signed-in-app.ts';

type Method = 'GET' | 'POST' | 'PATCH' | 'DELETE';

describe('cycles, focuses and experiments', () => {
  let ownerPool: pg.Pool;
  let appPool: pg.Pool;
  let app: FastifyInstance;
  let program: SeededProgram;
  let board: SeededBoard;
  let sessions: Record<'owner' | 'leader' | 'otherParticipant' | 'administrator', string>;
  let cycleId: string;
  const focusOf: Record<string, string> = {};
  const experiments: string[] = [];

  const call = (session: string, method: Method, url: string, body?: unknown) =>
    app.inject({
      method,
      url: `/api/boards/${board.boardId}${url}`,
      cookies: { session },
      headers: method === 'GET' ? {} : { origin: TEST_PUBLIC_URL.origin },
      ...(body === undefined ? {} : { payload: body as Record<string, unknown> }),
    });
  const view = async (session: string) => (await call(session, 'GET', '')).json();
  const focus = (session: string, capability: number, level: number) =>
    call(session, 'POST', `/cycles/${cycleId}/focuses`, {
      capabilityId: program.capabilityIds[capability],
      targetLevelId: program.levelIds[level],
    });
  const experiment = (session: string, focusId: string) =>
    call(session, 'POST', `/cycles/${cycleId}/focuses/${focusId}/experiments`, {
      description: 'Facilitar la revisión del sprint con datos de uso',
      expectedResult: 'El equipo decide qué sigue con evidencia',
    });

  beforeAll(async () => {
    ownerPool = new pg.Pool({ connectionString: inject('ownerDatabaseUrl') });
    appPool = new pg.Pool({ connectionString: inject('appDatabaseUrl') });
    const signedIn = createSignedInApp(appPool);
    app = signedIn.app;
    const seed = createSeeder(ownerPool);
    const organization = await seed.organization();
    program = await seedProgram(ownerPool, organization);
    await ownerPool.query('update programs set max_focuses = 2 where id = $1', [program.programId]);
    board = await seedBoard(ownerPool, program, (organizationId) => seed.person(organizationId));
    await ownerPool.query('update placements set level_id = $1 where board_id = $2', [program.levelIds[0], board.boardId]);
    const administrator = await seed.person(organization);
    await seed.membership(organization, administrator, 'administrator');
    const emailOf = async (personId: string) =>
      (await ownerPool.query<{ email: string }>('select email from persons where id = $1', [personId])).rows[0]!.email;
    sessions = {
      owner: await signedIn.signInAs(await emailOf(board.owner)),
      leader: await signedIn.signInAs(await emailOf(board.leader)),
      otherParticipant: await signedIn.signInAs(await emailOf(board.otherParticipant)),
      administrator: await signedIn.signInAs(await emailOf(administrator)),
    };
  });

  afterAll(async () => {
    await app.close();
    await appPool.end();
    await ownerPool.end();
  });

  it('opens a cycle only after the baseline, one at a time', async () => {
    const before = await view(sessions.owner);
    expect(before.cycle).toBeNull();
    expect(before.viewer.canPlanCycle).toBe(false);
    const dates = { startsOn: '2026-12-01', endsOn: '2027-02-28' };
    expect((await call(sessions.owner, 'POST', '/cycles', dates)).json()).toEqual({ error: 'no_baseline' });

    await giveBaseline(ownerPool, board.boardId, 'calibrated');
    expect((await call(sessions.owner, 'POST', '/cycles', { startsOn: '2027-02-28', endsOn: '2026-12-01' })).json()).toEqual({
      error: 'invalid_request',
    });
    const created = await call(sessions.owner, 'POST', '/cycles', dates);
    expect(created.statusCode).toBe(201);
    cycleId = created.json().cycleId;

    const owned = await view(sessions.owner);
    expect(owned.viewer).toMatchObject({ canPlanCycle: true, canStartCycle: false, canReviewExperiments: false });
    expect(owned.cycle).toEqual({
      id: cycleId,
      number: 1,
      startsOn: '2026-12-01',
      endsOn: '2027-02-28',
      state: 'planned',
      startedAt: null,
      maxFocuses: 2,
      focuses: [],
    });
    expect((await call(sessions.leader, 'POST', '/cycles', dates)).json()).toEqual({ error: 'cycle_open' });
    expect((await call(sessions.otherParticipant, 'POST', '/cycles', dates)).statusCode).toBe(404);
  });

  it('INV-8 takes focuses above the current level, up to the program maximum', async () => {
    const first = await focus(sessions.owner, 0, 1);
    expect(first.statusCode).toBe(201);
    focusOf[0] = first.json().focusId;
    expect((await focus(sessions.owner, 1, 0)).json()).toEqual({ error: 'invalid_target' });
    expect((await focus(sessions.owner, 2, 1)).json()).toEqual({ error: 'invalid_target' });
    expect((await focus(sessions.leader, 0, 1)).json()).toEqual({ error: 'already_focus' });
    focusOf[1] = (await focus(sessions.leader, 1, 1)).json().focusId;

    // A third capability joins the board after the baseline and gets its initial level.
    await call(sessions.leader, 'POST', '/capabilities', { capabilityId: program.capabilityIds[2] });
    await call(sessions.leader, 'POST', '/initial-levels', { capabilityId: program.capabilityIds[2], levelId: program.levelIds[0] });
    const third = await focus(sessions.leader, 2, 1);
    expect([third.statusCode, third.json()]).toEqual([422, { error: 'too_many_focuses', maxFocuses: 2 }]);
    expect((await focus(sessions.leader, 0, 1)).json()).toEqual({ error: 'already_focus' });
    const other = await seedMap(ownerPool, program.organizationId, 'published');
    const foreignLevel = await call(sessions.owner, 'POST', `/cycles/${cycleId}/focuses`, {
      capabilityId: program.capabilityIds[2],
      targetLevelId: other.levelId,
    });
    expect(foreignLevel.json()).toEqual({ error: 'invalid_target' });
    expect((await call(sessions.owner, 'DELETE', `/cycles/${cycleId}/focuses/${cycleId}`)).statusCode).toBe(404);

    expect((await call(sessions.owner, 'DELETE', `/cycles/${cycleId}/focuses/${focusOf[1]}`)).statusCode).toBe(204);
    focusOf[1] = (await focus(sessions.owner, 1, 1)).json().focusId;
    const focuses = (await view(sessions.leader)).cycle.focuses;
    expect(focuses.map((item: { capabilityId: string }) => item.capabilityId)).toEqual(program.capabilityIds.slice(0, 2));
    expect(focuses[0]).toEqual({ id: focusOf[0], capabilityId: program.capabilityIds[0], targetLevelId: program.levelIds[1], experiments: [] });
  });

  it('INV-8 starts by the panel once every focus has an experiment, naming what is missing', async () => {
    expect((await call(sessions.owner, 'POST', `/cycles/${cycleId}/start`)).statusCode).toBe(403);
    experiments.push((await experiment(sessions.owner, focusOf[0]!)).json().experimentId);
    const blocked = await call(sessions.leader, 'POST', `/cycles/${cycleId}/start`);
    expect([blocked.statusCode, blocked.json()]).toEqual([
      422,
      { error: 'cannot_start', noFocus: false, tooMany: false, withoutExperiment: [program.capabilityIds[1]] },
    ]);

    experiments.push((await experiment(sessions.leader, focusOf[1]!)).json().experimentId);
    const started = await call(sessions.leader, 'POST', `/cycles/${cycleId}/start`);
    expect(started.statusCode).toBe(200);

    const led = await view(sessions.leader);
    expect(led.status).toBe('in_cycle');
    expect(led.cycle.state).toBe('active');
    expect(led.cycle.startedAt).toEqual(expect.any(String));
    expect((await call(sessions.leader, 'POST', `/cycles/${cycleId}/start`)).json()).toEqual({ error: 'cycle_not_planned' });
    expect((await focus(sessions.owner, 2, 1)).json()).toEqual({ error: 'cycle_not_planned' });
    expect((await call(sessions.owner, 'DELETE', `/cycles/${cycleId}/focuses/${focusOf[0]}`)).json()).toEqual({
      error: 'cycle_not_planned',
    });
  });

  it('moves experiments to in progress and has the panel review them, for good', async () => {
    const move = (session: string, experimentId: string, body: unknown) => call(session, 'PATCH', `/experiments/${experimentId}`, body);
    expect((await move(sessions.owner, experiments[0]!, { state: 'in_progress' })).statusCode).toBe(200);
    expect((await move(sessions.owner, experiments[0]!, { state: 'reviewed', result: 'consolidated', learnings: 'x' })).statusCode).toBe(403);
    const reviewed = await move(sessions.leader, experiments[0]!, {
      state: 'reviewed',
      result: 'consolidated',
      learnings: 'Mostrar datos antes de opinar cambió la conversación',
    });
    expect(reviewed.statusCode).toBe(200);
    expect((await move(sessions.leader, experiments[0]!, { state: 'in_progress' })).json()).toEqual({ error: 'invalid_transition' });
    expect((await move(sessions.leader, experiments[1]!, { state: 'reviewed', result: 'consolidated', learnings: '' })).json()).toEqual({
      error: 'invalid_transition',
    });
    expect((await move(sessions.leader, experiments[1]!, { state: 'done' })).json()).toEqual({ error: 'invalid_request' });
    expect((await experiment(sessions.owner, focusOf[1]!)).statusCode).toBe(201);

    const first = (await view(sessions.owner)).cycle.focuses[0].experiments[0];
    expect(first).toEqual({
      id: experiments[0],
      description: 'Facilitar la revisión del sprint con datos de uso',
      expectedResult: 'El equipo decide qué sigue con evidencia',
      state: 'reviewed',
      result: 'consolidated',
      learnings: 'Mostrar datos antes de opinar cambió la conversación',
      reviewedAt: expect.any(String),
    });
  });

  it('INV-9 keeps cycles away from anyone off the board', async () => {
    expect((await call(sessions.administrator, 'GET', '')).statusCode).toBe(404);
    expect((await call(sessions.otherParticipant, 'PATCH', `/experiments/${experiments[1]}`, { state: 'in_progress' })).statusCode).toBe(404);
    expect((await call(sessions.administrator, 'POST', `/cycles/${cycleId}/start`)).statusCode).toBe(404);
  });

  it('answers 404 for a cycle or an experiment of another board', async () => {
    const seed = createSeeder(ownerPool);
    const other = await seedBoard(ownerPool, program, (organizationId) => seed.person(organizationId));
    await ownerPool.query('update placements set level_id = $1 where board_id = $2', [program.levelIds[0], other.boardId]);
    await giveBaseline(ownerPool, other.boardId, 'calibrated');
    // A board that closes while its cycle is still planned cannot start it.
    const closing = await seedBoard(ownerPool, program, (organizationId) => seed.person(organizationId));
    await ownerPool.query('update placements set level_id = $1 where board_id = $2', [program.levelIds[0], closing.boardId]);
    await giveBaseline(ownerPool, closing.boardId, 'calibrated');
    const closingCycle = (
      await ownerPool.query<{ id: string }>(
        "insert into cycles (organization_id, board_id, starts_on, ends_on, created_by) values ($1, $2, date '2027-01-01', date '2027-02-01', $3) returning id",
        [program.organizationId, closing.boardId, closing.owner],
      )
    ).rows[0]!.id;
    await ownerPool.query("update boards set status = 'closed' where id = $1", [closing.boardId]);
    const closingLeader = await createSignedInApp(appPool).signInAs(
      (await ownerPool.query<{ email: string }>('select email from persons where id = $1', [closing.leader])).rows[0]!.email,
    );
    const refused = await app.inject({
      method: 'POST',
      url: `/api/boards/${closing.boardId}/cycles/${closingCycle}/start`,
      cookies: { session: closingLeader },
      headers: { origin: TEST_PUBLIC_URL.origin },
    });
    // A closed board refuses every change before anything else (increment 7).
    expect([refused.statusCode, refused.json()]).toEqual([409, { error: 'board_closed' }]);

    const foreignCycle = (
      await ownerPool.query<{ id: string }>(
        "insert into cycles (organization_id, board_id, starts_on, ends_on, created_by) values ($1, $2, date '2027-01-01', date '2027-02-01', $3) returning id",
        [program.organizationId, other.boardId, other.owner],
      )
    ).rows[0]!.id;
    expect((await call(sessions.leader, 'POST', `/cycles/${foreignCycle}/start`)).statusCode).toBe(404);
    expect((await call(sessions.leader, 'PATCH', `/experiments/${foreignCycle}`, { state: 'in_progress' })).statusCode).toBe(404);
  });
});
