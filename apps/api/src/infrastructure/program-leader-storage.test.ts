import pg from 'pg';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { enroll, giveBaseline, seedBoard, seedProgram, type SeededBoard, type SeededProgram } from '../../test-support/seed-program.ts';
import { createSeeder } from '../../test-support/seed.ts';

// Amendment of invariant 9 (user decision of 2026-11-23): a leader of the program reads
// every board of it, and writes none it is not on the panel of.
describe('program leader storage', () => {
  let ownerPool: pg.Pool;
  let appPool: pg.Pool;
  let program: SeededProgram;
  let board: SeededBoard;
  let programLeader: string;
  let otherProgramLeader: string;
  let cycleId: string;

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
  const count = async (personId: string, text: string, values?: unknown[]) => (await one(personId, text, values)).rowCount;

  beforeAll(async () => {
    ownerPool = new pg.Pool({ connectionString: inject('ownerDatabaseUrl') });
    appPool = new pg.Pool({ connectionString: inject('appDatabaseUrl') });
    const seed = createSeeder(ownerPool);
    const organization = await seed.organization();
    program = await seedProgram(ownerPool, organization);
    board = await seedBoard(ownerPool, program, (organizationId) => seed.person(organizationId));
    programLeader = await seed.person(organization);
    await enroll(ownerPool, program, programLeader, 'leader');
    const otherProgram = await seedProgram(ownerPool, organization);
    otherProgramLeader = await seed.person(organization);
    await enroll(ownerPool, otherProgram, otherProgramLeader, 'leader');
  });

  afterAll(async () => {
    await appPool.end();
    await ownerPool.end();
  });

  it('INV-9 lets a leader of the program off the panel read the board, and not a leader of another program', async () => {
    const organizationOf = 'select app_board_organization($1) as id';
    expect((await one(programLeader, organizationOf, [board.boardId])).rows[0].id).toBe(program.organizationId);
    expect((await one(otherProgramLeader, organizationOf, [board.boardId])).rows[0].id).toBeNull();
    expect(await count(programLeader, 'select * from placements where board_id = $1', [board.boardId])).toBe(2);
    expect(await count(otherProgramLeader, 'select * from placements where board_id = $1', [board.boardId])).toBe(0);
  });

  it('INV-9 lists the board for a leader of the program as a program board', async () => {
    const listed = await one(programLeader, 'select board_id, relation, panel_roles from app_my_boards()');
    const ofOther = await one(otherProgramLeader, 'select board_id from app_my_boards()');

    expect(listed.rows).toEqual([{ board_id: board.boardId, relation: 'program', panel_roles: [] }]);
    expect(ofOther.rows).toEqual([]);
    const ofPanelLeader = await one(board.leader, 'select relation from app_my_boards() where board_id = $1', [board.boardId]);
    expect(ofPanelLeader.rows).toEqual([{ relation: 'panel' }]);
  });

  it('INV-2 shows a leader of the program the self-assessment only once submitted', async () => {
    const [assessment] = (
      await one(board.owner, 'insert into self_assessments (organization_id, board_id) values ($1, $2) returning id', [
        program.organizationId,
        board.boardId,
      ])
    ).rows;
    for (const capabilityId of program.capabilityIds.slice(0, 2)) {
      await one(
        board.owner,
        'insert into self_assessment_levels (organization_id, self_assessment_id, capability_id, level_id) values ($1, $2, $3, $4)',
        [program.organizationId, assessment.id, capabilityId, program.levelIds[0]],
      );
    }
    const visible = async () => [
      await count(programLeader, 'select * from self_assessments where board_id = $1', [board.boardId]),
      await count(programLeader, 'select * from self_assessment_levels where self_assessment_id = $1', [assessment.id]),
    ];

    expect(await visible()).toEqual([0, 0]);
    await one(board.owner, 'select app_submit_self_assessment($1)', [board.boardId]);
    expect(await visible()).toEqual([1, 2]);
  });

  it('INV-9 refuses every write of a leader of the program off the panel', async () => {
    await ownerPool.query('update placements set level_id = $1 where board_id = $2', [program.levelIds[0], board.boardId]);
    await giveBaseline(ownerPool, board.boardId, 'calibrated');
    cycleId = (
      await one(
        board.owner,
        "insert into cycles (organization_id, board_id, starts_on, ends_on) values ($1, $2, date '2026-12-01', date '2027-02-28') returning id",
        [program.organizationId, board.boardId],
      )
    ).rows[0].id;
    await one(board.owner, 'insert into focuses (organization_id, cycle_id, capability_id, target_level_id) values ($1, $2, $3, $4)', [
      program.organizationId,
      cycleId,
      program.capabilityIds[0],
      program.levelIds[1],
    ]);

    expect(await count(programLeader, 'select * from cycles where board_id = $1', [board.boardId])).toBe(1);
    expect(await count(programLeader, 'select * from focuses where cycle_id = $1', [cycleId])).toBe(1);
    await expect(
      one(
        programLeader,
        "insert into cycles (organization_id, board_id, starts_on, ends_on) values ($1, $2, date '2027-03-01', date '2027-04-30')",
        [program.organizationId, board.boardId],
      ),
    ).rejects.toThrow(/row-level security/);
    await expect(
      one(programLeader, 'insert into focuses (organization_id, cycle_id, capability_id, target_level_id) values ($1, $2, $3, $4)', [
        program.organizationId,
        cycleId,
        program.capabilityIds[1],
        program.levelIds[1],
      ]),
    ).rejects.toThrow(/row-level security/);
    await expect(
      one(programLeader, 'insert into placements (organization_id, board_id, capability_id, added_by) values ($1, $2, $3, $4)', [
        program.organizationId,
        board.boardId,
        program.capabilityIds[2],
        programLeader,
      ]),
    ).rejects.toThrow(/row-level security/);
    expect(await count(programLeader, 'update placements set level_id = $2 where board_id = $1', [board.boardId, program.levelIds[1]])).toBe(0);
    expect(await count(programLeader, 'delete from focuses where cycle_id = $1', [cycleId])).toBe(0);
    expect(await count(programLeader, 'delete from cycles where id = $1', [cycleId])).toBe(0);
  });
});
