import { randomUUID } from 'node:crypto';
import type pg from 'pg';

/** Seeds through the owner connection, which bypasses Row Level Security. */
export function createSeeder(ownerPool: pg.Pool) {
  return {
    async organization(): Promise<string> {
      const result = await ownerPool.query<{ id: string }>(
        'insert into organizations (name) values ($1) returning id',
        [`Organization ${randomUUID()}`],
      );
      return result.rows[0]!.id;
    },

    /** `organizationId: null` creates a person of the mentoring firm (super administrator). */
    async person(organizationId: string | null): Promise<string> {
      const result = await ownerPool.query<{ id: string }>(
        'insert into persons (organization_id, email, name) values ($1, $2, $3) returning id',
        [organizationId, `${randomUUID()}@example.test`, 'Test Person'],
      );
      return result.rows[0]!.id;
    },

    async membership(organizationId: string, personId: string, role: string): Promise<string> {
      const result = await ownerPool.query<{ id: string }>(
        'insert into organization_memberships (organization_id, person_id, role) values ($1, $2, $3) returning id',
        [organizationId, personId, role],
      );
      return result.rows[0]!.id;
    },
  };
}
