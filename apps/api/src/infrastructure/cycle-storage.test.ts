import pg from 'pg';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { giveBaseline, seedBoard, seedProgram, type SeededBoard, type SeededProgram } from '../../test-support/seed-program.ts';
import { createSeeder } from '../../test-support/seed.ts';

async function expectRefused(attempt: Promise<unknown>, pattern: RegExp): Promise<void> {
  await expect(attempt).rejects.toThrow(pattern);
}

describe('cycle storage', () => {
  let ownerPool: pg.Pool;
  let appPool: pg.Pool;
  let seed: ReturnType<typeof createSeeder>;
  let program: SeededProgram;
  let board: SeededBoard;
  let administrator: string;
  let otherOrganization: string;
  let cycleId: string;
  let focusIds: string[];
  let experimentIds: string[];

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
  const newCycle = (personId: string, boardId = board.boardId) =>
    one(
      personId,
      "insert into cycles (organization_id, board_id, starts_on, ends_on) values ($1, $2, date '2026-12-01', date '2027-02-28') returning id, number, state",
      [program.organizationId, boardId],
    );
  const addFocus = (personId: string, capability: number, level: number) =>
    one(personId, 'insert into focuses (organization_id, cycle_id, capability_id, target_level_id) values ($1, $2, $3, $4) returning id', [
      program.organizationId,
      cycleId,
      program.capabilityIds[capability],
      program.levelIds[level],
    ]);
  const addExperiment = (personId: string, focusId: string) =>
    one(
      personId,
      "insert into experiments (organization_id, focus_id, description, expected_result) values ($1, $2, 'Facilitar la revisión del sprint', 'El equipo decide con datos') returning id",
      [program.organizationId, focusId],
    );
  const start = (personId: string) => one(personId, 'select app_start_cycle($1)', [cycleId]);
  const state = async () =>
    (
      await ownerPool.query(
        'select c.state as cycle, b.status as board from cycles c join boards b on b.id = c.board_id where c.id = $1',
        [cycleId],
      )
    ).rows[0];

  beforeAll(async () => {
    ownerPool = new pg.Pool({ connectionString: inject('ownerDatabaseUrl') });
    appPool = new pg.Pool({ connectionString: inject('appDatabaseUrl') });
    seed = createSeeder(ownerPool);
    const organization = await seed.organization();
    otherOrganization = await seed.organization();
    program = await seedProgram(ownerPool, organization);
    await ownerPool.query('update programs set max_focuses = 2 where id = $1', [program.programId]);
    board = await seedBoard(ownerPool, program, (organizationId) => seed.person(organizationId));
    // Both capabilities of the board at the first level, then a baseline.
    await ownerPool.query('update placements set level_id = $1 where board_id = $2', [program.levelIds[0], board.boardId]);
    await giveBaseline(ownerPool, board.boardId, 'calibrated');
    administrator = await seed.person(organization);
    await seed.membership(organization, administrator, 'administrator');
  });

  afterAll(async () => {
    await appPool.end();
    await ownerPool.end();
  });

  it('opens a planned cycle on a board with a baseline, one at a time, for its owner and panel only', async () => {
    const early = await seedBoard(ownerPool, program, (organizationId) => seed.person(organizationId));
    await expectRefused(newCycle(early.owner, early.boardId), /baseline/);
    await expectRefused(newCycle(administrator), /row-level security/);
    await expectRefused(newCycle(board.otherParticipant), /row-level security/);

    const created = await newCycle(board.owner);
    cycleId = created.rows[0].id;
    expect(created.rows[0]).toMatchObject({ number: 1, state: 'planned' });
    await expectRefused(newCycle(board.leader), /cycles_one_open_per_board/);
    await expectRefused(one(board.owner, "update cycles set state = 'active' where id = $1", [cycleId]), /permission denied/);
  });

  it('INV-8 takes focuses above the current level, up to the program maximum', async () => {
    await expectRefused(addFocus(board.owner, 0, 0), /above the current level/);
    await expectRefused(addFocus(board.owner, 2, 1), /not on the board/);
    focusIds = [(await addFocus(board.owner, 0, 1)).rows[0].id];
    await expectRefused(addFocus(board.leader, 0, 1), /focuses_one_per_capability/);
    // A third capability joins the board at level 0, so it could be a focus but for the maximum.
    await ownerPool.query('insert into placements (organization_id, board_id, capability_id, added_by) values ($1, $2, $3, $4)', [
      program.organizationId,
      board.boardId,
      program.capabilityIds[2],
      board.leader,
    ]);
    await expectRefused(addFocus(board.leader, 2, 1), /above the current level/);
    focusIds.push((await addFocus(board.leader, 1, 1)).rows[0].id);
    await one(board.leader, 'select app_record_initial_level($1, $2, $3)', [board.boardId, program.capabilityIds[2], program.levelIds[0]]);
    await expectRefused(addFocus(board.leader, 2, 1), /invariant 8: .*maximum/);
  });

  it('INV-8 starts only by the panel, when every focus has an experiment', async () => {
    await expectRefused(start(board.owner), /only a panel member/);
    await expectRefused(start(administrator), /only a panel member/);
    experimentIds = [(await addExperiment(board.owner, focusIds[0]!)).rows[0].id];
    await expectRefused(start(board.leader), /invariant 8: .*experiment/);
    expect(await state()).toEqual({ cycle: 'planned', board: 'calibrated' });

    experimentIds.push((await addExperiment(board.leader, focusIds[1]!)).rows[0].id);
    await start(board.leader);

    expect(await state()).toEqual({ cycle: 'active', board: 'in_cycle' });
    await expectRefused(start(board.leader), /planned/);
  });

  it('INV-8 an active cycle keeps its focuses and experiments; more experiments may join', async () => {
    await expectRefused(addFocus(board.owner, 2, 1), /only while it is planned/);
    await expectRefused(one(board.owner, 'delete from focuses where id = $1', [focusIds[0]]), /only while it is planned/);
    await expectRefused(one(board.owner, 'delete from experiments where id = $1', [experimentIds[0]]), /invariant 8/);
    await expectRefused(one(board.leader, 'delete from cycles where id = $1', [cycleId]), /planned/);
    experimentIds.push((await addExperiment(board.owner, focusIds[0]!)).rows[0].id);
  });

  it('moves experiments from planned to in progress to reviewed by the panel, for good', async () => {
    const move = (personId: string, id: string, set: string) => one(personId, `update experiments set ${set} where id = $1`, [id]);

    await move(board.owner, experimentIds[0]!, "state = 'in_progress'");
    await expectRefused(move(board.owner, experimentIds[0]!, "state = 'reviewed', result = 'consolidated'"), /only a panel member/);
    await expectRefused(move(board.leader, experimentIds[0]!, "state = 'reviewed'"), /result/);
    await move(board.leader, experimentIds[0]!, "state = 'reviewed', result = 'consolidated', learnings = 'Datos antes de opinar'");
    await expectRefused(move(board.leader, experimentIds[0]!, "learnings = 'otra'"), /reviewed experiment is final/);
    await expectRefused(move(board.leader, experimentIds[1]!, "state = 'reviewed', result = 'consolidated'"), /discarded/);
    await move(board.leader, experimentIds[1]!, "state = 'reviewed', result = 'discarded'");
    await expectRefused(move(board.owner, experimentIds[2]!, "state = 'reviewed', result = 'discarded'"), /only a panel member/);

    const reviewed = await ownerPool.query(
      'select state, result, learnings, reviewed_by, reviewed_at is not null as dated from experiments where id = $1',
      [experimentIds[0]],
    );
    expect(reviewed.rows).toEqual([
      { state: 'reviewed', result: 'consolidated', learnings: 'Datos antes de opinar', reviewed_by: board.leader, dated: true },
    ]);
  });

  it('INV-9 only the owner and their panel read cycles, focuses and experiments', async () => {
    const seenBy = async (personId: string, organizationId = program.organizationId) =>
      (
        await as(
          personId,
          ['cycles', 'focuses', 'experiments'].map((table) => [`select count(*)::int as n from ${table}`] as [string]),
          organizationId,
        )
      ).map((result) => result.rows[0].n);
    expect(await seenBy(board.owner)).toEqual([1, 2, 3]);
    expect(await seenBy(board.leader)).toEqual([1, 2, 3]);
    expect(await seenBy(administrator)).toEqual([0, 0, 0]);
    expect(await seenBy(board.otherParticipant)).toEqual([0, 0, 0]);
  });

  it('INV-11 nothing of a cycle is seen from another organization', async () => {
    const results = await as(
      board.owner,
      ['cycles', 'focuses', 'experiments'].map((table) => [`select count(*)::int as n from ${table}`] as [string]),
      otherOrganization,
    );
    expect(results.map((result) => result.rows[0].n)).toEqual([0, 0, 0]);
  });
});
