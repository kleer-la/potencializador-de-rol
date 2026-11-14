import pg from 'pg';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { giveBaseline, seedBoard, seedProgram, type SeededBoard, type SeededProgram } from '../../test-support/seed-program.ts';
import { createSeeder } from '../../test-support/seed.ts';

async function expectRefused(attempt: Promise<unknown>, pattern: RegExp): Promise<void> {
  await expect(attempt).rejects.toThrow(pattern);
}

describe('closing, recalibration and snapshots storage', () => {
  let ownerPool: pg.Pool;
  let appPool: pg.Pool;
  let seed: ReturnType<typeof createSeeder>;
  let program: SeededProgram;
  let board: SeededBoard;
  let administrator: string;
  let otherOrganization: string;
  let cycleId: string;
  let evidenceId: string;
  let openProposal: string;
  let baselineBefore: unknown;
  const baselineRows = async () => ({
    entries: (
      await ownerPool.query('select capability_id, level_id, origin, set_at from baseline_entries where board_id = $1 order by capability_id', [
        board.boardId,
      ])
    ).rows,
    setAt: (await ownerPool.query('select baseline_set_at from boards where id = $1', [board.boardId])).rows[0].baseline_set_at,
  });

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
  const recalibrate = (personId: string, attendees: string[], levels: [number, number][]) =>
    one(personId, "select app_recalibrate_board($1, date '2027-03-05', 'Revisión del trimestre', $2::uuid[], $3::jsonb) as id", [
      board.boardId,
      attendees,
      JSON.stringify(levels.map(([capability, level]) => ({ capabilityId: program.capabilityIds[capability], levelId: program.levelIds[level] }))),
    ]);
  const boardStatus = async () => (await ownerPool.query('select status from boards where id = $1', [board.boardId])).rows[0].status;
  const snapshots = async () =>
    (
      await ownerPool.query(
        'select kind, capability_count, score::float as score from snapshots where board_id = $1 order by taken_at',
        [board.boardId],
      )
    ).rows;

  beforeAll(async () => {
    ownerPool = new pg.Pool({ connectionString: inject('ownerDatabaseUrl') });
    appPool = new pg.Pool({ connectionString: inject('appDatabaseUrl') });
    seed = createSeeder(ownerPool);
    const organization = await seed.organization();
    otherOrganization = await seed.organization();
    program = await seedProgram(ownerPool, organization);
    await ownerPool.query("update programs set mandatory_panel_roles = '{leader}' where id = $1", [program.programId]);
    board = await seedBoard(ownerPool, program, (organizationId) => seed.person(organizationId));
    await ownerPool.query('update placements set level_id = $1 where board_id = $2', [program.levelIds[0], board.boardId]);
    await giveBaseline(ownerPool, board.boardId, 'calibrated');
    // The baseline entries a calibration would have recorded, to prove a recalibration keeps them.
    await ownerPool.query(
      "insert into baseline_entries (organization_id, board_id, capability_id, level_id, origin) select organization_id, board_id, capability_id, level_id, 'calibration' from placements where board_id = $1",
      [board.boardId],
    );
    baselineBefore = await baselineRows();
    administrator = await seed.person(organization);
    await seed.membership(organization, administrator, 'administrator');

    // An active cycle; the first capability rises to level 1 with evidence and earns the bonus.
    cycleId = (
      await ownerPool.query(
        "insert into cycles (organization_id, board_id, starts_on, ends_on, created_by) values ($1, $2, date '2026-12-01', date '2027-02-28', $3) returning id",
        [program.organizationId, board.boardId, board.owner],
      )
    ).rows[0].id;
    const focus = (
      await ownerPool.query(
        'insert into focuses (organization_id, cycle_id, capability_id, target_level_id, created_by) values ($1, $2, $3, $4, $5) returning id',
        [program.organizationId, cycleId, program.capabilityIds[0], program.levelIds[1], board.owner],
      )
    ).rows[0].id;
    await ownerPool.query("insert into experiments (organization_id, focus_id, description, created_by) values ($1, $2, 'Probar', $3)", [
      program.organizationId,
      focus,
      board.owner,
    ]);
    await one(board.leader, 'select app_start_cycle($1)', [cycleId]);
    evidenceId = (
      await one(
        board.owner,
        "insert into evidence (organization_id, board_id, description, occurred_on) values ($1, $2, 'Lo logró', current_date) returning id",
        [program.organizationId, board.boardId],
      )
    ).rows[0].id;
    const proposal = (
      await one(board.owner, 'select app_propose_level_change($1, $2, $3, $4::uuid[]) as id', [
        board.boardId,
        program.capabilityIds[0],
        program.levelIds[1],
        [evidenceId],
      ])
    ).rows[0].id;
    await one(board.leader, "select app_decide_level_change($1, true, '')", [proposal]);
    const rule = (await ownerPool.query('select id from bonus_rules where map_id = $1', [program.mapId])).rows[0].id;
    const bonus = (
      await one(board.owner, 'select app_propose_bonus($1, $2, $3, $4::uuid[]) as id', [board.boardId, program.capabilityIds[0], rule, [evidenceId]])
    ).rows[0].id;
    await one(board.leader, "select app_decide_bonus($1, true, '')", [bonus]);
  });

  afterAll(async () => {
    await appPool.end();
    await ownerPool.end();
  });

  it('refuses a recalibration during a cycle, and lets only the panel close the active cycle with a snapshot', async () => {
    await expectRefused(recalibrate(board.leader, [board.owner, board.leader], [[0, 0], [1, 0]]), /between cycles/);
    await expectRefused(one(board.owner, 'select app_close_cycle($1)', [cycleId]), /only a panel member/);
    await expectRefused(one(administrator, 'select app_close_cycle($1)', [cycleId]), /only a panel member/);

    await one(board.leader, 'select app_close_cycle($1)', [cycleId]);

    expect(await boardStatus()).toBe('between_cycles');
    const cycle = await ownerPool.query('select state from cycles where id = $1', [cycleId]);
    expect(cycle.rows[0].state).toBe('closed');
    // Level 1 (multiplier 1) plus the approved bonus (+1); the other capability is at 0.
    expect(await snapshots()).toEqual([{ kind: 'cycle_close', capability_count: 2, score: 2 }]);
    const entries = await ownerPool.query(
      'select capability_id, level_id, multiplier::float as multiplier, bonus_points::float as bonus_points from snapshot_entries e join snapshots s on s.id = e.snapshot_id where s.board_id = $1 order by bonus_points desc',
      [board.boardId],
    );
    expect(entries.rows).toEqual([
      { capability_id: program.capabilityIds[0], level_id: program.levelIds[1], multiplier: 1, bonus_points: 1 },
      { capability_id: program.capabilityIds[1], level_id: program.levelIds[0], multiplier: 0, bonus_points: 0 },
    ]);
    await expectRefused(one(board.leader, 'select app_close_cycle($1)', [cycleId]), /active/);
  });

  it('INV-4 recalibrates between cycles with the attendance of the calibration; levels may go down, once', async () => {
    await expectRefused(recalibrate(board.owner, [board.owner, board.leader], [[0, 0], [1, 0]]), /only a panel member/);
    await expectRefused(recalibrate(board.leader, [board.owner], [[0, 0], [1, 0]]), /invariant 3: .*leader/);
    await expectRefused(recalibrate(board.leader, [board.owner, board.leader], [[0, 0]]), /every capability on the board/);

    await recalibrate(board.leader, [board.owner, board.leader], [[0, 0], [1, 1]]);

    const changes = await ownerPool.query(
      "select c.previous_level_id, c.new_level_id, c.approved_by from level_changes c join placements p on p.id = c.placement_id where p.board_id = $1 and c.reason = 'recalibration' order by c.new_level_id = $2",
      [board.boardId, program.levelIds[0]],
    );
    expect(changes.rows).toHaveLength(2);
    expect(changes.rows).toEqual(
      expect.arrayContaining([
        { previous_level_id: program.levelIds[1], new_level_id: program.levelIds[0], approved_by: board.leader },
        { previous_level_id: program.levelIds[0], new_level_id: program.levelIds[1], approved_by: board.leader },
      ]),
    );
    // Capability 0 went down to 0 but keeps its bonus; capability 1 rose to 1.
    expect((await snapshots()).at(-1)).toEqual({ kind: 'recalibration', capability_count: 2, score: 2 });
    await expectRefused(recalibrate(board.leader, [board.owner, board.leader], [[0, 1], [1, 1]]), /one recalibration/);
  });

  it('INV-3 a recalibration does not replace the baseline, and snapshots never change', async () => {
    expect(await baselineRows()).toEqual(baselineBefore);
    expect((baselineBefore as { entries: unknown[] }).entries).toHaveLength(2);
    for (const table of ['snapshots', 'snapshot_entries', 'recalibration_sessions', 'recalibration_attendees']) {
      await expectRefused(one(board.leader, `update ${table} set organization_id = organization_id`), /permission denied/);
      await expectRefused(ownerPool.query(`update ${table} set organization_id = organization_id`), /never/);
      await expectRefused(ownerPool.query(`delete from ${table}`), /never/);
    }
  });

  it('closes the board for the panel only, with no cycle open, and then nothing changes on it', async () => {
    const planned = (
      await ownerPool.query(
        "insert into cycles (organization_id, board_id, starts_on, ends_on, created_by) values ($1, $2, date '2027-04-01', date '2027-06-30', $3) returning id",
        [program.organizationId, board.boardId, board.owner],
      )
    ).rows[0].id;
    await expectRefused(one(board.leader, 'select app_close_board($1)', [board.boardId]), /cycle open/);
    await ownerPool.query('delete from cycles where id = $1', [planned]);
    openProposal = (
      await one(board.owner, 'select app_propose_level_change($1, $2, $3, $4::uuid[]) as id', [
        board.boardId,
        program.capabilityIds[0],
        program.levelIds[1],
        [evidenceId],
      ])
    ).rows[0].id;
    await expectRefused(one(board.owner, 'select app_close_board($1)', [board.boardId]), /only a panel member/);

    await one(board.leader, 'select app_close_board($1)', [board.boardId]);

    expect(await boardStatus()).toBe('closed');
    await expectRefused(one(board.leader, "select app_decide_level_change($1, true, '')", [openProposal]), /board is closed/);
    await expectRefused(
      one(board.owner, 'select app_propose_level_change($1, $2, $3, $4::uuid[])', [
        board.boardId,
        program.capabilityIds[0],
        program.levelIds[1],
        [evidenceId],
      ]),
      /board is closed/,
    );
    const rule = (await ownerPool.query('select id from bonus_rules where map_id = $1', [program.mapId])).rows[0].id;
    await expectRefused(
      one(board.owner, 'select app_propose_bonus($1, $2, $3, $4::uuid[])', [board.boardId, program.capabilityIds[1], rule, [evidenceId]]),
      /board is closed/,
    );
    await expectRefused(
      one(board.owner, "insert into evidence (organization_id, board_id, description, occurred_on) values ($1, $2, 'x', current_date)", [
        program.organizationId,
        board.boardId,
      ]),
      /board is closed/,
    );
    await expectRefused(
      one(board.leader, 'insert into placements (organization_id, board_id, capability_id, added_by) values ($1, $2, $3, $4)', [
        program.organizationId,
        board.boardId,
        program.capabilityIds[2],
        board.leader,
      ]),
      /board is closed/,
    );
    await expectRefused(
      one(board.owner, "insert into cycles (organization_id, board_id, starts_on, ends_on) values ($1, $2, date '2027-07-01', date '2027-08-01')", [
        program.organizationId,
        board.boardId,
      ]),
      /open board/,
    );
    await expectRefused(
      one(board.leader, "select app_record_mentoring($1, current_date, '', '{}'::uuid[])", [board.boardId]),
      /board is closed/,
    );
    await expectRefused(one(administrator, "update boards set status = 'between_cycles' where id = $1", [board.boardId]), /closed/);
    await expectRefused(ownerPool.query("update boards set status = 'between_cycles' where id = $1", [board.boardId]), /closed/);
  });

  it('INV-9 INV-11 only the owner and their panel read snapshots and recalibrations', async () => {
    const tables = ['snapshots', 'snapshot_entries', 'recalibration_sessions', 'recalibration_attendees'];
    const seenBy = async (personId: string, organizationId = program.organizationId) =>
      (await as(personId, tables.map((table) => [`select count(*)::int as n from ${table}`] as [string]), organizationId)).map(
        (result) => result.rows[0].n,
      );
    expect(await seenBy(board.owner)).toEqual([2, 4, 1, 2]);
    expect(await seenBy(board.leader)).toEqual([2, 4, 1, 2]);
    expect(await seenBy(administrator)).toEqual([0, 0, 0, 0]);
    expect(await seenBy(board.otherParticipant)).toEqual([0, 0, 0, 0]);
    expect(await seenBy(board.owner, otherOrganization)).toEqual([0, 0, 0, 0]);
  });
});
