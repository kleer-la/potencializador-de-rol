import { sql } from 'drizzle-orm';
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import type pg from 'pg';

export type Database = NodePgDatabase;
export type ScopedTransaction = Parameters<Parameters<Database['transaction']>[0]>[0];

/**
 * Who acts and inside which organization. Row Level Security reads it.
 * `organizationId` must be set only after the application has authorized the person
 * for that organization; the database trusts it.
 */
export type AccessScope = {
  personId: string | null;
  organizationId: string | null;
};

export function createDatabase(pool: pg.Pool): Database {
  return drizzle(pool);
}

/**
 * Runs `work` in a transaction that carries the scope. This is the only way the API
 * touches organization data: a query outside it sees no rows. The settings are
 * transaction-local, so the scope cannot leak to the next user of the connection.
 */
export function withScope<T>(
  db: Database,
  scope: AccessScope,
  work: (tx: ScopedTransaction) => Promise<T>,
): Promise<T> {
  return db.transaction(async (tx) => {
    await tx.execute(
      sql`select set_config('app.person_id', ${scope.personId ?? ''}, true),
                 set_config('app.organization_id', ${scope.organizationId ?? ''}, true)`,
    );
    return work(tx);
  });
}
