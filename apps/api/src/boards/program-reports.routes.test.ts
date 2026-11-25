import type { FastifyInstance } from 'fastify';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import {
  enroll,
  giveBaseline,
  seedBoard,
  seedProgram,
  type SeededBoard,
  type SeededProgram,
} from '../../test-support/seed-program.ts';
import { createSeeder } from '../../test-support/seed.ts';
import { createSignedInApp, TEST_PUBLIC_URL } from '../../test-support/signed-in-app.ts';

/** The progress report of a program, read by its leaders only (user decisions of 2026-11-25). */
describe('program progress report', () => {
  let ownerPool: pg.Pool;
  let appPool: pg.Pool;
  let app: FastifyInstance;
  let program: SeededProgram;
  let otherProgram: SeededProgram;
  let board: SeededBoard;
  let secondBoardId: string;
  let sessions: Record<
    | 'panelLeader'
    | 'programLeader'
    | 'otherLeader'
    | 'participant'
    | 'administrator'
    | 'superAdministrator'
    | 'enrolledSuperAdministrator',
    string
  >;

  const reports = (session?: string) =>
    app.inject({
      method: 'GET',
      url: '/api/program-reports',
      ...(session === undefined ? {} : { cookies: { session } }),
    });

  beforeAll(async () => {
    ownerPool = new pg.Pool({ connectionString: inject('ownerDatabaseUrl') });
    appPool = new pg.Pool({ connectionString: inject('appDatabaseUrl') });
    const signedIn = createSignedInApp(appPool);
    app = signedIn.app;
    const seed = createSeeder(ownerPool);
    const organizationId = await seed.organization();
    program = await seedProgram(ownerPool, organizationId);
    otherProgram = await seedProgram(ownerPool, organizationId);
    board = await seedBoard(ownerPool, program, (organization) => seed.person(organization));
    const named = async (personId: string, name: string) =>
      ownerPool.query('update persons set name = $2 where id = $1', [personId, name]);
    await named(board.owner, 'Zoe Ruiz');

    // A second participant with a board, named so that it sorts first.
    const second = await seed.person(organizationId);
    await named(second, 'Ana Gómez');
    const secondEnrollment = await enroll(ownerPool, program, second, 'participant');
    secondBoardId = (
      await ownerPool.query<{ id: string }>('insert into boards (organization_id, enrollment_id) values ($1, $2) returning id', [
        organizationId,
        secondEnrollment,
      ])
    ).rows[0]!.id;

    const programLeader = await seed.person(organizationId);
    await enroll(ownerPool, program, programLeader, 'leader');
    const otherLeader = await seed.person(organizationId);
    await enroll(ownerPool, otherProgram, otherLeader, 'leader');
    const administrator = await seed.person(organizationId);
    await seed.membership(organizationId, administrator, 'administrator');
    const superAdministrator = await seed.person(null);
    const enrolledSuperAdministrator = await seed.person(null);
    await enroll(ownerPool, program, enrolledSuperAdministrator, 'leader');

    // Zoe's board scores 2 today (two capabilities at multiplier 1, a third at 0); her baseline scored 1.
    await ownerPool.query('update placements set level_id = $1 where board_id = $2', [program.levelIds[1], board.boardId]);
    await ownerPool.query(
      'insert into placements (organization_id, board_id, capability_id, level_id, added_by) values ($1, $2, $3, $4, $5)',
      [organizationId, board.boardId, program.capabilityIds[2], program.levelIds[0], board.leader],
    );
    await giveBaseline(ownerPool, board.boardId, 'calibrated');
    await ownerPool.query(
      "insert into baseline_entries (organization_id, board_id, capability_id, level_id, origin) select organization_id, board_id, capability_id, case when capability_id = $2 then $3 else level_id end, 'calibration' from placements where board_id = $1",
      [board.boardId, program.capabilityIds[1], program.levelIds[0]],
    );
    await ownerPool.query(
      "insert into cycles (organization_id, board_id, number, starts_on, ends_on, state, started_at, created_by) select organization_id, id, 1, '2026-11-20', '2026-12-31', 'planned', null, $2 from boards where id = $1",
      [board.boardId, board.leader],
    );
    // Two experiments on Zoe's cycle, on her third capability (level 0); the panel reviews
    // one (finished) and moves the other in progress below.
    const focusId = (
      await ownerPool.query<{ id: string }>(
        'insert into focuses (organization_id, cycle_id, capability_id, target_level_id, created_by) select c.organization_id, c.id, $2, $3, $4 from cycles c where c.board_id = $1 returning id',
        [board.boardId, program.capabilityIds[2], program.levelIds[1], board.leader],
      )
    ).rows[0]!.id;
    const experimentIds: string[] = [];
    for (let index = 0; index < 2; index++) {
      const inserted = await ownerPool.query<{ id: string }>(
        "insert into experiments (organization_id, focus_id, description, created_by) select organization_id, id, 'Probar', $2 from focuses where id = $1 returning id",
        [focusId, board.leader],
      );
      experimentIds.push(inserted.rows[0]!.id);
    }

    const emailOf = async (personId: string) =>
      (await ownerPool.query<{ email: string }>('select email from persons where id = $1', [personId])).rows[0]!.email;
    sessions = {
      panelLeader: await signedIn.signInAs(await emailOf(board.leader)),
      programLeader: await signedIn.signInAs(await emailOf(programLeader)),
      otherLeader: await signedIn.signInAs(await emailOf(otherLeader)),
      participant: await signedIn.signInAs(await emailOf(board.owner)),
      administrator: await signedIn.signInAs(await emailOf(administrator)),
      superAdministrator: await signedIn.signInAs(await emailOf(superAdministrator)),
      enrolledSuperAdministrator: await signedIn.signInAs(await emailOf(enrolledSuperAdministrator)),
    };

    // The panel starts the cycle and reviews one experiment, as in the product.
    const asPanel = (method: 'POST' | 'PATCH', url: string, payload?: Record<string, unknown>) =>
      app.inject({
        method,
        url: `/api/boards/${board.boardId}${url}`,
        cookies: { session: sessions.panelLeader },
        headers: { origin: TEST_PUBLIC_URL.origin },
        ...(payload === undefined ? {} : { payload }),
      });
    const cycleId = (await ownerPool.query<{ id: string }>('select id from cycles where board_id = $1', [board.boardId])).rows[0]!.id;
    expect((await asPanel('POST', `/cycles/${cycleId}/start`)).statusCode).toBe(200);
    expect((await asPanel('PATCH', `/experiments/${experimentIds[0]}`, { state: 'reviewed', result: 'discarded' })).statusCode).toBe(200);
    expect((await asPanel('PATCH', `/experiments/${experimentIds[1]}`, { state: 'in_progress' })).statusCode).toBe(200);
  });

  afterAll(async () => {
    await app.close();
    await appPool.end();
    await ownerPool.end();
  });

  const expectedReport = () => ({
    programId: program.programId,
    programName: expect.any(String),
    organizationName: expect.any(String),
    participants: [
      {
        boardId: secondBoardId,
        participantName: 'Ana Gómez',
        status: 'not_started',
        cycle: null,
        change: null,
        percent: null,
        finishedExperiments: 0,
        experimentsInProgress: 0,
      },
      {
        boardId: board.boardId,
        participantName: 'Zoe Ruiz',
        status: 'in_cycle',
        cycle: { number: 1, state: 'active' },
        change: 1,
        percent: 100,
        finishedExperiments: 1,
        experimentsInProgress: 1,
      },
    ],
  });

  it('S1 S3 S4 S8 gives a leader off the panel every participant, by name, with the change against the own baseline only', async () => {
    const response = await reports(sessions.programLeader);
    expect(response.statusCode).toBe(200);
    // No absolute score, maximum or breakdown: exact objects (invariant 9).
    expect(response.json()).toEqual({ reports: [expectedReport()] });
  });

  it('S4 gives the same report to a leader on a panel of the program', async () => {
    expect((await reports(sessions.panelLeader)).json()).toEqual({
      reports: [expectedReport()],
    });
  });

  it('S2 gives it to a super administrator only when enrolled as leader in the program', async () => {
    expect((await reports(sessions.enrolledSuperAdministrator)).json()).toEqual({ reports: [expectedReport()] });
    expect((await reports(sessions.superAdministrator)).json()).toEqual({
      reports: [],
    });
  });

  it('S4 gives nothing of the program to a participant, an administrator or a leader of another program', async () => {
    expect((await reports(sessions.participant)).json()).toEqual({
      reports: [],
    });
    expect((await reports(sessions.administrator)).json()).toEqual({
      reports: [],
    });
    // The other program has no board yet, so it has no report either.
    expect((await reports(sessions.otherLeader)).json()).toEqual({
      reports: [],
    });
  });

  it('refuses a request without a session', async () => {
    const response = await reports();
    expect([response.statusCode, response.json()]).toEqual([401, { error: 'not_signed_in' }]);
  });
});
