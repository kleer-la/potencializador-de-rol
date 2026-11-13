import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { seedMap, type SeededMap } from '../../test-support/seed-map.ts';
import { createSeeder } from '../../test-support/seed.ts';

const INVARIANT_10 = /invariant 10/;
const ROW_LEVEL_SECURITY = /row-level security/;

/** Settles all at once, so no rejection is left unhandled while another is awaited. */
async function expectAllRefused(attempts: Promise<unknown>[], pattern: RegExp): Promise<void> {
  const outcomes = await Promise.allSettled(attempts);
  for (const outcome of outcomes) {
    expect(outcome.status).toBe('rejected');
    expect(String((outcome as PromiseRejectedResult).reason?.message)).toMatch(pattern);
  }
}

describe('capability map storage', () => {
  let ownerPool: pg.Pool;
  let appPool: pg.Pool;
  let organizationA: string;
  let organizationB: string;
  let personA: string;

  /** Runs statements as the API role inside a transaction scoped to organization A. */
  const inScopeA = async (statements: [string, unknown[]?][]): Promise<pg.QueryResult[]> => {
    const client = await appPool.connect();
    try {
      await client.query('begin');
      await client.query(
        "select set_config('app.person_id', $1, true), set_config('app.organization_id', $2, true)",
        [personA, organizationA],
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
  const run = (text: string, values?: unknown[]) => inScopeA([[text, values]]);
  const count = async (table: string, column: string, value: string) =>
    Number(
      (await ownerPool.query(`select count(*) from ${table} where ${column} = $1`, [value])).rows[0].count,
    );

  beforeAll(async () => {
    ownerPool = new pg.Pool({ connectionString: inject('ownerDatabaseUrl') });
    appPool = new pg.Pool({ connectionString: inject('appDatabaseUrl') });
    const seed = createSeeder(ownerPool);
    organizationA = await seed.organization();
    organizationB = await seed.organization();
    personA = await seed.person(organizationA);
  });

  afterAll(async () => {
    await appPool.end();
    await ownerPool.end();
  });

  describe('a draft map', () => {
    let map: SeededMap;
    beforeAll(async () => {
      map = await seedMap(ownerPool, organizationA, 'draft');
    });

    it('accepts changes and removals of everything', async () => {
      await inScopeA([
        ["update levels set name = 'Principiante' where id = $1", [map.levelId]],
        ["update dimensions set name = 'Descubrir' where id = $1", [map.dimensionId]],
        ["update capabilities set difficulty = 'high' where id = $1", [map.capabilityId]],
        ['update bonus_rules set extra_points = 2 where id = $1', [map.bonusRuleId]],
        ['delete from capability_tools where capability_id = $1', [map.capabilityId]],
        ['delete from bonus_rules where id = $1', [map.bonusRuleId]],
        ['delete from capabilities where id = $1', [map.capabilityId]],
        ['delete from dimensions where id = $1', [map.dimensionId]],
        ['delete from levels where id = $1', [map.levelId]],
      ]);

      expect(await count('dimensions', 'map_id', map.mapId)).toBe(0);
      expect(await count('levels', 'map_id', map.mapId)).toBe(0);
    });

    it('can be discarded with all its content', async () => {
      const discarded = await seedMap(ownerPool, organizationA, 'draft');

      await run('delete from capability_maps where id = $1', [discarded.mapId]);

      expect(await count('dimensions', 'map_id', discarded.mapId)).toBe(0);
      expect(await count('capabilities', 'id', discarded.capabilityId)).toBe(0);
    });

    it('is the only draft of its role', async () => {
      await expect(
        run('insert into capability_maps (organization_id, role_id, version) values ($1, $2, 2)', [
          organizationA,
          map.roleId,
        ]),
      ).rejects.toThrow(/capability_maps_one_draft_per_role/);
    });
  });

  describe('INV-10 a published map', () => {
    let map: SeededMap;
    beforeAll(async () => {
      map = await seedMap(ownerPool, organizationA, 'published');
    });

    it('INV-10 refuses to change or remove an existing dimension or capability', async () => {
      const attempts = [
        run("update dimensions set name = 'Otra' where id = $1", [map.dimensionId]),
        run('update dimensions set position = 5 where id = $1', [map.dimensionId]),
        run('delete from dimensions where id = $1', [map.dimensionId]),
        run("update capabilities set statement = 'Otra' where id = $1", [map.capabilityId]),
        run("update capabilities set difficulty = 'low' where id = $1", [map.capabilityId]),
        run('delete from capabilities where id = $1', [map.capabilityId]),
      ];

      await expectAllRefused(attempts, INVARIANT_10);
      const stored = await ownerPool.query(
        'select d.name, c.statement, c.difficulty from dimensions d join capabilities c on c.dimension_id = d.id where d.id = $1',
        [map.dimensionId],
      );
      expect(stored.rows).toEqual([
        { name: 'Entender', statement: 'Identifica a quién sirve el producto', difficulty: null },
      ]);
    });

    it('INV-10 refuses any change to its scale and its bonus rules', async () => {
      const attempts = [
        run("update levels set multiplier = 9 where id = $1", [map.levelId]),
        run('delete from levels where id = $1', [map.levelId]),
        run(
          "insert into levels (organization_id, map_id, position, name, multiplier) values ($1, $2, 1, 'Nuevo', 1)",
          [organizationA, map.mapId],
        ),
        run('update bonus_rules set extra_points = 5 where id = $1', [map.bonusRuleId]),
        run('delete from bonus_rules where id = $1', [map.bonusRuleId]),
        run(
          "insert into bonus_rules (organization_id, map_id, name, extra_points, condition) values ($1, $2, 'Otra', 1, 'x')",
          [organizationA, map.mapId],
        ),
      ];

      await expectAllRefused(attempts, INVARIANT_10);
      expect(await count('levels', 'map_id', map.mapId)).toBe(1);
      expect(await count('bonus_rules', 'map_id', map.mapId)).toBe(1);
    });

    it('INV-10 refuses to change the tools or objectives of an existing capability', async () => {
      const otherTool = (
        await ownerPool.query("insert into tools (organization_id, name) values ($1, $2) returning id", [
          organizationA,
          `Tool ${randomUUID()}`,
        ])
      ).rows[0].id as string;
      const attempts = [
        run('delete from capability_tools where capability_id = $1', [map.capabilityId]),
        run('delete from capability_objectives where capability_id = $1', [map.capabilityId]),
        run('insert into capability_tools (organization_id, capability_id, tool_id) values ($1, $2, $3)', [
          organizationA,
          map.capabilityId,
          otherTool,
        ]),
      ];

      await expectAllRefused(attempts, INVARIANT_10);
      expect(await count('capability_tools', 'capability_id', map.capabilityId)).toBe(1);
    });

    it('INV-10 accepts a new capability with its tools and objectives, and a new dimension', async () => {
      const [capability] = await inScopeA([
        [
          "insert into capabilities (organization_id, dimension_id, position, statement) values ($1, $2, 1, 'Capacidad nueva') returning id",
          [organizationA, map.dimensionId],
        ],
      ]);
      const capabilityId = capability!.rows[0].id as string;
      // Links are accepted only in the transaction that creates the capability.
      const [, newCapability] = await inScopeA([
        [
          "insert into dimensions (organization_id, map_id, position, name, kind) values ($1, $2, 1, 'Comunicación', 'transversal')",
          [organizationA, map.mapId],
        ],
        [
          "insert into capabilities (organization_id, dimension_id, position, statement) select $1, id, 0, 'Adapta el mensaje' from dimensions where map_id = $2 and position = 1 returning id",
          [organizationA, map.mapId],
        ],
      ]);
      const linkedCapabilityId = newCapability!.rows[0].id as string;
      await ownerPool.query('select 1'); // separate transactions above are committed

      const withLinks = await inScopeA([
        [
          "insert into capabilities (organization_id, dimension_id, position, statement) values ($1, $2, 2, 'Con herramientas') returning id",
          [organizationA, map.dimensionId],
        ],
        [
          "insert into capability_tools (organization_id, capability_id, tool_id) select $1, id, $3 from capabilities where dimension_id = $2 and position = 2",
          [organizationA, map.dimensionId, map.toolId],
        ],
        [
          "insert into capability_objectives (organization_id, capability_id, objective_id) select $1, id, $3 from capabilities where dimension_id = $2 and position = 2",
          [organizationA, map.dimensionId, map.objectiveId],
        ],
      ]);

      expect(await count('dimensions', 'map_id', map.mapId)).toBe(2);
      expect(await count('capabilities', 'dimension_id', map.dimensionId)).toBe(3);
      expect(await count('capability_tools', 'capability_id', withLinks[0]!.rows[0].id)).toBe(1);
      // Once committed, the new capabilities are as frozen as the old ones.
      for (const id of [capabilityId, linkedCapabilityId]) {
        await expect(run("update capabilities set statement = 'x' where id = $1", [id])).rejects.toThrow(
          INVARIANT_10,
        );
        await expect(
          run('insert into capability_tools (organization_id, capability_id, tool_id) values ($1, $2, $3)', [
            organizationA,
            id,
            map.toolId,
          ]),
        ).rejects.toThrow(INVARIANT_10);
      }
    });

    it('INV-10 cannot go back to draft, be deleted, or change role or version', async () => {
      const attempts = [
        run("update capability_maps set status = 'draft' where id = $1", [map.mapId]),
        run('delete from capability_maps where id = $1', [map.mapId]),
        run('update capability_maps set version = 7 where id = $1', [map.mapId]),
      ];

      await expectAllRefused(attempts, INVARIANT_10);
      const stored = await ownerPool.query('select status, version from capability_maps where id = $1', [
        map.mapId,
      ]);
      expect(stored.rows).toEqual([{ status: 'published', version: 1 }]);
    });

    it('INV-10 holds for the schema owner too', async () => {
      await expect(
        ownerPool.query("update capabilities set statement = 'x' where id = $1", [map.capabilityId]),
      ).rejects.toThrow(INVARIANT_10);
    });
  });

  describe('life cycle in the database', () => {
    it('records when a map was published and archived', async () => {
      const map = await seedMap(ownerPool, organizationA, 'draft');

      await run("update capability_maps set status = 'published' where id = $1", [map.mapId]);
      await run("update capability_maps set status = 'archived' where id = $1", [map.mapId]);

      const stored = await ownerPool.query(
        'select status, published_at is not null as published, archived_at is not null as archived from capability_maps where id = $1',
        [map.mapId],
      );
      expect(stored.rows).toEqual([{ status: 'archived', published: true, archived: true }]);
    });

    it('refuses to archive a draft directly', async () => {
      const map = await seedMap(ownerPool, organizationA, 'draft');

      await expect(run("update capability_maps set status = 'archived' where id = $1", [map.mapId])).rejects.toThrow(
        INVARIANT_10,
      );
    });

    it('INV-10 an archived map accepts nothing, not even growth', async () => {
      const map = await seedMap(ownerPool, organizationA, 'archived');
      const attempts = [
        run(
          "insert into dimensions (organization_id, map_id, position, name, kind) values ($1, $2, 1, 'Nueva', 'transversal')",
          [organizationA, map.mapId],
        ),
        run(
          "insert into capabilities (organization_id, dimension_id, position, statement) values ($1, $2, 1, 'Nueva')",
          [organizationA, map.dimensionId],
        ),
        run("update capability_maps set status = 'published' where id = $1", [map.mapId]),
        run('delete from capability_maps where id = $1', [map.mapId]),
      ];

      await expectAllRefused(attempts, INVARIANT_10);
    });
  });

  describe('INV-11 isolation of roles, maps and catalogs', () => {
    let mapB: SeededMap;
    beforeAll(async () => {
      mapB = await seedMap(ownerPool, organizationB, 'draft');
    });

    it('INV-11 a scope of organization A reads nothing of organization B', async () => {
      const tables = [
        'roles',
        'tools',
        'strategic_objectives',
        'capability_maps',
        'levels',
        'dimensions',
        'capabilities',
        'capability_tools',
        'capability_objectives',
        'bonus_rules',
      ];

      for (const table of tables) {
        const [seen] = await run(`select count(*) from ${table} where organization_id = $1`, [organizationB]);
        expect(Number(seen!.rows[0].count), table).toBe(0);
        expect(await count(table, 'organization_id', organizationB), `${table} seeded`).toBeGreaterThan(0);
      }
    });

    it('INV-11 a scope of organization A cannot write into organization B', async () => {
      const attempts = [
        run("insert into roles (organization_id, name) values ($1, 'Intruso')", [organizationB]),
        run("insert into tools (organization_id, name) values ($1, 'Intrusa')", [organizationB]),
        run(
          "insert into dimensions (organization_id, map_id, position, name, kind) values ($1, $2, 9, 'Intrusa', 'transversal')",
          [organizationB, mapB.mapId],
        ),
      ];

      await expectAllRefused(attempts, ROW_LEVEL_SECURITY);
      const [changed] = await run("update dimensions set name = 'Cambiada' where id = $1 returning id", [
        mapB.dimensionId,
      ]);
      expect(changed!.rows).toEqual([]);
    });

    it('INV-11 content of organization A cannot hang from a map, role or tool of organization B', async () => {
      const mapA = await seedMap(ownerPool, organizationA, 'draft');
      // A role of B without maps, so the only thing in the way is the organization.
      const roleOfB = (
        await ownerPool.query("insert into roles (organization_id, name) values ($1, $2) returning id", [
          organizationB,
          `Role ${randomUUID()}`,
        ])
      ).rows[0].id as string;
      const attempts = [
        run('insert into capability_maps (organization_id, role_id, version) values ($1, $2, 9)', [
          organizationA,
          roleOfB,
        ]),
        run(
          "insert into dimensions (organization_id, map_id, position, name, kind) values ($1, $2, 9, 'Cruzada', 'transversal')",
          [organizationA, mapB.mapId],
        ),
        run(
          "insert into capabilities (organization_id, dimension_id, position, statement) values ($1, $2, 9, 'Cruzada')",
          [organizationA, mapB.dimensionId],
        ),
        run('insert into capability_tools (organization_id, capability_id, tool_id) values ($1, $2, $3)', [
          organizationA,
          mapA.capabilityId,
          mapB.toolId,
        ]),
      ];

      await expectAllRefused(attempts, /foreign key/);
    });
  });
});
