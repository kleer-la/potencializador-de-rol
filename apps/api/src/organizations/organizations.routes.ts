import {
  MEMBERSHIP_ROLES,
  canAdministerOrganization,
  canCreateOrganization,
  type Actor,
  type MembershipRole,
} from '@potencializador/domain';
import { and, eq, sql } from 'drizzle-orm';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { createIdentityStore } from '../identity/identity-store.ts';
import { organizationMemberships, organizations, persons } from '../infrastructure/schema.ts';
import { withScope, type Database } from '../infrastructure/scoped-transaction.ts';

const organizationInput = z.object({ name: z.string().trim().min(1).max(120) });
const invitationInput = z.object({
  email: z.string().trim().toLowerCase().pipe(z.email().max(254)),
  name: z.string().trim().min(1).max(120),
  role: z.enum(MEMBERSHIP_ROLES),
});
const organizationParams = z.object({ organizationId: z.uuid() });

const UNIQUE_VIOLATION = '23505';

/** Drizzle wraps the driver error; the PostgreSQL code is somewhere in the cause chain. */
function postgresCode(error: unknown): string | undefined {
  for (let current = error; current instanceof Error; current = current.cause) {
    const code = (current as { code?: unknown }).code;
    if (typeof code === 'string') return code;
  }
  return undefined;
}

type Member = { personId: string; name: string; email: string; roles: MembershipRole[] };

/**
 * Organizations and their members. Must be registered on an instance where
 * `registerIdentity` already ran: it relies on `request.personId`.
 *
 * Every handler authorizes with the domain policy first and only then opens a transaction
 * scoped to the organization; Row Level Security is the second barrier, not the only one.
 */
