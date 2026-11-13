// @vitest-environment jsdom
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { App } from './App.tsx';

type Reply = { status: number; body?: unknown };
type Routes = Record<string, (body: unknown) => Reply>;

/** Replaces `fetch` with a table of routes ("METHOD /path") and records the calls. */
function fakeBackend(routes: Routes) {
  const calls: { route: string; body: unknown }[] = [];
  vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
    const route = `${init?.method ?? 'GET'} ${String(input)}`;
    const handler = routes[route];
    if (handler === undefined) throw new Error(`unexpected request: ${route}`);
    const body = typeof init?.body === 'string' ? JSON.parse(init.body) : undefined;
    calls.push({ route, body });
    const reply = handler(body);
    return new Response(reply.body === undefined ? null : JSON.stringify(reply.body), {
      status: reply.status,
      headers: { 'content-type': 'application/json' },
    });
  });
  return calls;
}

const notSignedIn: Routes = {
  'GET /api/me': () => ({ status: 401, body: { error: 'not_signed_in' } }),
  'GET /api/auth/providers': () => ({ status: 200, body: { providers: ['google', 'microsoft'] } }),
};

const organizationA = { id: 'org-a', name: 'Universidad A' };
const organizationB = { id: 'org-b', name: 'Empresa B' };

const signedInAs = (me: {
  isSuperAdmin: boolean;
  memberships: { organizationId: string; organizationName: string; role: string }[];
}): Routes => ({
  'GET /api/me': () => ({
    status: 200,
    body: { person: { id: 'person-1', name: 'Ana Gómez', email: 'ana@example.test' }, ...me },
  }),
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  window.history.replaceState({}, '', '/');
});

describe('sin sesión', () => {
  it('ofrece continuar con cada proveedor configurado', async () => {
    fakeBackend(notSignedIn);

    render(<App />);

    const google = await screen.findByRole('link', { name: 'Continuar con Google' });
    const microsoft = screen.getByRole('link', { name: 'Continuar con Microsoft' });
    expect(google.getAttribute('href')).toBe('/api/auth/google/login');
    expect(microsoft.getAttribute('href')).toBe('/api/auth/microsoft/login');
  });

  it('avisa cuando no hay proveedores configurados', async () => {
    fakeBackend({
      ...notSignedIn,
      'GET /api/auth/providers': () => ({ status: 200, body: { providers: [] } }),
    });

    render(<App />);

    expect(await screen.findByText('El inicio de sesión no está configurado todavía.')).toBeTruthy();
    expect(screen.queryByRole('link')).toBeNull();
  });

  it('explica el rechazo a quien no fue invitado', async () => {
    window.history.replaceState({}, '', '/?error=not_invited');
    fakeBackend(notSignedIn);

    render(<App />);

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toBe(
      'Tu cuenta no tiene acceso. Pide una invitación a quien administra tu organización.',
    );
  });

  it('explica una falla del inicio de sesión', async () => {
    window.history.replaceState({}, '', '/?error=sign_in_failed');
    fakeBackend(notSignedIn);

    render(<App />);

    expect((await screen.findByRole('alert')).textContent).toBe(
      'No se pudo iniciar sesión. Inténtalo de nuevo.',
    );
  });

  it('avisa cuando el servicio no responde', async () => {
    fakeBackend({ 'GET /api/me': () => ({ status: 503, body: { error: 'unavailable' } }) });

    render(<App />);

    expect((await screen.findByRole('alert')).textContent).toBe(
      'El servicio no está disponible. Inténtalo más tarde.',
    );
  });
});

