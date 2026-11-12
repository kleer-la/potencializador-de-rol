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

  it('refuses to run when an applied migration was edited afterwards', async () => {
    await writeFile(join(directory, '0001_first.sql'), 'create table first (id int, extra int);');

    await expect(run()).rejects.toThrow(
      'migration 0001_first.sql was changed after it was applied; add a new migration instead',
    );

    await writeFile(join(directory, '0001_first.sql'), 'create table first (id int);');
    expect(await run()).toEqual([]);
  });
});