export async function registerOrganizations(
  api: FastifyInstance,
  options: { database: Database },
): Promise<void> {
  const db = options.database;
  const identityStore = createIdentityStore(db);

  /** The signed-in person as an actor, or `null` after answering 401. */
  const requireActor = async (
    request: FastifyRequest,
    reply: FastifyReply,
  ): Promise<{ personId: string; actor: Actor } | null> => {
    const current = request.personId === null ? null : await identityStore.describePerson(request.personId);
    if (current === null) {
      await reply.code(401).send({ error: 'not_signed_in' });
      return null;
    }
    return {
      personId: current.person.id,
      actor: {
        isSuperAdmin: current.isSuperAdmin,
        memberships: current.memberships.map((membership) => ({
          organizationId: membership.organizationId,
          role: membership.role as MembershipRole,
        })),
      },
    };
  };

  /**
   * The person and the organization they may administer, or `null` after answering.
   * A member gets the same 403 for an organization that is not theirs and for one that
   * does not exist, so the answer reveals nothing about other organizations.
   */
  const requireAdministrator = async (request: FastifyRequest, reply: FastifyReply) => {
    const signedIn = await requireActor(request, reply);
    if (signedIn === null) return null;
    const params = organizationParams.safeParse(request.params);
    if (!params.success) {
      await reply.code(400).send({ error: 'invalid_request' });
      return null;
    }
    if (!canAdministerOrganization(signedIn.actor, params.data.organizationId)) {
      await reply.code(403).send({ error: 'forbidden' });
      return null;
    }
    return { personId: signedIn.personId, organizationId: params.data.organizationId };
  };

  api.get('/organizations', async (request, reply) => {
    const signedIn = await requireActor(request, reply);
    if (signedIn === null) return reply;
    // No organization scope: the read policy returns all of them to a super administrator
    // and, to anyone else, the organizations where they have a membership.
    const rows = await withScope(db, { personId: signedIn.personId, organizationId: null }, (tx) =>
      tx.select({ id: organizations.id, name: organizations.name }).from(organizations).orderBy(organizations.name),
    );
    return { organizations: rows };
  });

  api.post('/organizations', async (request, reply) => {
    const signedIn = await requireActor(request, reply);
    if (signedIn === null) return reply;
    if (!canCreateOrganization(signedIn.actor)) {
      return reply.code(403).send({ error: 'forbidden' });
    }
    const input = organizationInput.safeParse(request.body);
    if (!input.success) return reply.code(400).send({ error: 'invalid_request' });

    const [created] = await withScope(db, { personId: signedIn.personId, organizationId: null }, (tx) =>
      tx
        .insert(organizations)
        .values({ name: input.data.name })
        .returning({ id: organizations.id, name: organizations.name }),
    );
    return reply.code(201).send(created);
  });

  api.get('/organizations/:organizationId/members', async (request, reply) => {
    const administrator = await requireAdministrator(request, reply);
    if (administrator === null) return reply;
    const { personId, organizationId } = administrator;

    const members = await withScope(db, { personId, organizationId }, async (tx) => {
      const [organization] = await tx
        .select({ id: organizations.id })
        .from(organizations)
        .where(eq(organizations.id, organizationId));
      if (organization === undefined) return null;

      const rows = await tx
        .select({
          personId: persons.id,
          name: persons.name,
          email: persons.email,
          role: organizationMemberships.role,
        })
        .from(persons)
        .leftJoin(
          organizationMemberships,
          and(
            eq(organizationMemberships.personId, persons.id),
            eq(organizationMemberships.organizationId, organizationId),
          ),
        )
        .where(eq(persons.organizationId, organizationId))
        .orderBy(persons.name, persons.email, organizationMemberships.role);

      const byPerson = new Map<string, Member>();
      for (const row of rows) {
        const member = byPerson.get(row.personId) ?? {
          personId: row.personId,
          name: row.name,
          email: row.email,
          roles: [],
        };
        if (row.role !== null) member.roles.push(row.role);
        byPerson.set(row.personId, member);
      }
      return [...byPerson.values()];
    });

    if (members === null) return reply.code(404).send({ error: 'organization_not_found' });
    return { members };
  });

  api.post('/organizations/:organizationId/members', async (request, reply) => {
    const administrator = await requireAdministrator(request, reply);
    if (administrator === null) return reply;
    const { personId, organizationId } = administrator;
    const input = invitationInput.safeParse(request.body);
    if (!input.success) return reply.code(400).send({ error: 'invalid_request' });
    const { email, name, role } = input.data;

    let outcome;
    try {
      outcome = await withScope(db, { personId, organizationId }, async (tx) => {
        const [organization] = await tx
          .select({ id: organizations.id })
          .from(organizations)
          .where(eq(organizations.id, organizationId));
        if (organization === undefined) return null;

        let [person] = await tx
          .select({ id: persons.id, name: persons.name, email: persons.email })
          .from(persons)
          .where(and(eq(persons.organizationId, organizationId), sql`lower(${persons.email}) = ${email}`));
        const created = person === undefined;
        if (person === undefined) {
          [person] = await tx
            .insert(persons)
            .values({ organizationId, email, name })
            .returning({ id: persons.id, name: persons.name, email: persons.email });
        }
        const invited = person!;

        await tx
          .insert(organizationMemberships)
          .values({ organizationId, personId: invited.id, role })
          .onConflictDoNothing();
        const roles = await tx
          .select({ role: organizationMemberships.role })
          .from(organizationMemberships)
          .where(
            and(
              eq(organizationMemberships.organizationId, organizationId),
              eq(organizationMemberships.personId, invited.id),
            ),
          )
          .orderBy(organizationMemberships.role);

        const member: Member = {
          personId: invited.id,
          name: invited.name,
          email: invited.email,
          roles: roles.map((row) => row.role),
        };
        return { created, member };
      });
    } catch (error) {
      // Emails are unique across organizations. The email already belongs to a person the
      // caller cannot see; the answer says only that the invitation cannot be made.
      if (postgresCode(error) === UNIQUE_VIOLATION) {
        return reply.code(409).send({ error: 'invitation_not_possible' });
      }
      throw error;
    }

    if (outcome === null) return reply.code(404).send({ error: 'organization_not_found' });
    return reply.code(outcome.created ? 201 : 200).send(outcome.member);
  });
}