describe('superadministrador', () => {
  it('ve todas las organizaciones y crea una nueva', async () => {
    const organizations = [organizationB, organizationA];
    const calls = fakeBackend({
      ...signedInAs({ isSuperAdmin: true, memberships: [] }),
      'GET /api/organizations': () => ({ status: 200, body: { organizations } }),
      'POST /api/organizations': (body) => {
        const created = { id: 'org-c', name: (body as { name: string }).name };
        organizations.push(created);
        return { status: 201, body: created };
      },
    });
    const user = userEvent.setup();

    render(<App />);
    expect(await screen.findByText('Ana Gómez')).toBeTruthy();
    expect(await screen.findByRole('button', { name: 'Universidad A' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Empresa B' })).toBeTruthy();

    await user.type(screen.getByLabelText('Nombre de la organización'), 'Clínica C');
    await user.click(screen.getByRole('button', { name: 'Crear organización' }));

    expect(await screen.findByRole('button', { name: 'Clínica C' })).toBeTruthy();
    expect(calls.find((call) => call.route === 'POST /api/organizations')?.body).toEqual({
      name: 'Clínica C',
    });
    expect((screen.getByLabelText('Nombre de la organización') as HTMLInputElement).value).toBe('');
  });
});

describe('administrador de una organización', () => {
  const administrator = signedInAs({
    isSuperAdmin: false,
    memberships: [{ organizationId: 'org-a', organizationName: 'Universidad A', role: 'administrator' }],
  });
  const members = [
    { personId: 'person-1', name: 'Ana Gómez', email: 'ana@example.test', roles: ['administrator'] },
    { personId: 'person-2', name: 'Luis Mora', email: 'luis@example.test', roles: [] },
  ];

  it('no puede crear organizaciones', async () => {
    fakeBackend({
      ...administrator,
      'GET /api/organizations': () => ({ status: 200, body: { organizations: [organizationA] } }),
    });

    render(<App />);

    expect(await screen.findByRole('button', { name: 'Universidad A' })).toBeTruthy();
    expect(screen.queryByLabelText('Nombre de la organización')).toBeNull();
  });

  it('ve las personas de su organización e invita a otra', async () => {
    const stored = [...members];
    const calls = fakeBackend({
      ...administrator,
      'GET /api/organizations': () => ({ status: 200, body: { organizations: [organizationA] } }),
      'GET /api/organizations/org-a/members': () => ({ status: 200, body: { members: stored } }),
      'POST /api/organizations/org-a/members': (body) => {
        const input = body as { email: string; name: string; role: string };
        const member = { personId: 'person-3', name: input.name, email: input.email, roles: [input.role] };
        stored.push(member);
        return { status: 201, body: member };
      },
    });
    const user = userEvent.setup();

    render(<App />);
    await user.click(await screen.findByRole('button', { name: 'Universidad A' }));

    const table = await screen.findByRole('table', { name: 'Personas de Universidad A' });
    expect(within(table).getByText('Ana Gómez')).toBeTruthy();
    expect(within(table).getByText('Administrador')).toBeTruthy();
    expect(within(table).getByText('Sin roles')).toBeTruthy();

    await user.type(screen.getByLabelText('Correo'), 'laura@example.test');
    await user.type(screen.getByLabelText('Nombre'), 'Laura Díaz');
    await user.selectOptions(screen.getByLabelText('Rol'), 'Diseñador del mapa');
    await user.click(screen.getByRole('button', { name: 'Invitar' }));

    expect(await within(table).findByText('Laura Díaz')).toBeTruthy();
    expect(within(table).getByText('Diseñador del mapa')).toBeTruthy();
    expect(calls.find((call) => call.route === 'POST /api/organizations/org-a/members')?.body).toEqual({
      email: 'laura@example.test',
      name: 'Laura Díaz',
      role: 'map_designer',
    });
  });

  it('explica cuando un correo no se puede invitar, sin decir a quién pertenece', async () => {
    fakeBackend({
      ...administrator,
      'GET /api/organizations': () => ({ status: 200, body: { organizations: [organizationA] } }),
      'GET /api/organizations/org-a/members': () => ({ status: 200, body: { members } }),
      'POST /api/organizations/org-a/members': () => ({
        status: 409,
        body: { error: 'invitation_not_possible' },
      }),
    });
    const user = userEvent.setup();

    render(<App />);
    await user.click(await screen.findByRole('button', { name: 'Universidad A' }));
    await user.type(await screen.findByLabelText('Correo'), 'otro@example.test');
    await user.type(screen.getByLabelText('Nombre'), 'Otra Persona');
    await user.click(screen.getByRole('button', { name: 'Invitar' }));

    expect((await screen.findByRole('alert')).textContent).toBe(
      'No se pudo invitar ese correo. Si crees que es un error, contacta a soporte.',
    );
    expect((screen.getByLabelText('Correo') as HTMLInputElement).value).toBe('otro@example.test');
  });
});

describe('diseñador del mapa', () => {
  it('ve los roles de su organización pero no administra a sus personas', async () => {
    const calls = fakeBackend({
      ...signedInAs({
        isSuperAdmin: false,
        memberships: [{ organizationId: 'org-a', organizationName: 'Universidad A', role: 'map_designer' }],
      }),
      'GET /api/organizations': () => ({ status: 200, body: { organizations: [organizationA] } }),
      'GET /api/organizations/org-a/roles': () => ({ status: 200, body: { roles: [] } }),
    });
    const user = userEvent.setup();

    render(<App />);
    await user.click(await screen.findByRole('button', { name: 'Universidad A' }));

    expect(await screen.findByRole('tab', { name: 'Roles y mapas' })).toBeTruthy();
    expect(screen.queryByRole('tab', { name: 'Personas' })).toBeNull();
    expect(calls.some((call) => call.route.includes('/members'))).toBe(false);
  });
});

describe('cerrar sesión', () => {
  it('termina la sesión y vuelve al inicio de sesión', async () => {
    let signedIn = true;
    const calls = fakeBackend({
      'GET /api/me': () =>
        signedIn
          ? {
              status: 200,
              body: {
                person: { id: 'person-1', name: 'Ana Gómez', email: 'ana@example.test' },
                isSuperAdmin: false,
                memberships: [],
              },
            }
          : { status: 401, body: { error: 'not_signed_in' } },
      'GET /api/auth/providers': () => ({ status: 200, body: { providers: ['google'] } }),
      'GET /api/organizations': () => ({ status: 200, body: { organizations: [] } }),
      'POST /api/auth/logout': () => {
        signedIn = false;
        return { status: 204 };
      },
    });
    const user = userEvent.setup();

    render(<App />);
    await user.click(await screen.findByRole('button', { name: 'Cerrar sesión' }));

    expect(await screen.findByRole('link', { name: 'Continuar con Google' })).toBeTruthy();
    await waitFor(() => expect(screen.queryByText('Ana Gómez')).toBeNull());
    expect(calls.some((call) => call.route === 'POST /api/auth/logout')).toBe(true);
  });
});
