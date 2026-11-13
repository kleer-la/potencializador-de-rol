import type { Actor, MembershipRole } from '@potencializador/domain';
import { eq } from 'drizzle-orm';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { createIdentityStore } from '../identity/identity-store.ts';
import { organizations } from '../infrastructure/schema.ts';
import { withScope, type AccessScope, type Database } from '../infrastructure/scoped-transaction.ts';

// Lower case, as PostgreSQL returns identifiers; memberships are compared as text.
const organizationParams = z.object({ organizationId: z.uuid().toLowerCase() });

export type SignedIn = { personId: string; actor: Actor };
export type OrganizationAccess = SignedIn & { organizationId: string; scope: AccessScope };
export type OrganizationPolicy = (actor: Actor, organizationId: string) => boolean;

/**
 * The one way route handlers decide who is acting and on which organization. Each helper
 * answers the request itself and returns `null` when access is refused.
 */
export function createOrganizationAccess(db: Database) {
  const identityStore = createIdentityStore(db);

  /** The signed-in person as an actor, or `null` after answering 401. */
  const requireActor = async (request: FastifyRequest, reply: FastifyReply): Promise<SignedIn | null> => {
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
   * The person, authorized by `policy` for the organization of the `:organizationId`
   * parameter, with the scope to use for that organization. A member gets the same 403 for
   * an organization that is not theirs and for one that does not exist, so the answer
   * reveals nothing about other organizations. A super administrator gets 404 for one that
   * does not exist.
   */
  const requireOrganization = async (
    request: FastifyRequest,
    reply: FastifyReply,
    policy: OrganizationPolicy,
  ): Promise<OrganizationAccess | null> => {
    const signedIn = await requireActor(request, reply);
    if (signedIn === null) return null;
    const params = organizationParams.safeParse(request.params);
    if (!params.success) {
      await reply.code(400).send({ error: 'invalid_request' });
      return null;
    }
    const { organizationId } = params.data;
    if (!policy(signedIn.actor, organizationId)) {
      await reply.code(403).send({ error: 'forbidden' });
      return null;
    }
    const scope = { personId: signedIn.personId, organizationId };
    const [found] = await withScope(db, scope, (tx) =>
      tx.select({ id: organizations.id }).from(organizations).where(eq(organizations.id, organizationId)),
    );
    if (found === undefined) {
      await reply.code(404).send({ error: 'organization_not_found' });
      return null;
    }
    return { ...signedIn, organizationId, scope };
  };

  return { requireActor, requireOrganization };
}
