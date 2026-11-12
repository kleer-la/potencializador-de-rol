import pg from 'pg';
import { z } from 'zod';

/** Parses `SUPER_ADMIN_EMAILS`: comma-separated emails. */
export function parseEmailList(raw: string | undefined): string[] {
  const entries = (raw ?? '')
    .split(',')
    .map((entry) => entry.trim().toLowerCase())
    .filter((entry) => entry.length > 0);
  for (const entry of entries) {
    if (!z.email().safeParse(entry).success) {
      throw new Error(`SUPER_ADMIN_EMAILS has a value that is not an email: ${entry}`);
    }
  }
  return [...new Set(entries)];
}

/**
 * Creates the first super administrators: persons of the mentoring firm, which are the
 * only ones who can create organizations. Runs with the owner connection because no
 * person exists yet to act. An email that already belongs to someone is left untouched:
 * a person of a client organization is never promoted from configuration.
 */
export async function ensureSuperAdministrators(
  ownerDatabaseUrl: string,
  emails: string[],
): Promise<{ created: string[]; skipped: string[] }> {
  const client = new pg.Client({ connectionString: ownerDatabaseUrl });
  await client.connect();
  try {
    const created: string[] = [];
    const skipped: string[] = [];
    for (const email of emails) {
      const inserted = await client.query(
        `insert into persons (organization_id, email, name) values (null, lower($1), lower($1))
         on conflict (lower(email)) do nothing`,
        [email],
      );
      if (inserted.rowCount === 1) {
        created.push(email);
        continue;
      }
      const existing = await client.query<{ organization_id: string | null }>(
        'select organization_id from persons where lower(email) = lower($1)',
        [email],
      );
      if (existing.rows[0]?.organization_id != null) skipped.push(email);
    }
    return { created, skipped };
  } finally {
    await client.end();
  }
}
