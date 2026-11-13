import type {
  Difficulty,
  DimensionKind,
  EnrollmentRole,
  MapStatus,
  MembershipRole,
  PanelRole,
  PublishObstacle,
} from '@potencializador/domain';

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

export type Program = {
  id: string;
  mapId: string;
  roleId: string;
  name: string;
  startsOn: string;
  endsOn: string;
  maxFocuses: number;
  mandatoryPanelRoles: PanelRole[];
};
export type ProgramSettings = {
  name: string;
  startsOn: string;
  endsOn: string;
  maxFocuses: number;
  mandatoryPanelRoles: PanelRole[];
};
export type ProgramInput = ProgramSettings & { mapId: string };
export type Enrollment = {
  id: string;
  personId: string;
  name: string;
  email: string;
  role: EnrollmentRole;
  isFirmPerson: boolean;
};
export type PanelAssignment = { participantEnrollmentId: string; memberEnrollmentId: string; role: PanelRole };
export type BoardStatus = 'not_started' | 'self_assessed' | 'calibrated' | 'in_cycle' | 'between_cycles' | 'closed';
export type ProgramDetail = {
  program: Program;
  selection: string[];
  enrollments: Enrollment[];
  panels: PanelAssignment[];
  boards: { id: string; enrollmentId: string; status: BoardStatus }[];
  missingPanelRoles: Record<string, PanelRole[]>;
};

export function programApi(organizationId: string) {
  const at = (path: string) => `/organizations/${organizationId}/programs${path}`;
  return {
    list: async () => (await request<{ programs: Program[] }>(at(''))).programs,
    create: (input: ProgramInput) => request<Program>(at(''), 'POST', input),
    detail: (programId: string) => request<ProgramDetail>(at(`/${programId}`)),
    update: (programId: string, settings: ProgramSettings) => request<Program>(at(`/${programId}`), 'PATCH', settings),
    setSelection: (programId: string, capabilityIds: string[]) =>
      request<unknown>(at(`/${programId}/selection`), 'PUT', { capabilityIds }),
    enroll: (programId: string, email: string, roles: EnrollmentRole[]) =>
      request<{ enrollments: { id: string; role: EnrollmentRole }[]; boardId: string | null }>(
        at(`/${programId}/enrollments`),
        'POST',
        { email, roles },
      ),
    unenroll: (programId: string, enrollmentId: string) =>
      request<void>(at(`/${programId}/enrollments/${enrollmentId}`), 'DELETE'),
    assign: (programId: string, assignment: PanelAssignment) =>
      request<unknown>(at(`/${programId}/panel`), 'POST', assignment),
    unassign: (programId: string, assignment: PanelAssignment) =>
      request<void>(
        at(`/${programId}/panel/${assignment.participantEnrollmentId}/${assignment.memberEnrollmentId}/${assignment.role}`),
        'DELETE',
      ),
  };
}

export type ProgramApi = ReturnType<typeof programApi>;

export type BoardSummary = {
  id: string;
  organizationId: string;
  organizationName: string;
  programId: string;
  programName: string;
  ownerName: string;
  status: BoardStatus;
  panelRoles: PanelRole[];
};
export type Board = {
  id: string;
  organizationId: string;
  program: { id: string; name: string };
  ownerName: string;
  status: BoardStatus;
  hasBaseline: boolean;
  viewer: { isOwner: boolean; panelRoles: PanelRole[]; canAdd: boolean; canRemove: boolean };
  levels: { id: string; position: number; name: string; multiplier: number; requiresTransfer: boolean }[];
  dimensions: { id: string; name: string; kind: DimensionKind; position: number }[];
  capabilities: { id: string; dimensionId: string; statement: string; difficulty: Difficulty | null; position: number }[];
  placements: { capabilityId: string; levelId: string | null; addedAt: string }[];
};

export const boardApi = {
  list: () => request<{ mine: BoardSummary[]; accompanied: BoardSummary[] }>('/boards'),
  board: (boardId: string) => request<Board>(`/boards/${boardId}`),
  add: (boardId: string, capabilityId: string) =>
    request<unknown>(`/boards/${boardId}/capabilities`, 'POST', { capabilityId }),
  remove: (boardId: string, capabilityId: string) =>
    request<void>(`/boards/${boardId}/capabilities/${capabilityId}`, 'DELETE'),
};
