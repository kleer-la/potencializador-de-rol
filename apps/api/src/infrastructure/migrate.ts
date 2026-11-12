import { createHash } from 'node:crypto';
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
  /** Directory with the `.sql` files; defaults to `apps/api/migrations`. */
  migrationsDirectory?: URL;
};

/** Applies pending SQL migrations in file-name order, each in its own transaction. */
export async function migrate(options: MigrateOptions): Promise<string[]> {
  const directory = options.migrationsDirectory ?? MIGRATIONS_DIRECTORY;
  const client = new pg.Client({ connectionString: options.ownerDatabaseUrl });
  await client.connect();
  try {
    await client.query('select pg_advisory_lock($1)', [MIGRATION_LOCK_KEY]);
    await ensureAppRole(client, options.appRolePassword);
    await client.query(
      `create table if not exists schema_migrations (
         name text primary key,
         checksum text not null,
         applied_at timestamptz not null default now()
       )`,
    );

    const appliedRows = await client.query<{ name: string; checksum: string }>(
      'select name, checksum from schema_migrations',
    );
    const applied = new Map(appliedRows.rows.map((row) => [row.name, row.checksum]));
    const files = (await readdir(directory)).filter((file) => file.endsWith('.sql')).sort();

    const newlyApplied: string[] = [];
    for (const file of files) {
      const statements = await readFile(new URL(file, directory), 'utf8');
      const checksum = createHash('sha256').update(statements).digest('hex');
      const appliedChecksum = applied.get(file);
      if (appliedChecksum !== undefined) {
        // An applied file is never run again, so an edit would silently reach only new
        // databases. Stop instead of letting schemas drift apart.
        if (appliedChecksum !== checksum) {
          throw new Error(
            `migration ${file} was changed after it was applied; add a new migration instead`,
          );
        }
        continue;
      }
      await client.query('begin');
      try {
        await client.query(statements);
        await client.query('insert into schema_migrations (name, checksum) values ($1, $2)', [
          file,
          checksum,
        ]);
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
