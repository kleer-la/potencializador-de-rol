// @vitest-environment jsdom
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { CurrentPerson } from '../api/client.ts';
import { fakeBackend, json, type Routes } from '../test-support/fake-backend.ts';
import { OrganizationWorkspace } from './OrganizationWorkspace.tsx';

const ORG = 'org-a';
const base = `/api/organizations/${ORG}`;
const organization = { id: ORG, name: 'Universidad A' };

const person = (roles: ('administrator' | 'map_designer')[]): CurrentPerson => ({
  person: { id: 'person-1', name: 'Ana', email: 'ana@example.test' },
  isSuperAdmin: false,
  memberships: roles.map((role) => ({ organizationId: ORG, organizationName: 'Universidad A', role })),
});
const designer = person(['map_designer']);

const tools = [
  { id: 'tool-1', name: 'Jobs To Be Done', description: '', link: null },
  { id: 'tool-2', name: 'OKR', description: '', link: null },
];
const objectives = [{ id: 'objective-1', name: 'PDI', description: '' }];
const role = { id: 'role-1', name: 'Product Owner', description: '' };

const header = (status: 'draft' | 'published' | 'archived', version = 1) => ({
  id: `map-${version}`,
  roleId: role.id,
  version,
  status,
  createdAt: '2026-11-13T10:00:00Z',
  publishedAt: status === 'draft' ? null : '2026-11-13T11:00:00Z',
  archivedAt: status === 'archived' ? '2026-11-13T12:00:00Z' : null,
});
const fullMap = (status: 'draft' | 'published' | 'archived') => ({
  ...header(status),
  levels: [
    { id: 'level-0', position: 0, name: 'No sabe', description: '', multiplier: 0, requiresTransfer: false },
    { id: 'level-1', position: 1, name: 'Transferencia', description: '', multiplier: 4, requiresTransfer: true },
  ],
  bonusRules: [{ id: 'bonus-1', name: 'Plus por IA', extraPoints: 1, condition: 'Usó IA y transfirió' }],
  dimensions: [
    {
      id: 'dimension-1',
      position: 0,
      name: 'Entender',
      description: '',
      kind: 'work_cycle',
      capabilities: [
        {
          id: 'capability-1',
          position: 0,
          statement: 'Identifica a quién sirve el producto',
          difficulty: 'medium',
          toolIds: ['tool-1'],
          objectiveIds: [],
        },
      ],
    },
  ],
});

const catalogs: Routes = {
  [`GET ${base}/tools`]: () => json({ items: tools }),
  [`GET ${base}/strategic-objectives`]: () => json({ items: objectives }),
};

