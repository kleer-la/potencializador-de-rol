import { createHash, randomBytes } from 'node:crypto';
import { eq, sql } from 'drizzle-orm';
import { organizationMemberships, organizations, persons } from '../infrastructure/schema.ts';
import { withScope, type Database } from '../infrastructure/scoped-transaction.ts';
import type { VerifiedIdentity } from './identity-provider.ts';

export type CurrentPerson = {
  person: { id: string; name: string; email: string };
  isSuperAdmin: boolean;
  memberships: { organizationId: string; organizationName: string; role: string }[];
};

const hashToken = (token: string) => createHash('sha256').update(token).digest('hex');

/** Persistence of sign-in and sessions, through the narrow database functions of migration 0002. */
export function createIdentityStore(db: Database) {
  return {
    /** The invited person this provider account belongs to, or `null`. */
    async resolvePerson(identity: VerifiedIdentity): Promise<string | null> {
      const result = await db.execute<{ person_id: string | null }>(
        sql`select app_sign_in(${identity.issuer}, ${identity.subject}, ${identity.verifiedEmail}) as person_id`,
      );
      return result.rows[0]?.person_id ?? null;
    },

    /** Returns the value for the session cookie; only its hash is stored. */
    async createSession(personId: string, ttlHours: number): Promise<string> {
      const token = randomBytes(32).toString('base64url');
      const expiresAt = new Date(Date.now() + ttlHours * 3_600_000);
      await db.execute(
        sql`select app_create_session(${personId}::uuid, ${hashToken(token)}, ${expiresAt.toISOString()}::timestamptz)`,
      );
      return token;
    },

    async findSessionPerson(token: string): Promise<string | null> {
      const result = await db.execute<{ person_id: string | null }>(
        sql`select app_session_person(${hashToken(token)}) as person_id`,
      );
      return result.rows[0]?.person_id ?? null;
    },

    async deleteSession(token: string): Promise<void> {
      await db.execute(sql`select app_delete_session(${hashToken(token)})`);
    },

    /**
     * Stores a link for an invited person, to create a password or to change a forgotten one.
     * Returns who to mail, or `null` when nobody has that email.
     */
    async registerPassword(
      email: string,
      token: string,
      expiresAt: Date,
    ): Promise<{ name: string; hasPassword: boolean } | null> {
      const result = await db.execute<{ name: string; has_password: boolean }>(
        sql`select name, has_password from app_password_register(${email}, ${hashToken(token)}, ${expiresAt.toISOString()}::timestamptz)`,
      );
      const row = result.rows[0];
      return row === undefined ? null : { name: row.name, hasPassword: row.has_password };
    },

    /**
     * Sets the password chosen on the page of the link, ending the person's sessions. Returns
     * the person, or `null` for an unknown, expired or used link.
     */
    async confirmPassword(token: string, passwordHash: string): Promise<string | null> {
      const result = await db.execute<{ person_id: string | null }>(
        sql`select app_password_confirm(${hashToken(token)}, ${passwordHash}) as person_id`,
      );
      return result.rows[0]?.person_id ?? null;
    },

    /**
     * Reserves one password check, counted as a failure until `passwordSucceeded`.
     * `null`: nobody with that email has a password. `locked`: too many failures in a row.
     */
    async beginPasswordAttempt(
      email: string,
    ): Promise<{ locked: true } | { locked: false; personId: string; passwordHash: string } | null> {
      const result = await db.execute<{ person_id: string; password_hash: string | null; locked: boolean }>(
        sql`select person_id, password_hash, locked from app_password_begin_attempt(${email})`,
      );
      const row = result.rows[0];
      if (row === undefined) return null;
      if (row.locked || row.password_hash === null) return { locked: true };
      return { locked: false, personId: row.person_id, passwordHash: row.password_hash };
    },

    async passwordSucceeded(personId: string): Promise<void> {
      await db.execute(sql`select app_password_succeeded(${personId}::uuid)`);
    },

    async describePerson(personId: string): Promise<CurrentPerson | null> {
      return withScope(db, { personId, organizationId: null }, async (tx) => {
        const [person] = await tx.select().from(persons).where(eq(persons.id, personId));
        if (person === undefined) return null;
        const memberships = await tx
          .select({
            organizationId: organizationMemberships.organizationId,
            organizationName: organizations.name,
            role: organizationMemberships.role,
          })
          .from(organizationMemberships)
          .innerJoin(organizations, eq(organizations.id, organizationMemberships.organizationId))
          .where(eq(organizationMemberships.personId, personId))
          .orderBy(organizations.name, organizationMemberships.role);
        return {
          person: { id: person.id, name: person.name, email: person.email },
          isSuperAdmin: person.organizationId === null,
          memberships,
        };
      });
    },
  };
}

export type IdentityStore = ReturnType<typeof createIdentityStore>;
