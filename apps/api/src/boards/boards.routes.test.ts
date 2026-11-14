import type { FastifyInstance } from 'fastify';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { seedMap } from '../../test-support/seed-map.ts';
import { enroll, giveBaseline, seedProgram, type SeededProgram } from '../../test-support/seed-program.ts';
import { createSeeder } from '../../test-support/seed.ts';
import { createSignedInApp, TEST_PUBLIC_URL } from '../../test-support/signed-in-app.ts';

type Method = 'GET' | 'POST' | 'DELETE';

describe('boards', () => {
  let ownerPool: pg.Pool;
  let appPool: pg.Pool;
  let app: FastifyInstance;
  let organizationA: string;
  let program: SeededProgram;
  let boardId: string;
  let sessions: Record<'participant' | 'otherParticipant' | 'leader' | 'firmMentor' | 'administrator' | 'superAdministrator', string>;

  const call = (session: string, method: Method, url: string, body?: unknown) =>
    app.inject({
      method,
      url: `/api/boards${url}`,
      cookies: { session },
      headers: method === 'GET' ? {} : { origin: TEST_PUBLIC_URL.origin },
      ...(body === undefined ? {} : { payload: body as Record<string, unknown> }),
    });

  beforeAll(async () => {
    ownerPool = new pg.Pool({ connectionString: inject('ownerDatabaseUrl') });
    appPool = new pg.Pool({ connectionString: inject('appDatabaseUrl') });
    const signedIn = createSignedInApp(appPool);
    app = signedIn.app;
    const seed = createSeeder(ownerPool);
    const emailOf = async (personId: string) =>
      (await ownerPool.query<{ email: string }>('select email from persons where id = $1', [personId])).rows[0]!.email;

    organizationA = await seed.organization();
    program = await seedProgram(ownerPool, organizationA);
    const people = {
      participant: await seed.person(organizationA),
      otherParticipant: await seed.person(organizationA),
      leader: await seed.person(organizationA),
      firmMentor: await seed.person(null),
      administrator: await seed.person(organizationA),
      superAdministrator: await seed.person(null),
    };
    await seed.membership(organizationA, people.administrator, 'administrator');
    const participant = await enroll(ownerPool, program, people.participant, 'participant');
    await enroll(ownerPool, program, people.otherParticipant, 'participant');
    const leader = await enroll(ownerPool, program, people.leader, 'leader');
    const mentor = await enroll(ownerPool, program, people.firmMentor, 'mentor');
    for (const [member, role] of [
      [leader, 'leader'],
      [mentor, 'mentor'],
    ] as const) {
      await ownerPool.query(
        'insert into panel_assignments (organization_id, participant_enrollment_id, member_enrollment_id, role) values ($1, $2, $3, $4)',
        [organizationA, participant, member, role],
      );
    }
    boardId = (
      await ownerPool.query<{ id: string }>('insert into boards (organization_id, enrollment_id) values ($1, $2) returning id', [
        organizationA,
        participant,
      ])
    ).rows[0]!.id;
    for (const capabilityId of program.capabilityIds.slice(0, 2)) {
      await ownerPool.query(
        'insert into placements (organization_id, board_id, capability_id, added_by) values ($1, $2, $3, $4)',
        [organizationA, boardId, capabilityId, people.leader],
      );
    }
    sessions = Object.fromEntries(
      await Promise.all(
        Object.entries(people).map(async ([key, personId]) => [key, await signedIn.signInAs(await emailOf(personId))]),
      ),
    ) as typeof sessions;
  });

  afterAll(async () => {
    await app.close();
    await appPool.end();
    await ownerPool.end();
  });

  it('lists the boards a person owns and the ones they accompany, without their content', async () => {
    const ofParticipant = (await call(sessions.participant, 'GET', '')).json();
    const ofMentor = (await call(sessions.firmMentor, 'GET', '')).json();

    expect(ofParticipant.mine).toEqual([
      expect.objectContaining({ id: boardId, organizationId: organizationA, status: 'not_started' }),
    ]);
    expect(ofParticipant.accompanied).toEqual([]);
    expect(ofMentor.mine).toEqual([]);
    expect(ofMentor.accompanied).toEqual([expect.objectContaining({ id: boardId, panelRoles: ['mentor'] })]);
    expect(JSON.stringify([ofParticipant, ofMentor])).not.toMatch(/placement|level/i);
  });

  it('shows the owner their board: the map, every capability unplaced, and no adjust rights', async () => {
    const response = await call(sessions.participant, 'GET', `/${boardId}`);
    const board = response.json();

    expect(response.statusCode).toBe(200);
    expect(board).toMatchObject({ id: boardId, hasBaseline: false, viewer: { isOwner: true, panelRoles: [], canAdd: false, canRemove: false } });
    expect(board.levels.map((level: { name: string }) => level.name)).toEqual(['No sabe', 'Principiante']);
    expect(board.capabilities.map((capability: { id: string }) => capability.id)).toEqual(program.capabilityIds);
    expect(board.placements).toEqual(
      program.capabilityIds.slice(0, 2).map((capabilityId) => expect.objectContaining({ capabilityId, levelId: null })),
    );
  });

  it('INV-9 shows the board to its panel, including the Kleer mentor', async () => {
    const leader = await call(sessions.leader, 'GET', `/${boardId}`);
    const mentor = await call(sessions.firmMentor, 'GET', `/${boardId}`);

    expect([leader.statusCode, mentor.statusCode]).toEqual([200, 200]);
    expect(leader.json().viewer).toEqual({
      isOwner: false,
      panelRoles: ['leader'],
      canAdd: true,
      canRemove: true,
      canSelfAssess: false,
      canCalibrate: false,
      canRecordInitialLevel: false,
      canPlanCycle: false,
      canStartCycle: false,
      canReviewExperiments: false,
      canRecordEvidence: false,
      canProposeChanges: false,
      canDecideProposals: false,
      canRecordMentoring: false,
      canCloseCycle: false,
      canRecalibrate: false,
      canCloseBoard: false,
    });
    expect(mentor.json().placements).toHaveLength(2);
  });

  it('INV-9 answers another participant, the administrator and a super administrator off the panel as if the board did not exist', async () => {
    const responses = await Promise.all([
      call(sessions.otherParticipant, 'GET', `/${boardId}`),
      call(sessions.administrator, 'GET', `/${boardId}`),
      call(sessions.superAdministrator, 'GET', `/${boardId}`),
      call(sessions.administrator, 'GET', '/00000000-0000-4000-8000-000000000000'),
    ]);

    expect(responses.map((response) => response.statusCode)).toEqual([404, 404, 404, 404]);
    expect(new Set(responses.map((response) => response.body)).size).toBe(1);
    const listed = (await call(sessions.administrator, 'GET', '')).json();
    expect(listed).toEqual({ mine: [], accompanied: [] });
  });

  it('INV-1 lets the panel add a capability of the map once, and not the owner', async () => {
    const third = program.capabilityIds[2];

    const byOwner = await call(sessions.participant, 'POST', `/${boardId}/capabilities`, { capabilityId: third });
    const added = await call(sessions.leader, 'POST', `/${boardId}/capabilities`, { capabilityId: third });
    const again = await call(sessions.firmMentor, 'POST', `/${boardId}/capabilities`, { capabilityId: third });
    const other = await seedMap(ownerPool, organizationA, 'published');
    const foreign = await call(sessions.leader, 'POST', `/${boardId}/capabilities`, { capabilityId: other.capabilityId });

    expect([byOwner.statusCode, added.statusCode, again.statusCode, foreign.statusCode]).toEqual([403, 201, 409, 400]);
    expect(again.json()).toEqual({ error: 'already_on_board' });
    expect(foreign.json()).toEqual({ error: 'unknown_reference' });
    expect((await call(sessions.participant, 'GET', `/${boardId}`)).json().placements).toHaveLength(3);
  });

  it('refuses removal to someone off the panel, answers 404 for a capability not on the board, and 401 without a session', async () => {
    const byOwner = await call(sessions.participant, 'DELETE', `/${boardId}/capabilities/${program.capabilityIds[0]}`);
    const notOnBoard = await call(sessions.leader, 'DELETE', `/${boardId}/capabilities/00000000-0000-4000-8000-000000000000`);
    const anonymous = await app.inject({
      method: 'DELETE',
      url: `/api/boards/${boardId}/capabilities/${program.capabilityIds[0]}`,
      headers: { origin: TEST_PUBLIC_URL.origin },
    });

    expect([byOwner.statusCode, notOnBoard.statusCode, anonymous.statusCode]).toEqual([403, 404, 401]);
  });

  it('INV-1 lets the panel remove a capability before the baseline, and not after', async () => {
    const third = program.capabilityIds[2];
    const removed = await call(sessions.leader, 'DELETE', `/${boardId}/capabilities/${third}`);
    await call(sessions.leader, 'POST', `/${boardId}/capabilities`, { capabilityId: third });
    await giveBaseline(ownerPool, boardId);

    const afterBaseline = await call(sessions.leader, 'DELETE', `/${boardId}/capabilities/${third}`);
    const view = (await call(sessions.leader, 'GET', `/${boardId}`)).json();

    expect([removed.statusCode, afterBaseline.statusCode]).toEqual([204, 409]);
    expect(afterBaseline.json()).toEqual({ error: 'baseline_set' });
    expect(view.viewer).toMatchObject({ canAdd: true, canRemove: false });
  });
});