/** Opens "Roles y mapas", the role, and version 1. */
async function openMap(user: ReturnType<typeof userEvent.setup>) {
  await user.click(await screen.findByRole('tab', { name: 'Roles y mapas' }));
  await user.click(await screen.findByRole('button', { name: 'Product Owner' }));
  await user.click(await screen.findByRole('button', { name: 'Abrir versión 1' }));
  return screen.findByRole('heading', { name: /Versión 1/ });
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('roles', () => {
  it('lets an administrator create a role', async () => {
    const roles = [role];
    const calls = fakeBackend({
      [`GET ${base}/roles`]: () => json({ roles }),
      [`GET ${base}/members`]: () => json({ members: [] }),
      [`POST ${base}/roles`]: (body) => {
        const created = { id: 'role-2', description: '', ...(body as { name: string }) };
        roles.push(created);
        return json(created, 201);
      },
    });
    const user = userEvent.setup();

    render(<OrganizationWorkspace me={person(['administrator'])} organization={organization} />);
    await user.click(await screen.findByRole('tab', { name: 'Roles y mapas' }));
    await user.type(await screen.findByLabelText('Nombre del rol'), 'Scrum Master');
    await user.click(screen.getByRole('button', { name: 'Crear rol' }));

    expect(await screen.findByRole('button', { name: 'Scrum Master' })).toBeTruthy();
    expect(screen.getByRole('tab', { name: 'Programas' })).toBeTruthy();
    expect(calls.find((call) => call.route === `POST ${base}/roles`)?.body).toEqual({ name: 'Scrum Master' });
  });

  it('does not offer role creation or member administration to a map designer', async () => {
    fakeBackend({ [`GET ${base}/roles`]: () => json({ roles: [role] }) });
    const user = userEvent.setup();

    render(<OrganizationWorkspace me={designer} organization={organization} />);
    await user.click(await screen.findByRole('tab', { name: 'Roles y mapas' }));

    expect(await screen.findByRole('button', { name: 'Product Owner' })).toBeTruthy();
    expect(screen.queryByLabelText('Nombre del rol')).toBeNull();
    expect(screen.queryByRole('tab', { name: 'Personas' })).toBeNull();
  });
});

describe('versions of a map', () => {
  it('imports a map file into a new draft and opens it', async () => {
    const file = { format: 'potencializador.capability-map/v1', scale: [], dimensions: [] };
    const calls = fakeBackend({
      ...catalogs,
      [`GET ${base}/roles`]: () => json({ roles: [role] }),
      [`GET ${base}/roles/role-1/maps`]: () => json({ maps: [] }),
      [`POST ${base}/roles/role-1/maps/import`]: () => json(header('draft'), 201),
      [`GET ${base}/maps/map-1`]: () => json(fullMap('draft')),
    });
    const user = userEvent.setup();

    render(<OrganizationWorkspace me={designer} organization={organization} />);
    await user.click(await screen.findByRole('tab', { name: 'Roles y mapas' }));
    await user.click(await screen.findByRole('button', { name: 'Product Owner' }));
    expect(await screen.findByText('Este rol todavía no tiene mapa.')).toBeTruthy();
    await user.upload(
      screen.getByLabelText('Importar mapa (archivo JSON)'),
      new File([JSON.stringify(file)], 'mapa.json', { type: 'application/json' }),
    );

    expect(await screen.findByRole('heading', { name: 'Versión 1 · Borrador' })).toBeTruthy();
    expect(calls.find((call) => call.route.endsWith('/maps/import'))?.body).toEqual(file);
  });

  it('offers a new version, as a copy, when no draft exists', async () => {
    const calls = fakeBackend({
      ...catalogs,
      [`GET ${base}/roles`]: () => json({ roles: [role] }),
      [`GET ${base}/roles/role-1/maps`]: () => json({ maps: [header('published')] }),
      [`POST ${base}/roles/role-1/maps`]: () => json(header('draft', 2), 201),
      [`GET ${base}/maps/map-2`]: () => json({ ...fullMap('draft'), ...header('draft', 2) }),
    });
    const user = userEvent.setup();

    render(<OrganizationWorkspace me={designer} organization={organization} />);
    await user.click(await screen.findByRole('tab', { name: 'Roles y mapas' }));
    await user.click(await screen.findByRole('button', { name: 'Product Owner' }));
    expect(await screen.findByText('Publicado')).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Nueva versión' }));

    expect(await screen.findByRole('heading', { name: 'Versión 2 · Borrador' })).toBeTruthy();
    expect(calls.find((call) => call.route === `POST ${base}/roles/role-1/maps`)?.body).toEqual({ copyFrom: 'map-1' });
  });
});

describe('map editor', () => {
  const withMap = (status: 'draft' | 'published' | 'archived', extra: Routes = {}): Routes => ({
    ...catalogs,
    [`GET ${base}/roles`]: () => json({ roles: [role] }),
    [`GET ${base}/roles/role-1/maps`]: () => json({ maps: [header(status)] }),
    [`GET ${base}/maps/map-1`]: () => json(fullMap(status)),
    ...extra,
  });

  it('shows the scale, the bonus rules and each dimension with its capabilities', async () => {
    fakeBackend(withMap('published'));
    const user = userEvent.setup();

    render(<OrganizationWorkspace me={designer} organization={organization} />);
    await openMap(user);

    const dimension = screen.getByRole('region', { name: 'Entender' });
    expect(within(dimension).getByText('Ciclo de trabajo')).toBeTruthy();
    expect(within(dimension).getByText('Identifica a quién sirve el producto')).toBeTruthy();
    expect(within(dimension).getByText('Dificultad media')).toBeTruthy();
    expect(within(dimension).getByText('Jobs To Be Done', { selector: 'li' })).toBeTruthy();
    const scale = screen.getByRole('table', { name: 'Escala de madurez' });
    expect(within(scale).getAllByRole('row')).toHaveLength(3);
    expect(within(scale).getByText('Exige transferencia')).toBeTruthy();
    expect(screen.getByText('Plus por IA')).toBeTruthy();
  });

  it('in a draft, adds a capability with its tools and changes the scale', async () => {
    const calls = fakeBackend(
      withMap('draft', {
        [`POST ${base}/maps/map-1/dimensions/dimension-1/capabilities`]: () => json({ id: 'capability-2' }, 201),
        [`PUT ${base}/maps/map-1/scale`]: (body) => json((body as { levels: unknown[] }).levels),
      }),
    );
    const user = userEvent.setup();

    render(<OrganizationWorkspace me={designer} organization={organization} />);
    await openMap(user);
    const dimension = screen.getByRole('region', { name: 'Entender' });
    await user.type(within(dimension).getByLabelText('Enunciado observable'), 'Lee el estado actual del producto');
    await user.selectOptions(within(dimension).getByLabelText('Dificultad'), 'Alta');
    await user.selectOptions(within(dimension).getByLabelText('Herramientas'), ['OKR']);
    await user.click(within(dimension).getByRole('button', { name: 'Agregar capacidad' }));
    await user.click(screen.getByRole('button', { name: 'Agregar nivel' }));
    await user.type(screen.getByLabelText('Nombre del nivel 3'), 'Experiencia');
    await user.click(screen.getByRole('button', { name: 'Guardar escala' }));

    const added = calls.find((call) => call.route.endsWith('/capabilities'));
    expect(added?.body).toEqual({
      statement: 'Lee el estado actual del producto',
      difficulty: 'high',
      toolIds: ['tool-2'],
      objectiveIds: [],
    });
    const scale = calls.find((call) => call.route.endsWith('/scale'))?.body as { levels: { name: string }[] };
    expect(scale.levels.map((level) => level.name)).toEqual(['No sabe', 'Transferencia', 'Experiencia']);
  });

  it('names what stops publishing, and publishes after confirmation', async () => {
    let refuse = true;
    const calls = fakeBackend(
      withMap('draft', {
        [`POST ${base}/maps/map-1/publish`]: () =>
          refuse
            ? json(
                {
                  error: 'cannot_publish',
                  obstacles: [{ kind: 'no_levels' }, { kind: 'dimension_without_capabilities', dimension: 'Crear' }],
                },
                422,
              )
            : json(fullMap('published')),
      }),
    );
    const user = userEvent.setup();

    render(<OrganizationWorkspace me={designer} organization={organization} />);
    await openMap(user);
    await user.click(screen.getByRole('button', { name: 'Publicar' }));
    expect(screen.getByText(/Después solo se podrán agregar dimensiones y capacidades/)).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Confirmar publicación' }));

    const alert = await screen.findByRole('alert');
    expect(within(alert).getByText('Falta la escala de madurez.')).toBeTruthy();
    expect(within(alert).getByText('La dimensión «Crear» no tiene capacidades.')).toBeTruthy();

    refuse = false;
    await user.click(screen.getByRole('button', { name: 'Publicar' }));
    await user.click(screen.getByRole('button', { name: 'Confirmar publicación' }));

    expect(await screen.findByRole('heading', { name: 'Versión 1 · Publicado' })).toBeTruthy();
    expect(calls.filter((call) => call.route.endsWith('/publish'))).toHaveLength(2);
  });

  it('INV-10 in a published map offers only to add dimensions and capabilities, and to archive', async () => {
    const calls = fakeBackend(
      withMap('published', {
        [`POST ${base}/maps/map-1/dimensions`]: () => json({ id: 'dimension-2' }, 201),
        [`POST ${base}/maps/map-1/archive`]: () => json(fullMap('archived')),
      }),
    );
    const user = userEvent.setup();

    render(<OrganizationWorkspace me={designer} organization={organization} />);
    await openMap(user);

    for (const name of ['Editar', 'Quitar', 'Guardar escala', 'Guardar bonificaciones', 'Publicar', 'Descartar borrador']) {
      expect(screen.queryByRole('button', { name }), name).toBeNull();
    }
    expect(screen.queryByRole('button', { name: /^Editar|^Quitar|^Subir|^Bajar/ })).toBeNull();
    expect(screen.getByText(/Versión publicada: solo admite agregar dimensiones y capacidades/)).toBeTruthy();
    const dimension = screen.getByRole('region', { name: 'Entender' });
    expect(within(dimension).getByRole('button', { name: 'Agregar capacidad' })).toBeTruthy();

    await user.type(screen.getByLabelText('Nombre de la dimensión'), 'Comunicación');
    await user.selectOptions(screen.getByLabelText('Tipo'), 'Transversal');
    await user.click(screen.getByRole('button', { name: 'Agregar dimensión' }));
    await user.click(screen.getByRole('button', { name: 'Archivar' }));
    await user.click(screen.getByRole('button', { name: 'Confirmar archivo' }));

    expect(calls.find((call) => call.route === `POST ${base}/maps/map-1/dimensions`)?.body).toEqual({
      name: 'Comunicación',
      description: '',
      kind: 'transversal',
    });
    expect(await screen.findByRole('heading', { name: 'Versión 1 · Archivado' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Agregar dimensión' })).toBeNull();
  });

  it('shows the map without any change action to a member who is not map designer', async () => {
    fakeBackend(withMap('draft'));
    const user = userEvent.setup();

    render(<OrganizationWorkspace me={person(['administrator'])} organization={organization} />);
    await openMap(user);

    expect(screen.getByText('Identifica a quién sirve el producto')).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Agregar|Editar|Quitar|Publicar|Guardar/ })).toBeNull();
  });
});

describe('catalogs', () => {
  it('lets a map designer delete an unused tool, and explains why a tool in use stays', async () => {
    const toolItems = [...tools];
    const calls = fakeBackend({
      [`GET ${base}/tools`]: () => json({ items: toolItems }),
      [`GET ${base}/strategic-objectives`]: () => json({ items: objectives }),
      [`DELETE ${base}/tools/tool-2`]: () => {
        toolItems.splice(1, 1);
        return { status: 204 };
      },
      [`DELETE ${base}/tools/tool-1`]: () => json({ error: 'in_use' }, 409),
    });
    const user = userEvent.setup();

    render(<OrganizationWorkspace me={designer} organization={organization} />);
    await user.click(await screen.findByRole('tab', { name: 'Catálogos' }));
    const section = await screen.findByRole('region', { name: 'Herramientas' });
    await user.click(await within(section).findByRole('button', { name: 'Eliminar «OKR»' }));
    await user.click(within(section).getByRole('button', { name: 'Confirmar' }));
    await waitFor(() => expect(within(section).queryByText('OKR')).toBeNull());
    await user.click(within(section).getByRole('button', { name: 'Eliminar «Jobs To Be Done»' }));
    await user.click(within(section).getByRole('button', { name: 'Confirmar' }));

    expect((await within(section).findByRole('alert')).textContent).toBe(
      'No se puede eliminar: alguna capacidad de un mapa la usa.',
    );
    expect(within(section).getByText('Jobs To Be Done')).toBeTruthy();
    expect(calls.filter((call) => call.route.startsWith('DELETE'))).toHaveLength(2);
  });

  it('offers no deletion to a member who is not map designer', async () => {
    fakeBackend({
      [`GET ${base}/tools`]: () => json({ items: tools }),
      [`GET ${base}/strategic-objectives`]: () => json({ items: objectives }),
      [`GET ${base}/members`]: () => json({ members: [] }),
    });
    const user = userEvent.setup();

    render(<OrganizationWorkspace me={person(['administrator'])} organization={organization} />);
    await user.click(await screen.findByRole('tab', { name: 'Catálogos' }));
    await screen.findByText('OKR');

    expect(screen.queryByRole('button', { name: /Eliminar/ })).toBeNull();
  });

  it('lets a map designer add a tool and an objective', async () => {
    const toolItems = [...tools];
    const calls = fakeBackend({
      [`GET ${base}/tools`]: () => json({ items: toolItems }),
      [`GET ${base}/strategic-objectives`]: () => json({ items: objectives }),
      [`POST ${base}/tools`]: (body) => {
        const created = { id: 'tool-3', description: '', link: null, ...(body as object) } as (typeof tools)[number];
        toolItems.push(created);
        return json(created, 201);
      },
    });
    const user = userEvent.setup();

    render(<OrganizationWorkspace me={designer} organization={organization} />);
    await user.click(await screen.findByRole('tab', { name: 'Catálogos' }));
    const section = await screen.findByRole('region', { name: 'Herramientas' });
    await user.type(within(section).getByLabelText('Nombre'), 'WSJF');
    await user.type(within(section).getByLabelText('Enlace'), 'https://example.test/wsjf');
    await user.click(within(section).getByRole('button', { name: 'Agregar' }));

    expect(await within(section).findByText('WSJF')).toBeTruthy();
    expect(calls.find((call) => call.route === `POST ${base}/tools`)?.body).toEqual({
      name: 'WSJF',
      description: '',
      link: 'https://example.test/wsjf',
    });
  });
});
