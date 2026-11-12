import { randomUUID } from 'node:crypto';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { APP_ROLE_PASSWORD } from '../../test-support/postgres.global-setup.ts';
import { migrate } from './migrate.ts';

describe('migration runner', () => {
  let ownerPool: pg.Pool;
  let databasePool: pg.Pool;
  let databaseUrl: string;
  let directory: string;
  let migrationsDirectory: URL;

  const run = () =>
    migrate({
      ownerDatabaseUrl: databaseUrl,
      appRolePassword: APP_ROLE_PASSWORD,
      migrationsDirectory,
    });
  const appliedNames = async () =>
    (await databasePool.query<{ name: string }>('select name from schema_migrations order by name')).rows.map(
      (row) => row.name,
    );
  const tableExists = async (table: string) =>
    (await databasePool.query('select to_regclass($1) as found', [table])).rows[0].found !== null;

  beforeAll(async () => {
    // A separate empty database, so these files never touch the schema other tests use.
    ownerPool = new pg.Pool({ connectionString: inject('ownerDatabaseUrl') });
    const databaseName = `migrate_${randomUUID().replaceAll('-', '')}`;
    await ownerPool.query(`create database ${databaseName}`);
    const url = new URL(inject('ownerDatabaseUrl'));
    url.pathname = `/${databaseName}`;
    databaseUrl = url.toString();
    databasePool = new pg.Pool({ connectionString: databaseUrl });

    directory = await mkdtemp(join(tmpdir(), 'migrations-'));
    migrationsDirectory = pathToFileURL(`${directory}/`);
  });

  afterAll(async () => {
    await databasePool.end();
    await ownerPool.end();
    await rm(directory, { recursive: true, force: true });
  });

  it('applies files in name order and skips them on the next run', async () => {
    // 0002 depends on 0001, so a wrong order fails.
    await writeFile(join(directory, '0002_second.sql'), 'alter table first add column note text;');
    await writeFile(join(directory, '0001_first.sql'), 'create table first (id int);');

    const firstRun = await run();
    const secondRun = await run();

    expect(firstRun).toEqual(['0001_first.sql', '0002_second.sql']);
    expect(secondRun).toEqual([]);
    expect(await appliedNames()).toEqual(['0001_first.sql', '0002_second.sql']);
  });

  it('rolls back a failing migration completely and applies it once corrected', async () => {
    const file = join(directory, '0003_third.sql');
    await writeFile(file, 'create table third (id int); select * from missing_table;');

    await expect(run()).rejects.toThrow('migration 0003_third.sql failed');

    expect(await tableExists('third')).toBe(false);
    expect(await appliedNames()).toEqual(['0001_first.sql', '0002_second.sql']);

    await writeFile(file, 'create table third (id int);');

    expect(await run()).toEqual(['0003_third.sql']);
    expect(await tableExists('third')).toBe(true);
  });

  it('upgrades a database migrated before checksums existed, then guards its files', async () => {
    const databaseName = `migrate_${randomUUID().replaceAll('-', '')}`;
    await ownerPool.query(`create database ${databaseName}`);
    const url = new URL(inject('ownerDatabaseUrl'));
    url.pathname = `/${databaseName}`;
    const legacyPool = new pg.Pool({ connectionString: url.toString() });
    const legacyDirectory = await mkdtemp(join(tmpdir(), 'migrations-legacy-'));
    const runLegacy = () =>
      migrate({
        ownerDatabaseUrl: url.toString(),
        appRolePassword: APP_ROLE_PASSWORD,
        migrationsDirectory: pathToFileURL(`${legacyDirectory}/`),
      });
    try {
      // The table exactly as the first runner created it, with one file already applied.
      await legacyPool.query(
        `create table schema_migrations (
           name text primary key,
           applied_at timestamptz not null default now()
         )`,
      );
      await legacyPool.query("insert into schema_migrations (name) values ('0001_first.sql')");
      await legacyPool.query('create table first (id int)');
      await writeFile(join(legacyDirectory, '0001_first.sql'), 'create table first (id int);');
      await writeFile(join(legacyDirectory, '0002_second.sql'), 'create table second (id int);');

      const upgraded = await runLegacy();

      expect(upgraded).toEqual(['0002_second.sql']);
      const stored = await legacyPool.query<{ name: string; checksum: string | null }>(
        'select name, checksum from schema_migrations order by name',
      );
      expect(stored.rows.map((row) => row.name)).toEqual(['0001_first.sql', '0002_second.sql']);
      expect(stored.rows.every((row) => /^[0-9a-f]{64}$/.test(row.checksum ?? ''))).toBe(true);

      await writeFile(join(legacyDirectory, '0001_first.sql'), 'create table first (id bigint);');
      await expect(runLegacy()).rejects.toThrow(
        'migration 0001_first.sql was changed after it was applied; add a new migration instead',
      );
    } finally {
      await legacyPool.end();
      await rm(legacyDirectory, { recursive: true, force: true });
    }
  });

  it('refuses to run when an applied migration was edited afterwards', async () => {
    await writeFile(join(directory, '0001_first.sql'), 'create table first (id int, extra int);');

    await expect(run()).rejects.toThrow(
      'migration 0001_first.sql was changed after it was applied; add a new migration instead',
    );

    await writeFile(join(directory, '0001_first.sql'), 'create table first (id int);');
    expect(await run()).toEqual([]);
  });
});
