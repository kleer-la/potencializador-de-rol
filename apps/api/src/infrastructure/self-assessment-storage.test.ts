import pg from 'pg';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { seedMap } from '../../test-support/seed-map.ts';
import { seedBoard, seedProgram, type SeededBoard, type SeededProgram } from '../../test-support/seed-program.ts';
import { createSeeder } from '../../test-support/seed.ts';

async function expectAllRefused(attempts: Promise<unknown>[], pattern: RegExp): Promise<void> {
  const outcomes = await Promise.allSettled(attempts);
  for (const outcome of outcomes) {
    expect(outcome.status).toBe('rejected');
    expect(String((outcome as PromiseRejectedResult).reason?.message)).toMatch(pattern);
  }
}

describe('self-assessment storage', () => {
  let ownerPool: pg.Pool;
  let appPool: pg.Pool;
  let seed: ReturnType<typeof createSeeder>;
  let program: SeededProgram;
  let board: SeededBoard;
  let administrator: string;
  let selfAssessmentId: string;

  const as = async (personId: string, statements: [string, unknown[]?][]): Promise<pg.QueryResult[]> => {
    const client = await appPool.connect();
    try {
      await client.query('begin');
      await client.query(
        "select set_config('app.person_id', $1, true), set_config('app.organization_id', $2, true)",
        [personId, program.organizationId],
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
  const propose = (personId: string, capabilityId: string, levelId: string) =>
    one(
      personId,
      'insert into self_assessment_levels (organization_id, self_assessment_id, capability_id, level_id) values ($1, $2, $3, $4) on conflict (self_assessment_id, capability_id) do update set level_id = excluded.level_id',
      [program.organizationId, selfAssessmentId, capabilityId, levelId],
    );
  const seen = async (personId: string) =>
    (await one(personId, 'select id from self_assessments where board_id = $1', [board.boardId])).rowCount;

  beforeAll(async () => {
    ownerPool = new pg.Pool({ connectionString: inject('ownerDatabaseUrl') });
    appPool = new pg.Pool({ connectionString: inject('appDatabaseUrl') });
    seed = createSeeder(ownerPool);
    const organization = await seed.organization();
    program = await seedProgram(ownerPool, organization);
    board = await seedBoard(ownerPool, program, (organizationId) => seed.person(organizationId));
    administrator = await seed.person(organization);
    await seed.membership(organization, administrator, 'administrator');
  });

  afterAll(async () => {
    await appPool.end();
    await ownerPool.end();
  });

  it('lets only the owner start their self-assessment, once per board', async () => {
    await expectAllRefused(
      [
        one(board.leader, 'insert into self_assessments (organization_id, board_id) values ($1, $2)', [
          program.organizationId,
          board.boardId,
        ]),
        one(administrator, 'insert into self_assessments (organization_id, board_id) values ($1, $2)', [
          program.organizationId,
          board.boardId,
        ]),
      ],
      /row-level security/,
    );
    const [created] = await as(board.owner, [
      ['insert into self_assessments (organization_id, board_id) values ($1, $2) returning id, submitted_at', [
        program.organizationId,
        board.boardId,
      ]],
    ]);
    selfAssessmentId = created!.rows[0].id;

    expect(created!.rows[0].submitted_at).toBeNull();
    await expect(
      one(board.owner, 'insert into self_assessments (organization_id, board_id) values ($1, $2)', [
        program.organizationId,
        board.boardId,
      ]),
    ).rejects.toThrow(/self_assessments_one_per_board/);
  });

  it('accepts levels of the program scale for capabilities on the board, and changes them in draft', async () => {
    await propose(board.owner, program.capabilityIds[0]!, program.levelIds[1]!);
    await propose(board.owner, program.capabilityIds[0]!, program.levelIds[0]!);
    const other = await seedMap(ownerPool, program.organizationId, 'published');

    await expectAllRefused(
      [
        propose(board.owner, program.capabilityIds[2]!, program.levelIds[0]!),
        propose(board.owner, program.capabilityIds[1]!, other.levelId),
      ],
      /not on the board|not of the program map/,
    );
    const stored = await ownerPool.query('select capability_id, level_id from self_assessment_levels where self_assessment_id = $1', [
      selfAssessmentId,
    ]);
    expect(stored.rows).toEqual([{ capability_id: program.capabilityIds[0], level_id: program.levelIds[0] }]);
  });

  it('INV-9 a draft is the owner only: the panel, other participants and administrators see nothing', async () => {
    expect(await seen(board.owner)).toBe(1);
    expect(await seen(board.leader)).toBe(0);
    expect(await seen(board.otherParticipant)).toBe(0);
    expect(await seen(administrator)).toBe(0);
    await expect(propose(board.leader, program.capabilityIds[1]!, program.levelIds[1]!)).rejects.toThrow(/row-level security/);
  });

  it('refuses to submit while a capability on the board has no level, and nobody but the owner submits', async () => {
    await expectAllRefused(
      [
        one(board.owner, 'select app_submit_self_assessment($1)', [board.boardId]),
        one(board.leader, 'select app_submit_self_assessment($1)', [board.boardId]),
      ],
      /incomplete|only the owner/,
    );
    // Only the function submits: the API role has no UPDATE on self-assessments at all.
    await expect(
      one(board.owner, 'update self_assessments set submitted_at = now() where id = $1', [selfAssessmentId]),
    ).rejects.toThrow(/permission denied/);
  });

  it('INV-2 submitting changes the self-assessment and the board state, never the placements', async () => {
    await propose(board.owner, program.capabilityIds[1]!, program.levelIds[1]!);

    await one(board.owner, 'select app_submit_self_assessment($1)', [board.boardId]);

    const assessment = await ownerPool.query('select submitted_at from self_assessments where id = $1', [selfAssessmentId]);
    const boardRow = await ownerPool.query('select status, baseline_set_at from boards where id = $1', [board.boardId]);
    const placements = await ownerPool.query('select level_id from placements where board_id = $1', [board.boardId]);
    expect(assessment.rows[0].submitted_at).toBeInstanceOf(Date);
    expect(boardRow.rows).toEqual([{ status: 'self_assessed', baseline_set_at: null }]);
    expect(placements.rows).toEqual([{ level_id: null }, { level_id: null }]);
  });

  it('INV-2 a submitted self-assessment never changes, is not submitted twice, and cannot be deleted', async () => {
    await expectAllRefused(
      [
        propose(board.owner, program.capabilityIds[0]!, program.levelIds[1]!),
        one(board.owner, 'select app_submit_self_assessment($1)', [board.boardId]),
        ownerPool.query('update self_assessment_levels set level_id = $2 where self_assessment_id = $1', [
          selfAssessmentId,
          program.levelIds[1],
        ]),
        ownerPool.query('delete from self_assessments where id = $1', [selfAssessmentId]),
      ],
      /submitted|row-level security/,
    );
    const deleted = await one(board.owner, 'delete from self_assessment_levels where self_assessment_id = $1', [
      selfAssessmentId,
    ]);
    const stored = await ownerPool.query('select count(*) from self_assessment_levels where self_assessment_id = $1', [
      selfAssessmentId,
    ]);
    expect(deleted.rowCount).toBe(0);
    expect(Number(stored.rows[0].count)).toBe(2);
  });

  it('INV-9 once submitted, the panel sees it; other participants and administrators still do not', async () => {
    const levels = await one(board.leader, 'select capability_id from self_assessment_levels where self_assessment_id = $1', [
      selfAssessmentId,
    ]);

    expect(await seen(board.leader)).toBe(1);
    expect(levels.rowCount).toBe(2);
    expect(await seen(board.otherParticipant)).toBe(0);
    expect(await seen(administrator)).toBe(0);
  });

  it('INV-11 another organization sees nothing of it', async () => {
    const otherOrganization = await seed.organization();
    const stranger = await seed.person(otherOrganization);
    const client = await appPool.connect();
    try {
      await client.query('begin');
      await client.query(
        "select set_config('app.person_id', $1, true), set_config('app.organization_id', $2, true)",
        [stranger, otherOrganization],
      );
      for (const table of ['self_assessments', 'self_assessment_levels']) {
        const rows = await client.query(`select count(*) from ${table} where organization_id = $1`, [program.organizationId]);
        expect(Number(rows.rows[0].count), table).toBe(0);
      }
      await client.query('rollback');
    } finally {
      client.release();
    }
  });
});
