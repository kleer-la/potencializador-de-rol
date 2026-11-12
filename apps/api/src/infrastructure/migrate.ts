import { readdir, readFile } from 'node:fs/promises';
import pg from 'pg';

/** Role the API connects as. It owns nothing and cannot bypass Row Level Security. */
export const APP_ROLE = 'potencializador_app';

const MIGRATIONS_DIRECTORY = new URL('../../migrations/', import.meta.url);
/** Arbitrary constant; serializes concurrent migration runs on the same database. */
const MIGRATION_LOCK_KEY = 4_211_090;

export type MigrateOptions = {
  /** Connection of the role that owns the schema. Never used by the API at runtime. */
  ownerDatabaseUrl: string;
  appRolePassword: string;
};

/** Applies pending SQL migrations in file-name order, each in its own transaction. */
export async function migrate(options: MigrateOptions): Promise<string[]> {
  const client = new pg.Client({ connectionString: options.ownerDatabaseUrl });
  await client.connect();
  try {
    await client.query('select pg_advisory_lock($1)', [MIGRATION_LOCK_KEY]);
    await ensureAppRole(client, options.appRolePassword);
    await client.query(
      `create table if not exists schema_migrations (
         name text primary key,
         applied_at timestamptz not null default now()
       )`,
    );

    const appliedRows = await client.query<{ name: string }>('select name from schema_migrations');
    const applied = new Set(appliedRows.rows.map((row) => row.name));
    const files = (await readdir(MIGRATIONS_DIRECTORY)).filter((file) => file.endsWith('.sql')).sort();

    const newlyApplied: string[] = [];
    for (const file of files) {
      if (applied.has(file)) continue;
      const statements = await readFile(new URL(file, MIGRATIONS_DIRECTORY), 'utf8');
      await client.query('begin');
      try {
        await client.query(statements);
        await client.query('insert into schema_migrations (name) values ($1)', [file]);
        await client.query('commit');
      } catch (error) {
        await client.query('rollback');
        throw new Error(`migration ${file} failed`, { cause: error });
      }
      newlyApplied.push(file);
    }
    return newlyApplied;
  } finally {
    await client.end();
  }
}

/** Migrations grant privileges to the role, so it must exist before they run. */
async function ensureAppRole(client: pg.Client, password: string): Promise<void> {
  await client.query(
    `do $$ begin
       if not exists (select from pg_roles where rolname = '${APP_ROLE}') then
         create role ${APP_ROLE};
       end if;
     end $$`,
  );
  await client.query(
    `alter role ${APP_ROLE} with login nosuperuser nobypassrls nocreatedb nocreaterole
       password ${client.escapeLiteral(password)}`,
  );
}
