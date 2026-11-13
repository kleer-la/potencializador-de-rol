import pg from 'pg';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { seedMap } from '../../test-support/seed-map.ts';
import { enroll, seedBoard, seedProgram, type SeededBoard, type SeededProgram } from '../../test-support/seed-program.ts';
import { createSeeder } from '../../test-support/seed.ts';

async function expectRefused(attempt: Promise<unknown>, pattern: RegExp): Promise<void> {
  await expect(attempt).rejects.toThrow(pattern);
}

describe('calibration storage', () => {
  let ownerPool: pg.Pool;
  let appPool: pg.Pool;
  let seed: ReturnType<typeof createSeeder>;
  let program: SeededProgram;
  let board: SeededBoard;
  let mentor: string;
  let administrator: string;
  let otherOrganization: string;

  const as = async (
    personId: string,
    statements: [string, unknown[]?][],
    organizationId = program.organizationId,
  ): Promise<pg.QueryResult[]> => {
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
  const levels = (pairs: [number, number][]) =>
    JSON.stringify(pairs.map(([capability, level]) => ({ capabilityId: program.capabilityIds[capability], levelId: program.levelIds[level] })));
  const calibrate = (personId: string, attendees: string[], levelsJson: string, boardId = board.boardId) =>
    one(personId, "select app_calibrate_board($1, date '2026-11-20', 'Casos reales del trimestre', $2::uuid[], $3::jsonb) as id", [
      boardId,
      attendees,
      levelsJson,
    ]);
  const boardState = async (boardId = board.boardId) =>
    (await ownerPool.query('select status, baseline_set_at is not null as has_baseline from boards where id = $1', [boardId])).rows[0];
  const count = async (table: string, boardId = board.boardId) =>
    Number((await ownerPool.query(`select count(*) from ${table} where board_id = $1`, [boardId])).rows[0].count);

  beforeAll(async () => {
    ownerPool = new pg.Pool({ connectionString: inject('ownerDatabaseUrl') });
    appPool = new pg.Pool({ connectionString: inject('appDatabaseUrl') });
    seed = createSeeder(ownerPool);
    const organization = await seed.organization();
    otherOrganization = await seed.organization();
    program = await seedProgram(ownerPool, organization);
    await ownerPool.query("update programs set mandatory_panel_roles = '{leader,mentor}' where id = $1", [program.programId]);
    board = await seedBoard(ownerPool, program, (organizationId) => seed.person(organizationId));
    mentor = await seed.person(organization);
    const mentorEnrollment = await enroll(ownerPool, program, mentor, 'mentor');
    await ownerPool.query(
      "insert into panel_assignments (organization_id, participant_enrollment_id, member_enrollment_id, role) select $1, enrollment_id, $2, 'mentor' from boards where id = $3",
      [organization, mentorEnrollment, board.boardId],
    );
    administrator = await seed.person(organization);
    await seed.membership(organization, administrator, 'administrator');
  });

  afterAll(async () => {
    await appPool.end();
    await ownerPool.end();
  });

  it('refuses to calibrate a board whose self-assessment was not submitted', async () => {
    await expectRefused(calibrate(board.leader, [board.owner, board.leader, mentor], levels([[0, 1], [1, 0]])), /self-assessed/);
    expect(await count('calibration_sessions')).toBe(0);

    // The participant proposes the first capability higher than it will be agreed.
    const [assessment] = await as(board.owner, [
      ['insert into self_assessments (organization_id, board_id) values ($1, $2) returning id', [program.organizationId, board.boardId]],
    ]);
    const selfAssessmentId = assessment!.rows[0].id;
    await as(board.owner, [
      [
        'insert into self_assessment_levels (organization_id, self_assessment_id, capability_id, level_id) values ($1, $2, $3, $4), ($1, $2, $5, $6)',
        [program.organizationId, selfAssessmentId, program.capabilityIds[0], program.levelIds[1], program.capabilityIds[1], program.levelIds[0]],
      ],
      ['select app_submit_self_assessment($1)', [board.boardId]],
    ]);
    expect(await boardState()).toEqual({ status: 'self_assessed', has_baseline: false });
  });

  it('INV-3 refuses the baseline without the participant or a mandatory role of the panel', async () => {
    await expectRefused(calibrate(board.leader, [board.leader, mentor], levels([[0, 0], [1, 0]])), /invariant 3: .*participant/);
    await expectRefused(calibrate(board.leader, [board.owner, board.leader], levels([[0, 0], [1, 0]])), /invariant 3: .*mentor/);

    expect(await boardState()).toEqual({ status: 'self_assessed', has_baseline: false });
    expect(await count('calibration_sessions')).toBe(0);
  });

  it('refuses a calibration by anyone off the panel, an incomplete one and foreign references', async () => {
    const everyone = [board.owner, board.leader, mentor];
    for (const person of [board.owner, administrator, board.otherParticipant]) {
      await expectRefused(calibrate(person, everyone, levels([[0, 0], [1, 0]])), /only a panel member/);
    }
    await expectRefused(calibrate(board.leader, everyone, levels([[0, 0]])), /every capability on the board/);
    await expectRefused(calibrate(board.leader, everyone, levels([[0, 0], [1, 0], [2, 0]])), /not on the board/);
    const other = await seedMap(ownerPool, program.organizationId, 'published');
    await expectRefused(
      calibrate(
        board.leader,
        everyone,
        JSON.stringify([
          { capabilityId: program.capabilityIds[0], levelId: other.levelId },
          { capabilityId: program.capabilityIds[1], levelId: program.levelIds[0] },
        ]),
      ),
      /not of the program map/,
    );
    await expectRefused(
      calibrate(board.leader, [...everyone, board.otherParticipant], levels([[0, 0], [1, 0]])),
      /attendee .* not on the board/,
    );
    await expectRefused(calibrate(board.leader, everyone, levels([[0, 0], [0, 1], [1, 0]])), /more than one agreed level/);
    await expectRefused(
      calibrate(board.leader, everyone, JSON.stringify([{ capabilityId: program.capabilityIds[0] }, { capabilityId: program.capabilityIds[1], levelId: program.levelIds[0] }])),
      /not of the program map/,
    );
    await expectRefused(
      calibrate(board.leader, everyone, JSON.stringify([{ levelId: program.levelIds[0] }, { capabilityId: program.capabilityIds[1], levelId: program.levelIds[0] }])),
      /not on the board/,
    );
    await expectRefused(calibrate(board.leader, [], levels([[0, 0], [1, 0]])), /invariant 3: .*participant/);

    expect(await count('calibration_sessions')).toBe(0);
  });

  it('INV-3 fixes the baseline from the calibration: levels, entries, level changes, difference', async () => {
    const result = await calibrate(board.leader, [board.owner, board.leader, mentor], levels([[0, 0], [1, 1]]));
    expect(result.rows[0].id).toEqual(expect.any(String));

    expect(await boardState()).toEqual({ status: 'calibrated', has_baseline: true });
    const placements = await ownerPool.query('select capability_id, level_id from placements where board_id = $1 order by capability_id', [
      board.boardId,
    ]);
    const entries = await ownerPool.query(
      "select capability_id, level_id, origin from baseline_entries where board_id = $1 order by capability_id",
      [board.boardId],
    );
    expect(entries.rows).toEqual(
      placements.rows.map((placement) => ({ ...placement, origin: 'calibration' })),
    );
    expect(entries.rows).toHaveLength(2);
    const changes = await ownerPool.query(
      'select c.reason, c.previous_level_id, c.approved_by from level_changes c join placements p on p.id = c.placement_id where p.board_id = $1',
      [board.boardId],
    );
    expect(changes.rows).toEqual([
      { reason: 'calibration', previous_level_id: null, approved_by: board.leader },
      { reason: 'calibration', previous_level_id: null, approved_by: board.leader },
    ]);
    const difference = await ownerPool.query(
      'select capability_id, self_assessed_level_id, agreed_level_id from calibration_levels l join calibration_sessions s on s.id = l.calibration_session_id where s.board_id = $1',
      [board.boardId],
    );
    expect(difference.rows).toEqual(
      expect.arrayContaining([
        { capability_id: program.capabilityIds[0], self_assessed_level_id: program.levelIds[1], agreed_level_id: program.levelIds[0] },
        { capability_id: program.capabilityIds[1], self_assessed_level_id: program.levelIds[0], agreed_level_id: program.levelIds[1] },
      ]),
    );
    const attendees = await ownerPool.query(
      'select a.person_id from calibration_attendees a join calibration_sessions s on s.id = a.calibration_session_id where s.board_id = $1',
      [board.boardId],
    );
    expect(attendees.rows.map((row) => row.person_id).sort()).toEqual([board.owner, board.leader, mentor].sort());
  });

  it('INV-3 calibrates once; the baseline, its session and its level changes never change', async () => {
    await expectRefused(calibrate(mentor, [board.owner, board.leader, mentor], levels([[0, 1], [1, 1]])), /baseline/);
    for (const table of ['calibration_sessions', 'calibration_attendees', 'calibration_levels', 'baseline_entries', 'level_changes']) {
      await expectRefused(one(board.leader, `update ${table} set organization_id = organization_id`), /permission denied/);
      await expectRefused(one(board.leader, `delete from ${table}`), /permission denied/);
      await expectRefused(ownerPool.query(`update ${table} set organization_id = organization_id`), /invariant [34]/);
      await expectRefused(ownerPool.query(`delete from ${table}`), /invariant [34]/);
    }
    await expectRefused(
      one(board.leader, 'insert into baseline_entries (organization_id, board_id, capability_id, level_id, origin) values ($1, $2, $3, $4, $5)', [
        program.organizationId,
        board.boardId,
        program.capabilityIds[2],
        program.levelIds[0],
        'calibration',
      ]),
      /permission denied/,
    );
  });

  it('INV-3 a baseline is born only from a calibration', async () => {
    const second = await seedBoard(ownerPool, program, (organizationId) => seed.person(organizationId));
    await expectRefused(one(administrator, 'update boards set baseline_set_at = now() where id = $1', [second.boardId]), /invariant 3/);
    await expectRefused(one(administrator, "update boards set status = 'calibrated' where id = $1", [second.boardId]), /invariant 3/);
    await expectRefused(ownerPool.query('update boards set baseline_set_at = now() where id = $1', [second.boardId]), /invariant 3/);
    await expectRefused(
      ownerPool.query("update boards set baseline_set_at = baseline_set_at - interval '1 day' where id = $1", [board.boardId]),
      /baseline of a board never changes/,
    );
    await expectRefused(one(administrator, "update boards set status = 'self_assessed' where id = $1", [board.boardId]), /invariant 3/);
    expect(await boardState(second.boardId)).toEqual({ status: 'not_started', has_baseline: false });
  });

  it('INV-4 after the baseline a level changes only through its level change', async () => {
    await expectRefused(
      one(board.leader, 'update placements set level_id = $1 where board_id = $2 and capability_id = $3', [
        program.levelIds[1],
        board.boardId,
        program.capabilityIds[0],
      ]),
      /invariant 4/,
    );
    await expectRefused(
      ownerPool.query('update placements set level_id = null where board_id = $1', [board.boardId]),
      /invariant 4/,
    );
  });

  it('INV-3 a capability added after the baseline enters unplaced and its initial level joins the baseline', async () => {
    const added = program.capabilityIds[2]!;
    await one(board.leader, 'insert into placements (organization_id, board_id, capability_id, added_by) values ($1, $2, $3, $4)', [
      program.organizationId,
      board.boardId,
      added,
      board.leader,
    ]);
    const initial = (personId: string, levelId = program.levelIds[1]) =>
      one(personId, 'select app_record_initial_level($1, $2, $3) as id', [board.boardId, added, levelId]);

    await expectRefused(initial(board.owner), /only a panel member/);
    await expectRefused(initial(administrator), /only a panel member/);
    await initial(mentor);
    await expectRefused(initial(board.leader, program.levelIds[0]), /initial level/);

    const entry = await ownerPool.query('select level_id, origin from baseline_entries where board_id = $1 and capability_id = $2', [
      board.boardId,
      added,
    ]);
    expect(entry.rows).toEqual([{ level_id: program.levelIds[1], origin: 'initial_leveling' }]);
    const change = await ownerPool.query(
      'select c.reason, c.previous_level_id, c.new_level_id, c.approved_by from level_changes c join placements p on p.id = c.placement_id where p.board_id = $1 and p.capability_id = $2',
      [board.boardId, added],
    );
    expect(change.rows).toEqual([{ reason: 'initial_leveling', previous_level_id: null, new_level_id: program.levelIds[1], approved_by: mentor }]);
    expect(await count('baseline_entries')).toBe(3);
  });

  it('refuses an initial level before the baseline and for a capability of the baseline', async () => {
    const other = await seedBoard(ownerPool, program, (organizationId) => seed.person(organizationId));
    await expectRefused(
      one(other.leader, 'select app_record_initial_level($1, $2, $3)', [other.boardId, program.capabilityIds[0], program.levelIds[0]]),
      /baseline/,
    );
    await expectRefused(
      one(board.leader, 'select app_record_initial_level($1, $2, $3)', [board.boardId, program.capabilityIds[0], program.levelIds[1]]),
      /initial level/,
    );
  });

  it('INV-9 only the owner and their panel read the calibration and the baseline', async () => {
    const tables = ['calibration_sessions', 'calibration_attendees', 'calibration_levels', 'baseline_entries', 'level_changes'];
    const seenBy = async (personId: string) => {
      const results = await as(personId, tables.map((table) => [`select count(*)::int as n from ${table}`] as [string]));
      return results.map((result) => result.rows[0].n);
    };
    expect(await seenBy(board.owner)).toEqual([1, 3, 2, 3, 3]);
    expect(await seenBy(mentor)).toEqual([1, 3, 2, 3, 3]);
    expect(await seenBy(administrator)).toEqual([0, 0, 0, 0, 0]);
    expect(await seenBy(board.otherParticipant)).toEqual([0, 0, 0, 0, 0]);
  });

  it('INV-11 nothing of the calibration is seen from another organization', async () => {
    const results = await as(
      board.owner,
      ['calibration_sessions', 'baseline_entries', 'level_changes'].map((table) => [`select count(*)::int as n from ${table}`] as [string]),
      otherOrganization,
    );
    expect(results.map((result) => result.rows[0].n)).toEqual([0, 0, 0]);
  });
});
