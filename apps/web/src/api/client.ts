import type { MembershipRole } from '@potencializador/domain';

export type ProviderId = 'google' | 'microsoft';

export type CurrentPerson = {
  person: { id: string; name: string; email: string };
  isSuperAdmin: boolean;
  memberships: { organizationId: string; organizationName: string; role: MembershipRole }[];
};

export type Organization = { id: string; name: string };
export type Member = { personId: string; name: string; email: string; roles: MembershipRole[] };
export type Invitation = { email: string; name: string; role: MembershipRole };

/** A refusal from the API: HTTP status plus the `error` code of the body. */
export class ApiError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, code: string) {
    super(`${status} ${code}`);
    this.status = status;
    this.code = code;
  }
}

async function request<T>(path: string, method: 'GET' | 'POST' = 'GET', body?: unknown): Promise<T> {
  const response = await fetch(`/api${path}`, {
    method,
    ...(body === undefined
      ? {}
      : { headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }),
  });
  if (response.status === 204) return undefined as T;
  const payload: unknown = await response.json().catch(() => ({}));
  if (!response.ok) {
    const code = (payload as { error?: unknown }).error;
    throw new ApiError(response.status, typeof code === 'string' ? code : 'unknown');
  }
  return payload as T;
}

export const api = {
  /** `null` when nobody is signed in. */
  async currentPerson(): Promise<CurrentPerson | null> {
    try {
      return await request<CurrentPerson>('/me');
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) return null;
      throw error;
    }
  },
  providers: async () => (await request<{ providers: ProviderId[] }>('/auth/providers')).providers,
  signOut: () => request<void>('/auth/logout', 'POST'),
  organizations: async () => (await request<{ organizations: Organization[] }>('/organizations')).organizations,
  createOrganization: (name: string) => request<Organization>('/organizations', 'POST', { name }),
  members: async (organizationId: string) =>
    (await request<{ members: Member[] }>(`/organizations/${organizationId}/members`)).members,
  invite: (organizationId: string, invitation: Invitation) =>
    request<Member>(`/organizations/${organizationId}/members`, 'POST', invitation),
};
