import {
  MEMBERSHIP_ROLES,
  canAdministerOrganization,
  canCreateOrganization,
  type MembershipRole,
} from '@potencializador/domain';
import { and, eq, sql } from 'drizzle-orm';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { createOrganizationAccess } from '../access/organization-access.ts';
import { findOrInvitePerson } from './invite-person.ts';
import { organizationMemberships, organizations, persons } from '../infrastructure/schema.ts';
import { withScope, type Database } from '../infrastructure/scoped-transaction.ts';

const organizationInput = z.object({ name: z.string().trim().min(1).max(120) });
const invitationInput = z.object({
  email: z.string().trim().toLowerCase().pipe(z.email().max(254)),
  name: z.string().trim().min(1).max(120),
  // Without a role, the person belongs to the organization only to be enrolled in programs.
  role: z.enum(MEMBERSHIP_ROLES).optional(),
});

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
  const { requireActor, requireOrganization } = createOrganizationAccess(db);
  const requireAdministrator = (request: FastifyRequest, reply: FastifyReply) =>
    requireOrganization(request, reply, canAdministerOrganization);

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
    const { organizationId, scope } = administrator;

    const members = await withScope(db, scope, async (tx) => {
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

    return { members };
  });

  api.post('/organizations/:organizationId/members', async (request, reply) => {
    const administrator = await requireAdministrator(request, reply);
    if (administrator === null) return reply;
    const { organizationId, scope } = administrator;
    const input = invitationInput.safeParse(request.body);
    if (!input.success) return reply.code(400).send({ error: 'invalid_request' });
    const { email, name, role } = input.data;

    const outcome = await withScope(db, scope, async (tx) => {
        const found = await findOrInvitePerson(tx, organizationId, email, name);
        if (found === 'email_taken') return 'email_taken' as const;
        const { person: invited, created } = found;

        if (role !== undefined) {
          await tx
            .insert(organizationMemberships)
            .values({ organizationId, personId: invited.id, role })
            .onConflictDoNothing();
        }
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

    // The answer says only that the invitation cannot be made, never where the email belongs.
    if (outcome === 'email_taken') return reply.code(409).send({ error: 'invitation_not_possible' });
    return reply.code(outcome.created ? 201 : 200).send(outcome.member);
  });
}
