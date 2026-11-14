import pg from 'pg';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { seedMap } from '../../test-support/seed-map.ts';
import { giveBaseline, seedBoard, seedProgram, type SeededBoard, type SeededProgram } from '../../test-support/seed-program.ts';
import { createSeeder } from '../../test-support/seed.ts';

async function expectRefused(attempt: Promise<unknown>, pattern: RegExp): Promise<void> {
  await expect(attempt).rejects.toThrow(pattern);
}

describe('evidence, level changes, bonuses and mentoring storage', () => {
  let ownerPool: pg.Pool;
  let appPool: pg.Pool;
  let seed: ReturnType<typeof createSeeder>;
  let program: SeededProgram;
  let board: SeededBoard;
  let administrator: string;
  let otherOrganization: string;
  let transferLevel: string;
  let rules: string[];
  const evidence: Record<string, string> = {};
  let proposalId: string;

  const as = async (personId: string, statements: [string, unknown[]?][], organizationId = program.organizationId) => {
    const client = await appPool.connect();
    try {
      await client.query('begin');
      await client.query(
        "select set_config('app.person_id', $1, true), set_config('app.organization_id', $2, true)",
        [personId, organizationId],
      );
      const results: pg.QueryResult[] = [];
      for (const [text, values] of statements) results.push(await client.query(text, values));
      await client.query('commit');
      return results;
    } catch (error) {
      await client.query('rollback');
      throw error;
    } finally {
      client.release();
    }
  };
  const one = async (personId: string, text: string, values?: unknown[]) => (await as(personId, [[text, values]]))[0]!;
  const record = async (personId: string, description: string, showsTransfer = false, boardId = board.boardId) =>
    (
      await one(
        personId,
        "insert into evidence (organization_id, board_id, description, occurred_on, shows_transfer, author) values ($1, $2, $3, date '2026-12-10', $4, $5) returning id",
        [program.organizationId, boardId, description, showsTransfer, personId],
      )
    ).rows[0].id as string;
  const propose = (personId: string, capability: number, levelId: string, evidenceIds: string[]) =>
    one(personId, 'select app_propose_level_change($1, $2, $3, $4::uuid[]) as id', [
      board.boardId,
      program.capabilityIds[capability],
      levelId,
      evidenceIds,
    ]);
  const decide = (personId: string, id: string, approve: boolean) =>
    one(personId, "select app_decide_level_change($1, $2, 'Visto en la mentoría')", [id, approve]);
  const levelOf = async (capability: number) =>
    (
      await ownerPool.query('select level_id from placements where board_id = $1 and capability_id = $2', [
        board.boardId,
        program.capabilityIds[capability],
      ])
    ).rows[0].level_id;
  /** Test setup only: a published map admits no new level or rule, so the guards are skipped. */
  const intoPublishedMap = async (statement: string, values: unknown[]) => {
    const client = await ownerPool.connect();
    try {
      await client.query('set session_replication_role = replica');
      return (await client.query<{ id: string }>(statement, values)).rows[0]!.id;
    } finally {
      await client.query('set session_replication_role = origin');
      client.release();
    }
  };

  beforeAll(async () => {
    ownerPool = new pg.Pool({ connectionString: inject('ownerDatabaseUrl') });
    appPool = new pg.Pool({ connectionString: inject('appDatabaseUrl') });
    seed = createSeeder(ownerPool);
    const organization = await seed.organization();
    otherOrganization = await seed.organization();
    program = await seedProgram(ownerPool, organization);
    transferLevel = await intoPublishedMap(
      "insert into levels (organization_id, map_id, position, name, multiplier, requires_transfer) values ($1, $2, 2, 'Enseña', 2, true) returning id",
      [organization, program.mapId],
    );
    const firstRule = (await ownerPool.query('select id from bonus_rules where map_id = $1', [program.mapId])).rows[0].id;
    const secondRule = await intoPublishedMap(
      "insert into bonus_rules (organization_id, map_id, name, extra_points, condition) values ($1, $2, 'Transfirió', 1, 'Enseñó la práctica') returning id",
      [organization, program.mapId],
    );
    rules = [firstRule, secondRule];
    board = await seedBoard(ownerPool, program, (organizationId) => seed.person(organizationId));
    await ownerPool.query('update placements set level_id = $1 where board_id = $2', [program.levelIds[0], board.boardId]);
    await giveBaseline(ownerPool, board.boardId, 'calibrated');
    administrator = await seed.person(organization);
    await seed.membership(organization, administrator, 'administrator');
  });

  afterAll(async () => {
    await appPool.end();
    await ownerPool.end();
  });

  it('records evidence by owner and panel, as the person acting, and never edits it', async () => {
    evidence.owner = await record(board.owner, 'Facilitó la revisión del sprint con datos');
    evidence.leader = await one(
      board.leader,
      "insert into evidence (organization_id, board_id, description, occurred_on, author) values ($1, $2, 'Vi la revisión', date '2026-12-11', $3) returning id, author",
      [program.organizationId, board.boardId, board.owner],
    ).then((result) => {
      expect(result.rows[0].author).toBe(board.leader);
      return result.rows[0].id as string;
    });
    evidence.taught = await record(board.owner, 'Enseñó la técnica a dos compañeros', true);
    await expectRefused(record(administrator, 'x'), /row-level security/);
    await expectRefused(record(board.otherParticipant, 'x'), /row-level security/);
    await expectRefused(
      one(board.owner, "insert into evidence (organization_id, board_id, description, occurred_on, link) values ($1, $2, 'x', current_date, 'javascript:alert(1)')", [
        program.organizationId,
        board.boardId,
      ]),
      /evidence_link_web/,
    );
    await expectRefused(one(board.owner, "update evidence set description = 'otra' where id = $1", [evidence.owner]), /permission denied/);
    const early = await seedBoard(ownerPool, program, (organizationId) => seed.person(organizationId));
    await expectRefused(record(early.owner, 'x', false, early.boardId), /after the baseline/);
  });

  it('INV-4 INV-5 the owner proposes with evidence a level above the current one; the panel does not propose', async () => {
    await expectRefused(propose(board.leader, 0, program.levelIds[1]!, [evidence.owner!]), /only the owner/);
    await expectRefused(propose(board.owner, 0, program.levelIds[1]!, []), /invariant 4: .*evidence/);
    await expectRefused(propose(board.owner, 0, program.levelIds[0]!, [evidence.owner!]), /above the current level/);
    const other = await seedBoard(ownerPool, program, (organizationId) => seed.person(organizationId));
    await ownerPool.query('update placements set level_id = $1 where board_id = $2', [program.levelIds[0], other.boardId]);
    await giveBaseline(ownerPool, other.boardId, 'calibrated');
    const foreign = await record(other.owner, 'De otro tablero', false, other.boardId);
    await expectRefused(propose(board.owner, 0, program.levelIds[1]!, [foreign]), /evidence of this board/);

    proposalId = (await propose(board.owner, 0, program.levelIds[1]!, [evidence.owner!, evidence.leader!])).rows[0].id;
    await expectRefused(propose(board.owner, 0, transferLevel, [evidence.taught!]), /level_change_proposals_one_open/);
    expect(await levelOf(0)).toBe(program.levelIds[0]);
  });

  it('INV-5 only a panel member decides; approving records the level change with its evidence', async () => {
    await expectRefused(decide(board.owner, proposalId, true), /only a panel member/);
    await expectRefused(decide(administrator, proposalId, true), /only a panel member/);
    await decide(board.leader, proposalId, true);

    expect(await levelOf(0)).toBe(program.levelIds[1]);
    const change = await ownerPool.query(
      'select reason, previous_level_id, new_level_id, approved_by, proposal_id from level_changes where proposal_id = $1',
      [proposalId],
    );
    expect(change.rows).toEqual([
      { reason: 'evidence', previous_level_id: program.levelIds[0], new_level_id: program.levelIds[1], approved_by: board.leader, proposal_id: proposalId },
    ]);
    const cited = await ownerPool.query('select count(*)::int as n from proposal_evidence where proposal_id = $1', [proposalId]);
    expect(cited.rows[0].n).toBe(2);
    await expectRefused(decide(board.leader, proposalId, false), /already decided/);
    await expectRefused(one(board.leader, "update level_change_proposals set state = 'rejected' where id = $1", [proposalId]), /permission denied/);
    await expectRefused(ownerPool.query("update level_change_proposals set state = 'rejected' where id = $1", [proposalId]), /decided/);
  });

  it('INV-6 a level that requires transfer needs evidence of having taught others', async () => {
    await expectRefused(propose(board.owner, 0, transferLevel, [evidence.owner!]), /invariant 6/);
    const open = (await propose(board.owner, 0, transferLevel, [evidence.taught!])).rows[0].id;
    await decide(board.leader, open, false);

    expect(await levelOf(0)).toBe(program.levelIds[1]);
    const state = await ownerPool.query('select state, decided_by from level_change_proposals where id = $1', [open]);
    expect(state.rows).toEqual([{ state: 'rejected', decided_by: board.leader }]);
    // After a rejection the capability can be proposed again.
    await propose(board.owner, 0, transferLevel, [evidence.taught!]);
  });

  it('INV-7 a bonus cites evidence, counts at most once per rule and capability, and the panel decides', async () => {
    const proposeBonus = (personId: string, rule: string, evidenceIds: string[], capability = 1) =>
      one(personId, 'select app_propose_bonus($1, $2, $3, $4::uuid[]) as id', [
        board.boardId,
        program.capabilityIds[capability],
        rule,
        evidenceIds,
      ]);
    const decideBonus = (personId: string, id: string, approve: boolean) =>
      one(personId, "select app_decide_bonus($1, $2, '')", [id, approve]);

    await expectRefused(proposeBonus(board.owner, rules[0]!, []), /invariant 7/);
    await expectRefused(proposeBonus(board.leader, rules[0]!, [evidence.owner!]), /only the owner/);
    const foreignRule = (await seedMap(ownerPool, program.organizationId, 'published')).bonusRuleId;
    await expectRefused(proposeBonus(board.owner, foreignRule, [evidence.owner!]), /rule of the program map/);

    const first = (await proposeBonus(board.owner, rules[0]!, [evidence.owner!])).rows[0].id;
    await expectRefused(proposeBonus(board.owner, rules[0]!, [evidence.leader!]), /bonus_awards_one_per_rule/);
    await expectRefused(decideBonus(board.owner, first, true), /only a panel member/);
    await decideBonus(board.leader, first, true);
    await expectRefused(proposeBonus(board.owner, rules[0]!, [evidence.leader!]), /bonus_awards_one_per_rule/);

    const second = (await proposeBonus(board.owner, rules[1]!, [evidence.taught!])).rows[0].id;
    await decideBonus(board.leader, second, false);
    await proposeBonus(board.owner, rules[1]!, [evidence.taught!]);

    const awards = await ownerPool.query('select state from bonus_awards where board_id = $1 order by proposed_at', [board.boardId]);
    expect(awards.rows.map((row) => row.state)).toEqual(['approved', 'rejected', 'proposed']);
  });

  it('records mentoring sessions by the panel, with experiments of the board only', async () => {
    const cycle = (
      await ownerPool.query(
        "insert into cycles (organization_id, board_id, starts_on, ends_on, created_by) values ($1, $2, date '2027-01-01', date '2027-03-01', $3) returning id",
        [program.organizationId, board.boardId, board.owner],
      )
    ).rows[0].id;
    const focus = (
      await ownerPool.query(
        'insert into focuses (organization_id, cycle_id, capability_id, target_level_id, created_by) values ($1, $2, $3, $4, $5) returning id',
        [program.organizationId, cycle, program.capabilityIds[1], program.levelIds[1], board.owner],
      )
    ).rows[0].id;
    const experiment = (
      await ownerPool.query(
        "insert into experiments (organization_id, focus_id, description, created_by) values ($1, $2, 'Probar algo', $3) returning id",
        [program.organizationId, focus, board.owner],
      )
    ).rows[0].id;
    const session = (personId: string, experiments: string[]) =>
      one(personId, "select app_record_mentoring($1, date '2027-01-15', 'Revisamos el experimento', $2::uuid[]) as id", [
        board.boardId,
        experiments,
      ]);

    const fromExperiment = (experimentId: string) =>
      one(
        board.owner,
        "insert into evidence (organization_id, board_id, experiment_id, description, occurred_on) values ($1, $2, $3, 'Salió del experimento', current_date) returning id",
        [program.organizationId, board.boardId, experimentId],
      );
    expect((await fromExperiment(experiment)).rowCount).toBe(1);
    const elsewhere = await seedBoard(ownerPool, program, (organizationId) => seed.person(organizationId));
    await ownerPool.query('update placements set level_id = $1 where board_id = $2', [program.levelIds[0], elsewhere.boardId]);
    await giveBaseline(ownerPool, elsewhere.boardId, 'calibrated');
    const foreignCycle = (
      await ownerPool.query(
        "insert into cycles (organization_id, board_id, starts_on, ends_on, created_by) values ($1, $2, date '2027-01-01', date '2027-03-01', $3) returning id",
        [program.organizationId, elsewhere.boardId, elsewhere.owner],
      )
    ).rows[0].id;
    const foreignFocus = (
      await ownerPool.query(
        'insert into focuses (organization_id, cycle_id, capability_id, target_level_id, created_by) values ($1, $2, $3, $4, $5) returning id',
        [program.organizationId, foreignCycle, program.capabilityIds[0], program.levelIds[1], elsewhere.owner],
      )
    ).rows[0].id;
    const foreignExperiment = (
      await ownerPool.query(
        "insert into experiments (organization_id, focus_id, description, created_by) values ($1, $2, 'Ajeno', $3) returning id",
        [program.organizationId, foreignFocus, elsewhere.owner],
      )
    ).rows[0].id;
    await expectRefused(fromExperiment(foreignExperiment), /experiment is not of the board/);
    await expectRefused(session(board.leader, [foreignExperiment]), /experiment of the board/);
    await expectRefused(
      one(board.owner, 'select * from app_board_evidence($1, $2::uuid[])', [board.boardId, [evidence.owner]]),
      /permission denied/,
    );

    await expectRefused(session(board.owner, [experiment]), /only a panel member/);
    await expectRefused(session(board.leader, [cycle]), /experiment of the board/);
    const recorded = (await session(board.leader, [experiment])).rows[0].id;
    const reviewed = await ownerPool.query('select experiment_id from mentoring_session_experiments where mentoring_session_id = $1', [recorded]);
    expect(reviewed.rows).toEqual([{ experiment_id: experiment }]);
    await expectRefused(ownerPool.query("update mentoring_sessions set notes = 'x' where id = $1", [recorded]), /never edited/);
  });

  it('lets only the author delete evidence that nothing cites', async () => {
    const loose = await record(board.owner, 'Borrador de evidencia');
    await expectRefused(one(board.leader, 'delete from evidence where id = $1', [loose]), /only the author/);
    await expectRefused(one(board.owner, 'delete from evidence where id = $1', [evidence.owner]), /proposal_evidence|bonus_evidence/);
    expect((await one(board.owner, 'delete from evidence where id = $1', [loose])).rowCount).toBe(1);
  });

  it('INV-9 INV-11 only the owner and their panel read any of it, and nothing crosses organizations', async () => {
    const tables = ['evidence', 'level_change_proposals', 'proposal_evidence', 'bonus_awards', 'bonus_evidence', 'mentoring_sessions'];
    const seenBy = async (personId: string, organizationId = program.organizationId) =>
      (await as(personId, tables.map((table) => [`select count(*)::int as n from ${table}`] as [string]), organizationId)).map(
        (result) => result.rows[0].n,
      );
    const owner = await seenBy(board.owner);
    expect(owner.every((n) => n > 0)).toBe(true);
    expect(await seenBy(board.leader)).toEqual(owner);
    expect(await seenBy(administrator)).toEqual(tables.map(() => 0));
    expect(await seenBy(board.otherParticipant)).toEqual(tables.map(() => 0));
    expect(await seenBy(board.owner, otherOrganization)).toEqual(tables.map(() => 0));
  });
});
