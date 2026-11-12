/** Roles a person holds in an organization, independent of any program. */
export const MEMBERSHIP_ROLES = ['administrator', 'map_designer'] as const;
export type MembershipRole = (typeof MEMBERSHIP_ROLES)[number];

/** The signed-in person, reduced to what access decisions need. */
export type Actor = {
  /** Person of the mentoring firm. */
  isSuperAdmin: boolean;
  memberships: readonly { organizationId: string; role: MembershipRole }[];
};

/** Only the mentoring firm creates client organizations. */
export function canCreateOrganization(actor: Actor): boolean {
  return actor.isSuperAdmin;
}

/**
 * Administering covers the organization's people and their roles. A super administrator
 * may do it in any organization (support); an administrator only in their own.
 */
export function canAdministerOrganization(actor: Actor, organizationId: string): boolean {
  return (
    actor.isSuperAdmin ||
    actor.memberships.some(
      (membership) => membership.organizationId === organizationId && membership.role === 'administrator',
    )
  );
}
