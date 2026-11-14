import { and, eq, sql } from 'drizzle-orm';
import { persons } from '../infrastructure/schema.ts';
import type { ScopedTransaction } from '../infrastructure/scoped-transaction.ts';

export type InvitedPerson = { id: string; name: string; email: string };

/**
 * The person of the organization with this email, invited (created) when there is none.
 * Answers `email_taken` when the email belongs to a person the caller cannot see (another
 * organization or the mentoring firm), without saying which. `email` comes lower-cased.
 */
export async function findOrInvitePerson(
  tx: ScopedTransaction,
  organizationId: string,
  email: string,
  name: string,
): Promise<{ person: InvitedPerson; created: boolean } | 'email_taken'> {
  const findInOrganization = () =>
    tx
      .select({ id: persons.id, name: persons.name, email: persons.email })
      .from(persons)
      .where(and(eq(persons.organizationId, organizationId), sql`lower(${persons.email}) = ${email}`));

  const [existing] = await findInOrganization();
  if (existing !== undefined) return { person: existing, created: false };
  // Emails are unique across organizations. No row comes back when the email is taken: by a
  // concurrent invitation to this organization, or by a person elsewhere.
  const [inserted] = await tx
    .insert(persons)
    .values({ organizationId, email, name })
    .onConflictDoNothing()
    .returning({ id: persons.id, name: persons.name, email: persons.email });
  if (inserted !== undefined) return { person: inserted, created: true };
  const [concurrent] = await findInOrganization();
  return concurrent === undefined ? 'email_taken' : { person: concurrent, created: false };
}
