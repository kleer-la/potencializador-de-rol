import type { Difficulty, DimensionKind, MapStatus, MembershipRole, PublishObstacle } from '@potencializador/domain';

export type ProviderId = 'google' | 'microsoft';

export type CurrentPerson = {
  person: { id: string; name: string; email: string };
  isSuperAdmin: boolean;
  memberships: { organizationId: string; organizationName: string; role: MembershipRole }[];
};

export type Organization = { id: string; name: string };
export type Member = { personId: string; name: string; email: string; roles: MembershipRole[] };
export type Invitation = { email: string; name: string; role: MembershipRole };

export type Role = { id: string; name: string; description: string };
export type Tool = { id: string; name: string; description: string; link: string | null };
export type Objective = { id: string; name: string; description: string };
export type CatalogKind = 'tools' | 'strategic-objectives';
export type CatalogEntry = Tool | Objective;

export type MapHeader = {
  id: string;
  roleId: string;
  version: number;
  status: MapStatus;
  createdAt: string;
  publishedAt: string | null;
  archivedAt: string | null;
};
export type LevelInput = { name: string; description: string; multiplier: number; requiresTransfer: boolean };
export type BonusRuleInput = { name: string; extraPoints: number; condition: string };
export type DimensionInput = { name: string; description: string; kind: DimensionKind };
export type CapabilityInput = {
  statement: string;
  difficulty: Difficulty | null;
  toolIds: string[];
  objectiveIds: string[];
};
export type Capability = CapabilityInput & { id: string; position: number };
export type Dimension = DimensionInput & { id: string; position: number; capabilities: Capability[] };
export type CapabilityMap = MapHeader & {
  levels: (LevelInput & { id: string; position: number })[];
  bonusRules: (BonusRuleInput & { id: string })[];
  dimensions: Dimension[];
};

/** A refusal from the API: HTTP status plus the `error` code of the body. */
export class ApiError extends Error {
  readonly status: number;
  readonly code: string;

  /** The rest of the refusal body, such as the obstacles to publishing. */
  readonly details: Record<string, unknown>;

  constructor(status: number, code: string, details: Record<string, unknown> = {}) {
    super(`${status} ${code}`);
    this.status = status;
    this.code = code;
    this.details = details;
  }

  get obstacles(): PublishObstacle[] {
    return Array.isArray(this.details.obstacles) ? (this.details.obstacles as PublishObstacle[]) : [];
  }
}

type Method = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

async function request<T>(path: string, method: Method = 'GET', body?: unknown): Promise<T> {
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
    throw new ApiError(response.status, typeof code === 'string' ? code : 'unknown', payload as Record<string, unknown>);
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

/** Everything a person does inside one organization: roles, catalogs and maps. */
export function organizationApi(organizationId: string) {
  const at = (path: string) => `/organizations/${organizationId}/${path}`;
  return {
    roles: async () => (await request<{ roles: Role[] }>(at('roles'))).roles,
    createRole: (name: string) => request<Role>(at('roles'), 'POST', { name }),

    catalog: async <T extends CatalogEntry>(kind: CatalogKind) =>
      (await request<{ items: T[] }>(at(kind))).items,
    addToCatalog: (kind: CatalogKind, entry: Omit<Tool, 'id'> | Omit<Objective, 'id'>) =>
      request<CatalogEntry>(at(kind), 'POST', entry),
    changeInCatalog: (kind: CatalogKind, id: string, entry: Partial<Omit<Tool, 'id'>>) =>
      request<CatalogEntry>(at(`${kind}/${id}`), 'PATCH', entry),

    versions: async (roleId: string) => (await request<{ maps: MapHeader[] }>(at(`roles/${roleId}/maps`))).maps,
    newDraft: (roleId: string, copyFrom?: string) =>
      request<MapHeader>(at(`roles/${roleId}/maps`), 'POST', copyFrom === undefined ? {} : { copyFrom }),
    importMap: (roleId: string, file: unknown) => request<MapHeader>(at(`roles/${roleId}/maps/import`), 'POST', file),

    map: (mapId: string) => request<CapabilityMap>(at(`maps/${mapId}`)),
    publish: (mapId: string) => request<CapabilityMap>(at(`maps/${mapId}/publish`), 'POST'),
    archive: (mapId: string) => request<CapabilityMap>(at(`maps/${mapId}/archive`), 'POST'),
    discard: (mapId: string) => request<void>(at(`maps/${mapId}`), 'DELETE'),
    replaceScale: (mapId: string, levels: LevelInput[]) => request<unknown>(at(`maps/${mapId}/scale`), 'PUT', { levels }),
    replaceBonusRules: (mapId: string, bonusRules: BonusRuleInput[]) =>
      request<unknown>(at(`maps/${mapId}/bonus-rules`), 'PUT', { bonusRules }),
    addDimension: (mapId: string, dimension: DimensionInput) =>
      request<{ id: string }>(at(`maps/${mapId}/dimensions`), 'POST', dimension),
    changeDimension: (mapId: string, dimensionId: string, change: Partial<DimensionInput> & { position?: number }) =>
      request<{ id: string }>(at(`maps/${mapId}/dimensions/${dimensionId}`), 'PATCH', change),
    removeDimension: (mapId: string, dimensionId: string) =>
      request<void>(at(`maps/${mapId}/dimensions/${dimensionId}`), 'DELETE'),
    addCapability: (mapId: string, dimensionId: string, capability: CapabilityInput) =>
      request<{ id: string }>(at(`maps/${mapId}/dimensions/${dimensionId}/capabilities`), 'POST', capability),
    changeCapability: (mapId: string, capabilityId: string, change: Partial<CapabilityInput> & { position?: number }) =>
      request<{ id: string }>(at(`maps/${mapId}/capabilities/${capabilityId}`), 'PATCH', change),
    removeCapability: (mapId: string, capabilityId: string) =>
      request<void>(at(`maps/${mapId}/capabilities/${capabilityId}`), 'DELETE'),
  };
}

export type OrganizationApi = ReturnType<typeof organizationApi>;
