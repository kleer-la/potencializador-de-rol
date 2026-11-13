import type { FastifyInstance } from 'fastify';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { seedMap } from '../../test-support/seed-map.ts';
import { seedBoard, seedProgram, type SeededBoard, type SeededProgram } from '../../test-support/seed-program.ts';
import { createSeeder } from '../../test-support/seed.ts';
import { createSignedInApp, TEST_PUBLIC_URL } from '../../test-support/signed-in-app.ts';

type Method = 'GET' | 'PUT' | 'POST';

describe('calibration and baseline', () => {
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
  const view = async (session: string) => (await call(session, 'GET', '')).json();
  const agreed = (pairs: [number, number][]) =>
    pairs.map(([capability, level]) => ({ capabilityId: program.capabilityIds[capability]!, levelId: program.levelIds[level]! }));
  const calibrate = (session: string, body: Record<string, unknown>) =>
    call(session, 'POST', '/calibration', {
      heldOn: '2026-11-20',
      notes: 'Casos del último sprint',
      attendees: [board.owner, board.leader],
      levels: agreed([[0, 0], [1, 1]]),
      ...body,
    });

  beforeAll(async () => {
    ownerPool = new pg.Pool({ connectionString: inject('ownerDatabaseUrl') });
    appPool = new pg.Pool({ connectionString: inject('appDatabaseUrl') });
    const signedIn = createSignedInApp(appPool);
    app = signedIn.app;
    const seed = createSeeder(ownerPool);
    program = await seedProgram(ownerPool, await seed.organization());
    await ownerPool.query("update programs set mandatory_panel_roles = '{leader}' where id = $1", [program.programId]);
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

  it('offers the calibration to the panel only once the board is self-assessed', async () => {
    const before = await view(sessions.leader);
    expect(before.viewer.canCalibrate).toBe(false);
    expect(before.calibration).toBeNull();
    expect(before.baseline).toBeNull();
    expect((await calibrate(sessions.leader, {})).json()).toEqual({ error: 'not_self_assessed' });
    expect((await call(sessions.leader, 'POST', '/initial-levels', agreed([[0, 0]])[0])).json()).toEqual({ error: 'no_baseline' });

    // The owner proposes the first capability one level higher than it will be agreed.
    await call(sessions.owner, 'PUT', '/self-assessment', { levels: agreed([[0, 1], [1, 1]]) });
    expect((await call(sessions.owner, 'POST', '/self-assessment/submit')).statusCode).toBe(200);

    const leaderView = await view(sessions.leader);
    const ownerView = await view(sessions.owner);
    expect(leaderView.viewer.canCalibrate).toBe(true);
    expect(ownerView.viewer.canCalibrate).toBe(false);
    expect(leaderView.program.mandatoryPanelRoles).toEqual(['leader']);
    expect(leaderView.panel).toEqual([{ personId: board.leader, name: expect.any(String), role: 'leader' }]);
    expect(leaderView.owner).toEqual({ personId: board.owner, name: expect.any(String) });
  });

  it('refuses a calibration by the owner and by anyone off the board', async () => {
    expect((await calibrate(sessions.owner, {})).statusCode).toBe(403);
    expect((await calibrate(sessions.otherParticipant, {})).statusCode).toBe(404);
  });

  it('INV-3 refuses the baseline without the participant or a mandatory role, naming what is missing', async () => {
    const withoutLeader = await calibrate(sessions.leader, { attendees: [board.owner] });
    const withoutOwner = await calibrate(sessions.leader, { attendees: [board.leader] });
    const nobody = await calibrate(sessions.leader, { attendees: [] });

    expect(withoutLeader.statusCode).toBe(422);
    expect(withoutLeader.json()).toEqual({ error: 'attendance', participantMissing: false, missingRoles: ['leader'] });
    expect(withoutOwner.json()).toEqual({ error: 'attendance', participantMissing: true, missingRoles: [] });
    expect(nobody.json()).toEqual({ error: 'attendance', participantMissing: true, missingRoles: ['leader'] });
    expect((await view(sessions.leader)).status).toBe('self_assessed');
  });

  it('refuses an incomplete calibration, foreign references and a malformed body', async () => {
    const incomplete = await calibrate(sessions.leader, { levels: agreed([[0, 0]]) });
    expect(incomplete.statusCode).toBe(422);
    expect(incomplete.json()).toEqual({ error: 'incomplete', missing: [program.capabilityIds[1]] });

    const other = await seedMap(ownerPool, program.organizationId, 'published');
    const foreignLevel = await calibrate(sessions.leader, {
      levels: [{ capabilityId: program.capabilityIds[0], levelId: other.levelId }, agreed([[1, 0]])[0]],
    });
    const offBoard = await calibrate(sessions.leader, { levels: agreed([[0, 0], [1, 0], [2, 0]]) });
    const stranger = await calibrate(sessions.leader, { attendees: [board.owner, board.leader, board.otherParticipant] });
    expect([foreignLevel.statusCode, offBoard.statusCode, stranger.statusCode]).toEqual([400, 400, 400]);
    expect(stranger.json()).toEqual({ error: 'unknown_reference' });

    for (const body of [{ heldOn: '20-11-2026' }, { levels: agreed([[0, 0], [0, 1], [1, 0]]) }, { attendees: 'all' }]) {
      expect((await calibrate(sessions.leader, body)).json()).toEqual({ error: 'invalid_request' });
    }
  });

  it('INV-3 records the calibration and fixes the baseline once, even when two arrive together', async () => {
    const responses = await Promise.all([calibrate(sessions.leader, {}), calibrate(sessions.leader, {})]);
    expect(responses.map((response) => response.statusCode).sort()).toEqual([201, 409]);
    expect(responses.find((response) => response.statusCode === 409)!.json()).toEqual({ error: 'baseline_set' });
    const sessionsRecorded = await ownerPool.query('select count(*)::int as n from calibration_sessions where board_id = $1', [board.boardId]);
    expect(sessionsRecorded.rows[0].n).toBe(1);

    const owned = await view(sessions.owner);
    expect(owned.status).toBe('calibrated');
    expect(owned.hasBaseline).toBe(true);
    expect(owned.calibration).toEqual({
      heldOn: '2026-11-20',
      notes: 'Casos del último sprint',
      attendees: expect.arrayContaining([
        { personId: board.owner, name: expect.any(String) },
        { personId: board.leader, name: expect.any(String) },
      ]),
      levels: [
        { capabilityId: program.capabilityIds[0], selfAssessedLevelId: program.levelIds[1], agreedLevelId: program.levelIds[0] },
        { capabilityId: program.capabilityIds[1], selfAssessedLevelId: program.levelIds[1], agreedLevelId: program.levelIds[1] },
      ],
    });
    expect(owned.baseline.setAt).toEqual(expect.any(String));
    expect(owned.baseline.entries).toEqual([
      { capabilityId: program.capabilityIds[0], levelId: program.levelIds[0], origin: 'calibration', setAt: expect.any(String) },
      { capabilityId: program.capabilityIds[1], levelId: program.levelIds[1], origin: 'calibration', setAt: expect.any(String) },
    ]);
    expect(owned.placements.map((placement: { levelId: string }) => placement.levelId).sort()).toEqual(
      [program.levelIds[0], program.levelIds[1]].sort(),
    );
    expect((await view(sessions.leader)).viewer.canCalibrate).toBe(false);
    expect((await calibrate(sessions.leader, {})).json()).toEqual({ error: 'baseline_set' });
  });

  it('INV-3 a capability added after the baseline gets its initial level from the panel, once', async () => {
    const added = program.capabilityIds[2]!;
    expect((await call(sessions.leader, 'POST', '/capabilities', { capabilityId: added })).statusCode).toBe(201);
    const level = (session: string, capabilityId = added) =>
      call(session, 'POST', '/initial-levels', { capabilityId, levelId: program.levelIds[1] });

    expect((await view(sessions.leader)).viewer.canRecordInitialLevel).toBe(true);
    expect((await level(sessions.owner)).statusCode).toBe(403);
    expect((await level(sessions.leader)).statusCode).toBe(201);
    expect((await level(sessions.leader)).json()).toEqual({ error: 'already_leveled' });
    expect((await level(sessions.leader, program.capabilityIds[0])).json()).toEqual({ error: 'already_leveled' });

    const owned = await view(sessions.owner);
    expect(owned.baseline.entries).toHaveLength(3);
    expect(owned.baseline.entries[2]).toEqual({
      capabilityId: added,
      levelId: program.levelIds[1],
      origin: 'initial_leveling',
      setAt: expect.any(String),
    });
  });

  it('refuses an initial level of another map', async () => {
    // A published map only grows: a fourth capability joins it and then the board.
    const added = (
      await ownerPool.query<{ id: string }>(
        "insert into capabilities (organization_id, dimension_id, position, statement) select organization_id, dimension_id, 9, 'Negocia el alcance' from capabilities where id = $1 returning id",
        [program.capabilityIds[0]],
      )
    ).rows[0]!.id;
    expect((await call(sessions.leader, 'POST', '/capabilities', { capabilityId: added })).statusCode).toBe(201);
    const other = await seedMap(ownerPool, program.organizationId, 'published');

    const response = await call(sessions.leader, 'POST', '/initial-levels', { capabilityId: added, levelId: other.levelId });

    expect([response.statusCode, response.json()]).toEqual([400, { error: 'unknown_reference' }]);
  });

  it('answers 404 for an initial level of a capability not on the board', async () => {
    const other = await seedMap(ownerPool, program.organizationId, 'published');
    const response = await call(sessions.leader, 'POST', '/initial-levels', {
      capabilityId: other.capabilityId,
      levelId: program.levelIds[0],
    });
    expect(response.statusCode).toBe(404);
  });
});
