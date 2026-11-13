import pg from 'pg';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { enroll, giveBaseline, seedProgram, type SeededProgram } from '../../test-support/seed-program.ts';
import { seedMap } from '../../test-support/seed-map.ts';
import { createSeeder } from '../../test-support/seed.ts';

/** Settles all at once, so no rejection is left unhandled while another is awaited. */
async function expectAllRefused(attempts: Promise<unknown>[], pattern: RegExp): Promise<void> {
  const outcomes = await Promise.allSettled(attempts);
  for (const outcome of outcomes) {
    expect(outcome.status).toBe('rejected');
    expect(String((outcome as PromiseRejectedResult).reason?.message)).toMatch(pattern);
  }
}

describe('program storage', () => {
  let ownerPool: pg.Pool;
  let appPool: pg.Pool;
  let seed: ReturnType<typeof createSeeder>;
  let organizationA: string;
  let organizationB: string;
  let program: SeededProgram;
  let people: {
    participant: string;
    otherParticipant: string;
    leader: string;
    administrator: string;
    firmMentor: string;
    firmOutsider: string;
  };
  let enrollments: { participant: string; otherParticipant: string; leader: string; firmMentor: string };
  let boardId: string;

  /** Runs statements as the API role, scoped to a person and organization A. */
  const as = async (personId: string, statements: [string, unknown[]?][]): Promise<pg.QueryResult[]> => {
    const client = await appPool.connect();
    try {
      await client.query('begin');
      await client.query(
        "select set_config('app.person_id', $1, true), set_config('app.organization_id', $2, true)",
        [personId, organizationA],
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
  /**
   * Test cleanup only: a baseline never changes, so clearing one has to skip the triggers
   * (allowed to the superuser the tests connect as owner with).
   */
  const clearBaseline = async () => {
    const client = await ownerPool.connect();
    try {
      await client.query('set session_replication_role = replica');
      await client.query('delete from calibration_sessions where board_id = $1', [boardId]);
      await client.query('update boards set baseline_set_at = null where id = $1', [boardId]);
    } finally {
      await client.query('set session_replication_role = origin');
      client.release();
    }
  };
  const placementsSeenBy = async (personId: string) =>
    (await one(personId, 'select capability_id from placements where board_id = $1', [boardId])).rows.length;

  beforeAll(async () => {
    ownerPool = new pg.Pool({ connectionString: inject('ownerDatabaseUrl') });
    appPool = new pg.Pool({ connectionString: inject('appDatabaseUrl') });
    seed = createSeeder(ownerPool);
    organizationA = await seed.organization();
    organizationB = await seed.organization();
    program = await seedProgram(ownerPool, organizationA);
    people = {
      participant: await seed.person(organizationA),
      otherParticipant: await seed.person(organizationA),
      leader: await seed.person(organizationA),
      administrator: await seed.person(organizationA),
      firmMentor: await seed.person(null),
      firmOutsider: await seed.person(null),
    };
    await seed.membership(organizationA, people.administrator, 'administrator');
    enrollments = {
      participant: await enroll(ownerPool, program, people.participant, 'participant'),
      otherParticipant: await enroll(ownerPool, program, people.otherParticipant, 'participant'),
      leader: await enroll(ownerPool, program, people.leader, 'leader'),
      firmMentor: await enroll(ownerPool, program, people.firmMentor, 'mentor'),
    };
    for (const [member, role] of [
      [enrollments.leader, 'leader'],
      [enrollments.firmMentor, 'mentor'],
    ] as const) {
      await ownerPool.query(
        'insert into panel_assignments (organization_id, participant_enrollment_id, member_enrollment_id, role) values ($1, $2, $3, $4)',
        [organizationA, enrollments.participant, member, role],
      );
    }
    boardId = (
      await ownerPool.query<{ id: string }>(
        'insert into boards (organization_id, enrollment_id) values ($1, $2) returning id',
        [organizationA, enrollments.participant],
      )
    ).rows[0]!.id;
    for (const capabilityId of program.capabilityIds.slice(0, 2)) {
      await ownerPool.query(
        'insert into placements (organization_id, board_id, capability_id, added_by) values ($1, $2, $3, $4)',
        [organizationA, boardId, capabilityId, people.leader],
      );
    }
  });

  afterAll(async () => {
    await appPool.end();
    await ownerPool.end();
  });

  describe('programs and base selection', () => {
    it('uses only a published map version, and keeps it for good', async () => {
      const draft = await seedMap(ownerPool, organizationA, 'draft');

      await expectAllRefused(
        [
          one(people.administrator, "insert into programs (organization_id, map_id, name, starts_on, ends_on) values ($1, $2, 'P', '2026-01-01', '2026-06-30')", [
            organizationA,
            draft.mapId,
          ]),
          one(people.administrator, 'update programs set map_id = $2 where id = $1', [program.programId, draft.mapId]),
        ],
        /program/,
      );
    });

    it('refuses dates that end before they start and impossible panel settings', async () => {
      await expectAllRefused(
        [
          one(people.administrator, "insert into programs (organization_id, map_id, name, starts_on, ends_on) values ($1, $2, 'P', '2026-06-30', '2026-01-01')", [
            organizationA,
            program.mapId,
          ]),
          one(people.administrator, "insert into programs (organization_id, map_id, name, starts_on, ends_on, mandatory_panel_roles) values ($1, $2, 'P', '2026-01-01', '2026-06-30', '{owner}')", [
            organizationA,
            program.mapId,
          ]),
          one(people.administrator, "insert into programs (organization_id, map_id, name, starts_on, ends_on, max_focuses) values ($1, $2, 'P', '2026-01-01', '2026-06-30', 0)", [
            organizationA,
            program.mapId,
          ]),
          one(people.administrator, "insert into programs (organization_id, map_id, name, starts_on, ends_on, mandatory_panel_roles) values ($1, $2, 'P', '2026-01-01', '2026-06-30', '{}')", [
            organizationA,
            program.mapId,
          ]),
        ],
        /violates check constraint/,
      );
    });

    it('selects only capabilities of the program map', async () => {
      const other = await seedMap(ownerPool, organizationA, 'published');

      await expect(
        one(people.administrator, 'insert into program_capabilities (organization_id, program_id, capability_id) values ($1, $2, $3)', [
          organizationA,
          program.programId,
          other.capabilityId,
        ]),
      ).rejects.toThrow(/not a capability of the program map/);
    });
  });

  describe('enrollments and panels', () => {
    it('enrolls a person of the mentoring firm in a panel role, never as participant', async () => {
      const outsiderAsMentor = await one(
        people.administrator,
        "insert into enrollments (organization_id, program_id, person_id, role) values ($1, $2, $3, 'specialist') returning id",
        [organizationA, program.programId, people.firmOutsider],
      );

      expect(outsiderAsMentor.rowCount).toBe(1);
      await expect(
        one(people.administrator, "insert into enrollments (organization_id, program_id, person_id, role) values ($1, $2, $3, 'participant')", [
          organizationA,
          program.programId,
          people.firmOutsider,
        ]),
      ).rejects.toThrow(/mentoring firm cannot be a participant/);
    });

    it('INV-11 refuses to enroll a person of another organization', async () => {
      const personOfB = await seed.person(organizationB);

      await expect(
        one(people.administrator, "insert into enrollments (organization_id, program_id, person_id, role) values ($1, $2, $3, 'leader')", [
          organizationA,
          program.programId,
          personOfB,
        ]),
      ).rejects.toThrow(/does not belong to the organization/);
    });

    it('assigns as panel only an enrollment of the same program in that role, for a participant', async () => {
      const assign = (participant: string, member: string, role: string) =>
        one(people.administrator, 'insert into panel_assignments (organization_id, participant_enrollment_id, member_enrollment_id, role) values ($1, $2, $3, $4)', [
          organizationA,
          participant,
          member,
          role,
        ]);

      await expectAllRefused(
        [
          assign(enrollments.participant, enrollments.leader, 'mentor'),
          assign(enrollments.leader, enrollments.firmMentor, 'mentor'),
          assign(enrollments.participant, enrollments.otherParticipant, 'leader'),
        ],
        /panel/,
      );
    });
  });

  describe('INV-1 one placement per capability', () => {
    it('INV-1 refuses a capability twice on a board', async () => {
      await expect(
        one(people.leader, 'insert into placements (organization_id, board_id, capability_id, added_by) values ($1, $2, $3, $4)', [
          organizationA,
          boardId,
          program.capabilityIds[0],
          people.leader,
        ]),
      ).rejects.toThrow(/placements_one_per_capability/);
    });

    it('INV-1 places only capabilities and levels of the program map', async () => {
      const other = await seedMap(ownerPool, organizationA, 'published');

      await expectAllRefused(
        [
          one(people.leader, 'insert into placements (organization_id, board_id, capability_id, added_by) values ($1, $2, $3, $4)', [
            organizationA,
            boardId,
            other.capabilityId,
            people.leader,
          ]),
          one(people.leader, 'update placements set level_id = $2 where board_id = $1', [boardId, other.levelId]),
        ],
        /of the program map/,
      );
    });

    it('INV-1 starts unplaced and accepts a level of the scale', async () => {
      const unplaced = await one(people.leader, 'select level_id from placements where board_id = $1', [boardId]);
      const placed = await one(
        people.leader,
        'update placements set level_id = $2 where board_id = $1 and capability_id = $3 returning level_id',
        [boardId, program.levelIds[1], program.capabilityIds[0]],
      );
      const back = await one(
        people.leader,
        'update placements set level_id = null where board_id = $1 and capability_id = $2 returning level_id',
        [boardId, program.capabilityIds[0]],
      );

      expect(unplaced.rows).toEqual([{ level_id: null }, { level_id: null }]);
      expect(placed.rows).toEqual([{ level_id: program.levelIds[1] }]);
      expect(back.rows).toEqual([{ level_id: null }]);
    });

    it('INV-1 the panel adds at any time and removes only before the baseline', async () => {
      const [added] = await as(people.leader, [
        ['insert into placements (organization_id, board_id, capability_id, added_by) values ($1, $2, $3, $4) returning id', [
          organizationA,
          boardId,
          program.capabilityIds[2],
          people.leader,
        ]],
      ]);
      await giveBaseline(ownerPool, boardId);
      try {
        await expect(
          one(people.leader, 'delete from placements where id = $1', [added!.rows[0].id]),
        ).rejects.toThrow(/after the baseline/);
      } finally {
        await clearBaseline();
      }
      const removed = await one(people.leader, 'delete from placements where id = $1 returning id', [added!.rows[0].id]);
      expect(removed.rowCount).toBe(1);
    });

    it('records who added each capability and when, as the person acting, for good', async () => {
      const [added] = await as(people.firmMentor, [
        ['insert into placements (organization_id, board_id, capability_id, added_by) values ($1, $2, $3, $4) returning id, added_by', [
          organizationA,
          boardId,
          program.capabilityIds[2],
          people.leader,
        ]],
      ]);
      const placementId = added!.rows[0].id;
      try {
        const rewritten = await one(
          people.leader,
          "update placements set added_by = $2, added_at = now() - interval '1 year' where id = $1 returning added_by, added_at",
          [placementId, people.leader],
        );

        expect(added!.rows[0].added_by).toBe(people.firmMentor);
        expect(rewritten.rows[0].added_by).toBe(people.firmMentor);
        expect(Date.now() - (rewritten.rows[0].added_at as Date).getTime()).toBeLessThan(60_000);
      } finally {
        await ownerPool.query('delete from placements where id = $1', [placementId]);
      }
    });
  });

  describe('INV-9 a board is seen by its owner and their panel', () => {
    it('INV-9 the owner and each panel member read the placements', async () => {
      expect(await placementsSeenBy(people.participant)).toBe(2);
      expect(await placementsSeenBy(people.leader)).toBe(2);
      expect(await placementsSeenBy(people.firmMentor)).toBe(2);
    });

    it('INV-9 another participant, the administrator and a super administrator outside the panel read nothing', async () => {
      expect(await placementsSeenBy(people.otherParticipant)).toBe(0);
      expect(await placementsSeenBy(people.administrator)).toBe(0);
      expect(await placementsSeenBy(people.firmOutsider)).toBe(0);
    });

    it('INV-9 the administrator sees that the board exists and its state', async () => {
      const boards = await one(people.administrator, 'select id, status from boards where id = $1', [boardId]);

      expect(boards.rows).toEqual([{ id: boardId, status: 'not_started' }]);
    });

    it('INV-9 only the panel changes the capabilities, not the owner nor anyone else', async () => {
      const attempt = (personId: string) =>
        one(personId, 'insert into placements (organization_id, board_id, capability_id, added_by) values ($1, $2, $3, $4)', [
          organizationA,
          boardId,
          program.capabilityIds[2],
          personId,
        ]);

      await expectAllRefused(
        [attempt(people.participant), attempt(people.administrator), attempt(people.firmOutsider)],
        /row-level security/,
      );
      const deleted = await one(people.participant, 'delete from placements where board_id = $1 returning id', [boardId]);
      expect(deleted.rows).toEqual([]);
    });

    it('INV-9 firm people are visible in the organization only while enrolled in one of its programs', async () => {
      const ofAdministrator = await one(people.administrator, 'select id from persons where id = $1', [people.firmMentor]);
      const ofParticipant = await one(people.firmMentor, 'select id from persons where id = $1', [people.participant]);

      const notEnrolled = await seed.person(null);
      const ofOutsider = await one(people.administrator, 'select id from persons where id = $1', [notEnrolled]);

      expect(ofAdministrator.rows).toEqual([{ id: people.firmMentor }]);
      expect(ofParticipant.rows).toEqual([{ id: people.participant }]);
      expect(ofOutsider.rows).toEqual([]);
    });
  });

  describe('INV-9 only administrators shape programs, enrollments and panels', () => {
    it('INV-9 a participant cannot enroll themself, join a panel or create a board', async () => {
      const selfEnrollment = (
        await ownerPool.query<{ id: string }>(
          "insert into enrollments (organization_id, program_id, person_id, role) values ($1, $2, $3, 'leader') returning id",
          [organizationA, program.programId, people.otherParticipant],
        )
      ).rows[0]!.id;
      try {
        await expectAllRefused(
          [
            one(people.otherParticipant, "insert into enrollments (organization_id, program_id, person_id, role) values ($1, $2, $3, 'specialist')", [
              organizationA,
              program.programId,
              people.otherParticipant,
            ]),
            one(people.otherParticipant, "insert into panel_assignments (organization_id, participant_enrollment_id, member_enrollment_id, role) values ($1, $2, $3, 'leader')", [
              organizationA,
              enrollments.participant,
              selfEnrollment,
            ]),
            one(people.otherParticipant, 'select app_create_board($1)', [enrollments.otherParticipant]),
          ],
          /row-level security|only an administrator/,
        );
        expect(await placementsSeenBy(people.otherParticipant)).toBe(0);
      } finally {
        await ownerPool.query('delete from enrollments where id = $1', [selfEnrollment]);
      }
    });

    it('INV-9 a participant cannot delete or rewrite boards, enrollments or programs', async () => {
      const changed = await as(people.otherParticipant, [
        ['delete from boards where id = $1 returning id', [boardId]],
        ['delete from enrollments where id = $1 returning id', [enrollments.participant]],
        ["update programs set name = 'x' where id = $1 returning id", [program.programId]],
        ['delete from panel_assignments where participant_enrollment_id = $1 returning role', [enrollments.participant]],
      ]);

      expect(changed.map((result) => result.rowCount)).toEqual([0, 0, 0, 0]);
      expect(await placementsSeenBy(people.participant)).toBe(2);
    });

    it('an administrator creates a board that starts with the base selection, unplaced', async () => {
      const newcomer = await seed.person(organizationA);
      const [enrollment] = await as(people.administrator, [
        ["insert into enrollments (organization_id, program_id, person_id, role) values ($1, $2, $3, 'participant') returning id", [
          organizationA,
          program.programId,
          newcomer,
        ]],
      ]);
      const [created] = await as(people.administrator, [['select app_create_board($1) as id', [enrollment!.rows[0].id]]]);

      const stored = await ownerPool.query(
        'select capability_id, level_id, added_by from placements where board_id = $1 order by capability_id',
        [created!.rows[0].id],
      );
      expect(stored.rows).toEqual(
        program.capabilityIds
          .slice(0, 2)
          .sort()
          .map((capabilityId) => ({ capability_id: capabilityId, level_id: null, added_by: people.administrator })),
      );
    });

    it('an enrollment never changes its role', async () => {
      await expect(
        one(people.administrator, "update enrollments set role = 'leader' where id = $1", [enrollments.participant]),
      ).rejects.toThrow(/never changes/);
    });
  });

  describe('INV-1 a board with a baseline keeps its capabilities', () => {
    it('INV-1 refuses to delete it, its enrollment, or to clear its baseline', async () => {
      await giveBaseline(ownerPool, boardId);
      try {
        await expectAllRefused(
          [
            one(people.administrator, 'delete from boards where id = $1', [boardId]),
            one(people.administrator, 'delete from enrollments where id = $1', [enrollments.participant]),
            one(people.administrator, 'update boards set baseline_set_at = null where id = $1', [boardId]),
          ],
          /baseline/,
        );
      } finally {
        await clearBaseline();
      }
      expect(await placementsSeenBy(people.participant)).toBe(2);
    });
  });

  describe('INV-11 isolation of programs and boards', () => {
    it('INV-11 a scope of organization B reads nothing of organization A', async () => {
      const client = await appPool.connect();
      try {
        await client.query('begin');
        const personOfB = await seed.person(organizationB);
        await client.query(
          "select set_config('app.person_id', $1, true), set_config('app.organization_id', $2, true)",
          [personOfB, organizationB],
        );
        for (const table of ['programs', 'program_capabilities', 'enrollments', 'panel_assignments', 'boards', 'placements']) {
          const seen = await client.query(`select count(*) from ${table} where organization_id = $1`, [organizationA]);
          expect(Number(seen.rows[0].count), table).toBe(0);
        }
        await client.query('rollback');
      } finally {
        client.release();
      }
    });
  });
});
