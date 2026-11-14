import type { FastifyInstance } from 'fastify';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { giveBaseline, seedBoard, seedProgram, type SeededBoard, type SeededProgram } from '../../test-support/seed-program.ts';
import { createSeeder } from '../../test-support/seed.ts';
import { createSignedInApp, TEST_PUBLIC_URL } from '../../test-support/signed-in-app.ts';

type Method = 'GET' | 'POST' | 'DELETE';

describe('evidence, level changes, bonuses and mentoring', () => {
  let ownerPool: pg.Pool;
  let appPool: pg.Pool;
  let app: FastifyInstance;
  let program: SeededProgram;
  let board: SeededBoard;
  let sessions: Record<'owner' | 'leader' | 'otherParticipant' | 'administrator', string>;
  let transferLevel: string;
  let ruleId: string;
  const evidence: Record<string, string> = {};
  let proposalId: string;

  const call = (session: string, method: Method, url: string, body?: unknown) =>
    app.inject({
      method,
      url: `/api/boards/${board.boardId}${url}`,
      cookies: { session },
      headers: method === 'GET' ? {} : { origin: TEST_PUBLIC_URL.origin },
      ...(body === undefined ? {} : { payload: body as Record<string, unknown> }),
    });
  const view = async (session: string) => (await call(session, 'GET', '')).json();
  const record = (session: string, body: Record<string, unknown>) =>
    call(session, 'POST', '/evidence', { description: 'Facilitó la revisión con datos', occurredOn: '2026-12-10', ...body });

  beforeAll(async () => {
    ownerPool = new pg.Pool({ connectionString: inject('ownerDatabaseUrl') });
    appPool = new pg.Pool({ connectionString: inject('appDatabaseUrl') });
    const signedIn = createSignedInApp(appPool);
    app = signedIn.app;
    const seed = createSeeder(ownerPool);
    const organization = await seed.organization();
    program = await seedProgram(ownerPool, organization);
    const client = await ownerPool.connect();
    try {
      // Test setup only: a published map admits no new level, so its guard is skipped.
      await client.query('set session_replication_role = replica');
      transferLevel = (
        await client.query(
          "insert into levels (organization_id, map_id, position, name, multiplier, requires_transfer) values ($1, $2, 2, 'Enseña', 2, true) returning id",
          [organization, program.mapId],
        )
      ).rows[0].id;
    } finally {
      await client.query('set session_replication_role = origin');
      client.release();
    }
    ruleId = (await ownerPool.query('select id from bonus_rules where map_id = $1', [program.mapId])).rows[0].id;
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

  it('records evidence after the baseline, by owner and panel, with a web link only', async () => {
    expect((await record(sessions.owner, {})).json()).toEqual({ error: 'no_baseline' });
    expect((await view(sessions.owner)).viewer.canRecordEvidence).toBe(false);
    await giveBaseline(ownerPool, board.boardId, 'calibrated');

    const first = await record(sessions.owner, { link: 'https://example.test/acta' });
    expect(first.statusCode).toBe(201);
    evidence.owner = first.json().evidenceId;
    evidence.taught = (await record(sessions.owner, { description: 'Enseñó la técnica a dos colegas', showsTransfer: true })).json().evidenceId;
    evidence.leader = (await record(sessions.leader, { description: 'Lo vi en la planificación' })).json().evidenceId;
    expect((await record(sessions.owner, { link: 'javascript:alert(1)' })).json()).toEqual({ error: 'invalid_request' });
    expect((await record(sessions.otherParticipant, {})).statusCode).toBe(404);

    const owned = await view(sessions.owner);
    expect(owned.viewer).toMatchObject({ canRecordEvidence: true, canProposeChanges: true, canDecideProposals: false });
    expect(owned.evidence).toHaveLength(3);
    expect(owned.evidence).toContainEqual({
      id: evidence.owner,
      description: 'Facilitó la revisión con datos',
      link: 'https://example.test/acta',
      occurredOn: '2026-12-10',
      showsTransfer: false,
      experimentId: null,
      authorId: board.owner,
      authorName: expect.any(String),
    });
  });

  it('INV-4 INV-5 INV-6 checks a proposal and says what is wrong with it', async () => {
    const propose = (session: string, levelId: string, evidenceIds: string[]) =>
      call(session, 'POST', '/level-proposals', { capabilityId: program.capabilityIds[0], levelId, evidenceIds });

    expect((await propose(sessions.leader, program.levelIds[1]!, [evidence.owner!])).statusCode).toBe(403);
    const empty = await propose(sessions.owner, program.levelIds[1]!, []);
    expect([empty.statusCode, empty.json()]).toEqual([422, { error: 'invalid_proposal', problems: ['no_evidence'] }]);
    expect((await propose(sessions.owner, program.levelIds[0]!, [evidence.owner!])).json()).toEqual({
      error: 'invalid_proposal',
      problems: ['not_above'],
    });
    expect((await propose(sessions.owner, transferLevel, [evidence.owner!])).json()).toEqual({
      error: 'invalid_proposal',
      problems: ['no_transfer_evidence'],
    });
    expect((await propose(sessions.owner, program.levelIds[1]!, [board.boardId])).json()).toEqual({ error: 'unknown_reference' });

    const created = await propose(sessions.owner, program.levelIds[1]!, [evidence.owner!, evidence.leader!]);
    expect(created.statusCode).toBe(201);
    proposalId = created.json().proposalId;
    expect((await propose(sessions.owner, transferLevel, [evidence.taught!])).json()).toEqual({ error: 'proposal_open' });
    expect((await view(sessions.leader)).proposals).toEqual([
      {
        id: proposalId,
        capabilityId: program.capabilityIds[0],
        proposedLevelId: program.levelIds[1],
        state: 'proposed',
        proposedAt: expect.any(String),
        decidedAt: null,
        decisionNote: '',
        evidenceIds: expect.arrayContaining([evidence.owner, evidence.leader]),
      },
    ]);
  });

  it('INV-5 a panel member approves the proposal and the level moves; the owner cannot', async () => {
    const decide = (session: string, approve: boolean) =>
      call(session, 'POST', `/level-proposals/${proposalId}/decision`, { approve, note: 'Consolidado en dos sprints' });

    expect((await decide(sessions.owner, true)).statusCode).toBe(403);
    expect((await decide(sessions.leader, true)).statusCode).toBe(200);
    expect((await decide(sessions.leader, false)).json()).toEqual({ error: 'already_decided' });

    const led = await view(sessions.leader);
    expect(led.viewer.canDecideProposals).toBe(true);
    expect(led.proposals[0]).toMatchObject({ state: 'approved', decisionNote: 'Consolidado en dos sprints' });
    expect(led.placements.find((placement: { capabilityId: string }) => placement.capabilityId === program.capabilityIds[0]).levelId).toBe(
      program.levelIds[1],
    );
  });

  it('INV-7 proposes a bonus with evidence once per rule, and the panel decides', async () => {
    const proposeBonus = (session: string, evidenceIds: string[]) =>
      call(session, 'POST', '/bonuses', { capabilityId: program.capabilityIds[1], bonusRuleId: ruleId, evidenceIds });

    expect((await view(sessions.owner)).bonusRules).toEqual([
      { id: ruleId, name: expect.any(String), extraPoints: expect.any(Number), condition: expect.any(String) },
    ]);
    expect((await proposeBonus(sessions.owner, [])).json()).toEqual({ error: 'invalid_bonus', problems: ['no_evidence'] });
    const created = await proposeBonus(sessions.owner, [evidence.taught!]);
    expect(created.statusCode).toBe(201);
    expect((await proposeBonus(sessions.owner, [evidence.owner!])).json()).toEqual({ error: 'already_awarded' });
    expect((await call(sessions.owner, 'POST', `/bonuses/${created.json().bonusId}/decision`, { approve: true })).statusCode).toBe(403);
    expect((await call(sessions.leader, 'POST', `/bonuses/${created.json().bonusId}/decision`, { approve: true })).statusCode).toBe(200);

    expect((await view(sessions.owner)).bonuses).toEqual([
      {
        id: created.json().bonusId,
        capabilityId: program.capabilityIds[1],
        bonusRuleId: ruleId,
        state: 'approved',
        proposedAt: expect.any(String),
        decidedAt: expect.any(String),
        decisionNote: '',
        evidenceIds: [evidence.taught],
      },
    ]);
  });

  it('records mentoring sessions by the panel and deletes only uncited evidence of its author', async () => {
    expect((await call(sessions.owner, 'POST', '/mentoring-sessions', { heldOn: '2027-01-15', notes: 'x', experimentIds: [] })).statusCode).toBe(403);
    const recorded = await call(sessions.leader, 'POST', '/mentoring-sessions', {
      heldOn: '2027-01-15',
      notes: 'Revisamos el avance',
      experimentIds: [],
    });
    expect(recorded.statusCode).toBe(201);
    expect((await view(sessions.owner)).mentoringSessions).toEqual([
      { id: recorded.json().mentoringSessionId, heldOn: '2027-01-15', notes: 'Revisamos el avance', recordedByName: expect.any(String), experimentIds: [] },
    ]);
    expect(
      (await call(sessions.leader, 'POST', '/mentoring-sessions', { heldOn: '2027-01-15', notes: '', experimentIds: [board.boardId] })).json(),
    ).toEqual({ error: 'unknown_reference' });

    const loose = (await record(sessions.owner, { description: 'Borrador' })).json().evidenceId;
    expect((await call(sessions.leader, 'DELETE', `/evidence/${loose}`)).statusCode).toBe(403);
    expect((await call(sessions.owner, 'DELETE', `/evidence/${evidence.owner}`)).json()).toEqual({ error: 'evidence_cited' });
    expect((await call(sessions.owner, 'DELETE', `/evidence/${loose}`)).statusCode).toBe(204);
  });

  it('INV-9 keeps all of it away from anyone off the board', async () => {
    expect((await call(sessions.administrator, 'GET', '')).statusCode).toBe(404);
    expect((await call(sessions.administrator, 'POST', `/level-proposals/${proposalId}/decision`, { approve: false })).statusCode).toBe(404);
    expect((await call(sessions.otherParticipant, 'POST', '/mentoring-sessions', { heldOn: '2027-01-15', notes: '', experimentIds: [] })).statusCode).toBe(404);
  });
});
