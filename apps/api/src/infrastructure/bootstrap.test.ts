import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { createSeeder } from '../../test-support/seed.ts';
import { ensureSuperAdministrators, parseEmailList } from './bootstrap.ts';

describe('parseEmailList', () => {
  it('splits by comma, trims, lowercases and drops empty entries and repeats', () => {
    expect(parseEmailList(' Ana@Kleer.la, ,luis@kleer.la,ana@kleer.la ')).toEqual([
      'ana@kleer.la',
      'luis@kleer.la',
    ]);
    expect(parseEmailList('')).toEqual([]);
    expect(parseEmailList(undefined)).toEqual([]);
  });

  it('rejects a value that is not an email', () => {
    expect(() => parseEmailList('ana@kleer.la,not-an-email')).toThrow('not-an-email');
  });
});

describe('ensureSuperAdministrators', () => {
  let ownerPool: pg.Pool;
  const ownerDatabaseUrl = inject('ownerDatabaseUrl');

  const personsWith = (email: string) =>
    ownerPool.query<{ organization_id: string | null; name: string }>(
      'select organization_id, name from persons where lower(email) = lower($1)',
      [email],
    );

  beforeAll(() => {
    ownerPool = new pg.Pool({ connectionString: ownerDatabaseUrl });
  });

  afterAll(async () => {
    await ownerPool.end();
  });

  it('creates each email as a person of the mentoring firm, once', async () => {
    const email = `${randomUUID()}@kleer.test`;

    const first = await ensureSuperAdministrators(ownerDatabaseUrl, [email]);
    const second = await ensureSuperAdministrators(ownerDatabaseUrl, [email]);

    expect(first).toEqual({ created: [email], skipped: [] });
    expect(second).toEqual({ created: [], skipped: [] });
    expect((await personsWith(email)).rows).toEqual([{ organization_id: null, name: email }]);
  });

  it('never turns a person of a client organization into a super administrator', async () => {
    const seed = createSeeder(ownerPool);
    const organizationId = await seed.organization();
    const personId = await seed.person(organizationId);
    const email = (await ownerPool.query('select email from persons where id = $1', [personId])).rows[0]
      .email as string;

    const result = await ensureSuperAdministrators(ownerDatabaseUrl, [email.toUpperCase()]);

    expect(result).toEqual({ created: [], skipped: [email.toUpperCase()] });
    expect((await personsWith(email)).rows).toEqual([{ organization_id: organizationId, name: 'Test Person' }]);
  });
});
