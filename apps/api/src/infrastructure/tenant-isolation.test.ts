import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { createSeeder } from '../../test-support/seed.ts';
import { APP_ROLE } from './migrate.ts';
import { organizationMemberships, organizations, persons } from './schema.ts';
import { createDatabase, withScope, type Database } from './scoped-transaction.ts';

const ROW_LEVEL_SECURITY_ERROR = /row-level security/;

/** Drizzle wraps the driver error; the PostgreSQL message is in the cause chain. */
async function rejectionText(work: Promise<unknown>): Promise<string> {
  try {
    await work;
  } catch (error) {
    const parts: string[] = [];
    for (let current: unknown = error; current instanceof Error; current = current.cause) {
      parts.push(current.message);
    }
    return parts.join(' | ');
  }
  return 'did not reject';
}

describe('INV-11 isolation by organization (database)', () => {
  let ownerPool: pg.Pool;
  let appPool: pg.Pool;
  let db: Database;
  let seed: ReturnType<typeof createSeeder>;

  let organizationA: string;
  let organizationB: string;
  let personA: string;
  let personB: string;
  let superAdministrator: string;

  beforeAll(async () => {
    ownerPool = new pg.Pool({ connectionString: inject('ownerDatabaseUrl') });
    appPool = new pg.Pool({ connectionString: inject('appDatabaseUrl') });
    db = createDatabase(appPool);
    seed = createSeeder(ownerPool);

    organizationA = await seed.organization();
    organizationB = await seed.organization();
    personA = await seed.person(organizationA);
    personB = await seed.person(organizationB);
    superAdministrator = await seed.person(null);
    await seed.membership(organizationA, personA, 'administrator');
    await seed.membership(organizationB, personB, 'administrator');
  });

  afterAll(async () => {
    await appPool.end();
    await ownerPool.end();
  });

  it('INV-11 a scope of organization A reads no organization, person or membership of organization B', async () => {
    const scopeA = { personId: personA, organizationId: organizationA };

    const seen = await withScope(db, scopeA, async (tx) => ({
      organizations: await tx.select().from(organizations),
      persons: await tx.select().from(persons),
      memberships: await tx.select().from(organizationMemberships),
      personsOfB: await tx.select().from(persons).where(eq(persons.organizationId, organizationB)),
    }));

    expect(seen.organizations.map((row) => row.id)).toEqual([organizationA]);
    expect(seen.persons.map((row) => row.id)).toEqual([personA]);
    expect(seen.memberships.map((row) => row.organizationId)).toEqual([organizationA]);
    expect(seen.personsOfB).toEqual([]);
  });

  it('INV-11 a scope of organization A cannot insert a person or a membership into organization B', async () => {
    const scopeA = { personId: personA, organizationId: organizationA };
    const email = `${randomUUID()}@example.test`;

    const personInsert = rejectionText(
      withScope(db, scopeA, (tx) =>
        tx.insert(persons).values({ organizationId: organizationB, email, name: 'Intruder' }),
      ),
    );
    const membershipInsert = rejectionText(
      withScope(db, scopeA, (tx) =>
        tx
          .insert(organizationMemberships)
          .values({ organizationId: organizationB, personId: personA, role: 'administrator' }),
      ),
    );

    expect(await personInsert).toMatch(ROW_LEVEL_SECURITY_ERROR);
    expect(await membershipInsert).toMatch(ROW_LEVEL_SECURITY_ERROR);
    const stored = await ownerPool.query('select 1 from persons where email = $1', [email]);
    expect(stored.rowCount).toBe(0);
  });

  it('INV-11 a scope of organization A cannot update, move or delete a person of organization B', async () => {
    const scopeA = { personId: personA, organizationId: organizationA };

    const changed = await withScope(db, scopeA, async (tx) => ({
      updated: await tx
        .update(persons)
        .set({ name: 'Changed' })
        .where(eq(persons.id, personB))
        .returning({ id: persons.id }),
      deleted: await tx.delete(persons).where(eq(persons.id, personB)).returning({ id: persons.id }),
    }));
    const moveOwnPersonToB = rejectionText(
      withScope(db, scopeA, (tx) =>
        tx.update(persons).set({ organizationId: organizationB }).where(eq(persons.id, personA)),
      ),
    );

    expect(changed).toEqual({ updated: [], deleted: [] });
    expect(await moveOwnPersonToB).toMatch(ROW_LEVEL_SECURITY_ERROR);
    const stored = await ownerPool.query<{ name: string }>('select name from persons where id = $1', [
      personB,
    ]);
    expect(stored.rows).toEqual([{ name: 'Test Person' }]);
  });

  it('INV-11 a connection without scope reads nothing and cannot write', async () => {
    const noScope = { personId: null, organizationId: null };

    const seen = await withScope(db, noScope, async (tx) => ({
      organizations: await tx.select().from(organizations),
      persons: await tx.select().from(persons),
      memberships: await tx.select().from(organizationMemberships),
    }));
    const unscopedRead = await appPool.query('select id from persons');
    const insert = rejectionText(
      withScope(db, noScope, (tx) => tx.insert(organizations).values({ name: 'No scope' })),
    );

    expect(seen).toEqual({ organizations: [], persons: [], memberships: [] });
    expect(unscopedRead.rows).toEqual([]);
    expect(await insert).toMatch(ROW_LEVEL_SECURITY_ERROR);
  });

  it('INV-11 a scope does not leak into the next use of the same connection', async () => {
    const singleConnectionPool = new pg.Pool({
      connectionString: inject('appDatabaseUrl'),
      max: 1,
    });
    try {
      const singleConnectionDb = createDatabase(singleConnectionPool);
      await withScope(
        singleConnectionDb,
        { personId: superAdministrator, organizationId: null },
        (tx) => tx.select().from(persons),
      );

      const afterwards = await singleConnectionPool.query('select id from persons');

      expect(afterwards.rows).toEqual([]);
    } finally {
      await singleConnectionPool.end();
    }
  });

  it('INV-11 a super administrator reads and administers both organizations', async () => {
    const superScope = { personId: superAdministrator, organizationId: null };
    const email = `${randomUUID()}@example.test`;

    const result = await withScope(db, superScope, async (tx) => {
      const created = await tx
        .insert(organizations)
        .values({ name: `Created by super administrator ${randomUUID()}` })
        .returning({ id: organizations.id });
      const invited = await tx
        .insert(persons)
        .values({ organizationId: organizationB, email, name: 'Invited' })
        .returning({ id: persons.id });
      return {
        created,
        invited,
        organizationIds: (await tx.select().from(organizations)).map((row) => row.id),
        personIds: (await tx.select().from(persons)).map((row) => row.id),
      };
    });

    expect(result.created).toHaveLength(1);
    expect(result.invited).toHaveLength(1);
    expect(result.organizationIds).toEqual(expect.arrayContaining([organizationA, organizationB]));
    expect(result.personIds).toEqual(expect.arrayContaining([personA, personB]));
  });

  it('INV-11 a person of an organization is never treated as super administrator', async () => {
    const personOnly = { personId: personA, organizationId: null };

    const seen = await withScope(db, personOnly, async (tx) => ({
      persons: (await tx.select().from(persons)).map((row) => row.id),
      organizations: (await tx.select().from(organizations)).map((row) => row.id),
    }));
    const createOrganization = rejectionText(
      withScope(db, personOnly, (tx) => tx.insert(organizations).values({ name: 'Not allowed' })),
    );

    expect(seen.persons).toEqual([personA]);
    expect(seen.organizations).toEqual([organizationA]);
    expect(await createOrganization).toMatch(ROW_LEVEL_SECURITY_ERROR);
  });

  it('INV-11 the API database role is not owner, not superuser and cannot bypass row level security', async () => {
    const role = await ownerPool.query(
      'select rolsuper, rolbypassrls, rolcreaterole, rolcreatedb from pg_roles where rolname = $1',
      [APP_ROLE],
    );
    const ownedTables = await ownerPool.query(
      "select tablename from pg_tables where schemaname = 'public' and tableowner = $1",
      [APP_ROLE],
    );
    const connectedAs = await appPool.query<{ current_user: string }>('select current_user');

    expect(role.rows).toEqual([
      { rolsuper: false, rolbypassrls: false, rolcreaterole: false, rolcreatedb: false },
    ]);
    expect(ownedTables.rows).toEqual([]);
    expect(connectedAs.rows[0]?.current_user).toBe(APP_ROLE);
  });

  it('INV-11 every table the API role can reach has row level security enabled', async () => {
    const unprotected = await ownerPool.query(
      `select c.relname
         from pg_class c
         join pg_namespace n on n.oid = c.relnamespace
        where n.nspname = 'public'
          and c.relkind = 'r'
          and not c.relrowsecurity
          and has_table_privilege($1, c.oid, 'select, insert, update, delete')`,
      [APP_ROLE],
    );

    expect(unprotected.rows).toEqual([]);
  });
});
