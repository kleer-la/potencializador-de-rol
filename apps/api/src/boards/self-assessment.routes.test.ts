import type { FastifyInstance } from 'fastify';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { giveBaseline, seedBoard, seedProgram, type SeededBoard, type SeededProgram } from '../../test-support/seed-program.ts';
import { seedMap } from '../../test-support/seed-map.ts';
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

  it('refuses a level of another map', async () => {
    const other = await seedMap(ownerPool, program.organizationId, 'published');

    const response = await save(sessions.owner, [{ capabilityId: program.capabilityIds[0]!, levelId: other.levelId }]);

    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({ error: 'unknown_reference' });
  });

  it('refuses to submit a board without capabilities, before and after an empty save', async () => {
    const seed = createSeeder(ownerPool);
    const empty = await seedBoard(ownerPool, program, (organizationId) => seed.person(organizationId));
    await ownerPool.query('delete from placements where board_id = $1', [empty.boardId]);
    const email = (await ownerPool.query('select email from persons where id = $1', [empty.owner])).rows[0].email;
    const session = await createSignedInApp(appPool).signInAs(email);
    const request = (method: 'PUT' | 'POST', url: string, payload?: object) =>
      app.inject({
        method,
        url: `/api/boards/${empty.boardId}${url}`,
        cookies: { session },
        headers: { origin: TEST_PUBLIC_URL.origin },
        ...(payload === undefined ? {} : { payload }),
      });

    const beforeSave = await request('POST', '/self-assessment/submit');
    await request('PUT', '/self-assessment', { levels: [] });
    const afterSave = await request('POST', '/self-assessment/submit');

    expect([beforeSave.statusCode, afterSave.statusCode]).toEqual([422, 422]);
    expect(afterSave.json()).toEqual({ error: 'empty_board' });
    const board_ = await ownerPool.query('select status from boards where id = $1', [empty.boardId]);
    expect(board_.rows).toEqual([{ status: 'not_started' }]);
  });

  it('refuses repeated capabilities, a malformed body and a submission by the panel', async () => {
    const capabilityId = program.capabilityIds[0]!;
    const repeated = await save(sessions.owner, [
      { capabilityId, levelId: program.levelIds[0]! },
      { capabilityId, levelId: program.levelIds[1]! },
    ]);
    const malformed = await call(sessions.owner, 'PUT', '/self-assessment', { levels: 'all' });
    const byLeader = await call(sessions.leader, 'POST', '/self-assessment/submit');

    expect([repeated.statusCode, malformed.statusCode, byLeader.statusCode]).toEqual([400, 400, 403]);
  });

  it('gives one draft to concurrent first saves', async () => {
    const seed = createSeeder(ownerPool);
    const fresh = await seedBoard(ownerPool, program, (organizationId) => seed.person(organizationId));
    const email = (await ownerPool.query('select email from persons where id = $1', [fresh.owner])).rows[0].email;
    const session = await createSignedInApp(appPool).signInAs(email);
    const level = { capabilityId: program.capabilityIds[0]!, levelId: program.levelIds[0]! };

    const responses = await Promise.all(
      Array.from({ length: 4 }, () =>
        app.inject({
          method: 'PUT',
          url: `/api/boards/${fresh.boardId}/self-assessment`,
          cookies: { session },
          headers: { origin: TEST_PUBLIC_URL.origin },
          payload: { levels: [level] },
        }),
      ),
    );

    expect(responses.map((response) => response.statusCode)).toEqual([200, 200, 200, 200]);
    const stored = await ownerPool.query('select count(*) from self_assessments where board_id = $1', [fresh.boardId]);
    expect(Number(stored.rows[0].count)).toBe(1);
  });

  it('is open only while the board has not started: a board further on refuses it', async () => {
    const seed = createSeeder(ownerPool);
    const later = await seedBoard(ownerPool, program, (organizationId) => seed.person(organizationId));
    await giveBaseline(ownerPool, later.boardId, 'calibrated');
    const email = (await ownerPool.query('select email from persons where id = $1', [later.owner])).rows[0].email;
    const session = await createSignedInApp(appPool).signInAs(email);
    const request = (method: 'GET' | 'PUT' | 'POST', url: string, payload?: object) =>
      app.inject({
        method,
        url: `/api/boards/${later.boardId}${url}`,
        cookies: { session },
        headers: method === 'GET' ? {} : { origin: TEST_PUBLIC_URL.origin },
        ...(payload === undefined ? {} : { payload }),
      });

    const saved = await request('PUT', '/self-assessment', { levels: [] });
    const submitted = await request('POST', '/self-assessment/submit');
    const viewed = (await request('GET', '')).json();

    expect([saved.statusCode, submitted.statusCode]).toEqual([409, 409]);
    expect(saved.json()).toEqual({ error: 'board_not_open' });
    expect(viewed.viewer.canSelfAssess).toBe(false);
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
    // No score comes from a self-assessment: the board has none until its baseline.
    expect([byOwner.score, byOwner.evolution]).toEqual([null, []]);
  });

  it('INV-9 shows the submitted self-assessment to the panel, and to nobody else', async () => {
    const byLeader = await view(sessions.leader);
    const byStranger = await call(sessions.otherParticipant, 'GET', '');

    expect(byLeader.selfAssessment.levels).toHaveLength(2);
    expect(byStranger.statusCode).toBe(404);
  });
});
