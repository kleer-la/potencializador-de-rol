// @vitest-environment jsdom
import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ProgramDetail } from '../api/client.ts';
import { fakeBackend, json, type Routes } from '../test-support/fake-backend.ts';
import { ProgramsSection } from './ProgramsSection.tsx';

const base = '/api/organizations/org-a';
const program = {
  id: 'program-1',
  mapId: 'map-1',
  roleId: 'role-1',
  name: 'Product Owners 2027',
  startsOn: '2027-01-15',
  endsOn: '2027-06-30',
  maxFocuses: 3,
  mandatoryPanelRoles: ['leader', 'specialist', 'mentor'] as const,
};
const map = {
  id: 'map-1',
  roleId: 'role-1',
  version: 1,
  status: 'published',
  createdAt: '',
  publishedAt: '',
  archivedAt: null,
  levels: [],
  bonusRules: [],
  dimensions: [
    {
      id: 'dimension-1',
      position: 0,
      name: 'Entender',
      description: '',
      kind: 'work_cycle',
      capabilities: [
        { id: 'capability-1', position: 0, statement: 'Identifica a quién sirve el producto', difficulty: null, toolIds: [], objectiveIds: [] },
        { id: 'capability-2', position: 1, statement: 'Lee el estado actual del producto', difficulty: null, toolIds: [], objectiveIds: [] },
      ],
    },
  ],
};
const detail: ProgramDetail = {
  program: { ...program, mandatoryPanelRoles: [...program.mandatoryPanelRoles] },
  selection: ['capability-1'],
  enrollments: [
    { id: 'e-ana', personId: 'ana', name: 'Ana Gómez', email: 'ana@uni.test', role: 'participant', isFirmPerson: false },
    { id: 'e-luis', personId: 'luis', name: 'Luis Mora', email: 'luis@uni.test', role: 'leader', isFirmPerson: false },
    { id: 'e-kleer', personId: 'kleer', name: 'Marta Kleer', email: 'marta@kleer.test', role: 'mentor', isFirmPerson: true },
  ],
  panels: [{ participantEnrollmentId: 'e-ana', memberEnrollmentId: 'e-luis', role: 'leader' }],
  boards: [{ id: 'board-1', enrollmentId: 'e-ana', status: 'not_started' }],
  missingPanelRoles: { 'e-ana': ['specialist', 'mentor'] },
};
const routes = (extra: Routes = {}): Routes => ({
  [`GET ${base}/programs`]: () => json({ programs: [program] }),
  [`GET ${base}/programs/program-1`]: () => json(detail),
  [`GET ${base}/maps/map-1`]: () => json(map),
  [`GET ${base}/roles`]: () => json({ roles: [{ id: 'role-1', name: 'Product Owner', description: '' }] }),
  [`GET ${base}/roles/role-1/maps`]: () => json({ maps: [{ ...map, id: 'map-1' }] }),
  ...extra,
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

async function openProgram(canAdminister: boolean, canDesign: boolean, extra: Routes = {}) {
  const calls = fakeBackend(routes(extra));
  const user = userEvent.setup();
  render(<ProgramsSection organizationId="org-a" canAdminister={canAdminister} canDesign={canDesign} />);
  await user.click(await screen.findByRole('button', { name: 'Product Owners 2027' }));
  await screen.findByRole('heading', { name: 'Product Owners 2027' });
  return { calls, user };
}

describe('programs', () => {
  it('lets an administrator create a program on a published version of a role', async () => {
    const calls = fakeBackend(routes({ [`POST ${base}/programs`]: () => json({ ...program, id: 'program-2', name: 'Cohorte 2' }, 201) }));
    const user = userEvent.setup();

    render(<ProgramsSection organizationId="org-a" canAdminister canDesign={false} />);
    await user.type(await screen.findByLabelText('Nombre del programa'), 'Cohorte 2');
    await user.selectOptions(await screen.findByLabelText('Mapa'), 'Product Owner · versión 1');
    await user.type(screen.getByLabelText('Inicio'), '2027-01-15');
    await user.type(screen.getByLabelText('Fin'), '2027-06-30');
    await user.click(screen.getByRole('button', { name: 'Crear programa' }));

    expect(calls.find((call) => call.route === `POST ${base}/programs`)?.body).toEqual({
      name: 'Cohorte 2',
      mapId: 'map-1',
      startsOn: '2027-01-15',
      endsOn: '2027-06-30',
    });
  });

  it('shows enrollments, the Kleer mentor and the panel roles still missing', async () => {
    await openProgram(true, false);

    const people = screen.getByRole('table', { name: 'Personas inscritas' });
    expect(within(people).getByText('Marta Kleer')).toBeTruthy();
    expect(within(people).getByText('Kleer')).toBeTruthy();
    const panel = screen.getByRole('region', { name: 'Panel de Ana Gómez' });
    expect(within(panel).getByText('Luis Mora')).toBeTruthy();
    expect(within(panel).getByText('Faltan: Especialista, Mentor')).toBeTruthy();
  });

  it('enrolls a person by email with their roles, and assigns a panel member', async () => {
    const { calls, user } = await openProgram(true, false, {
      [`POST ${base}/programs/program-1/enrollments`]: () => json({ enrollments: [], boardId: null }, 201),
      [`POST ${base}/programs/program-1/panel`]: (body) => json(body, 201),
    });

    await user.type(screen.getByLabelText('Correo de la persona'), 'nuevo@uni.test');
    await user.click(screen.getByRole('checkbox', { name: 'Participante' }));
    await user.click(screen.getByRole('button', { name: 'Inscribir' }));
    const panel = screen.getByRole('region', { name: 'Panel de Ana Gómez' });
    await user.selectOptions(within(panel).getByLabelText('Agregar al panel'), 'Marta Kleer · Mentor');
    await user.click(within(panel).getByRole('button', { name: 'Asignar' }));

    expect(calls.find((call) => call.route.endsWith('/enrollments'))?.body).toEqual({
      email: 'nuevo@uni.test',
      roles: ['participant'],
    });
    expect(calls.find((call) => call.route.endsWith('/panel'))?.body).toEqual({
      participantEnrollmentId: 'e-ana',
      memberEnrollmentId: 'e-kleer',
      role: 'mentor',
    });
  });

  it('lets a map designer change the base selection, and not enroll anyone', async () => {
    const { calls, user } = await openProgram(false, true, {
      [`PUT ${base}/programs/program-1/selection`]: (body) => json(body),
    });

    const selection = screen.getByRole('group', { name: 'Selección base' });
    await user.click(within(selection).getByRole('checkbox', { name: 'Lee el estado actual del producto' }));
    await user.click(screen.getByRole('button', { name: 'Guardar selección' }));

    expect(calls.find((call) => call.route.endsWith('/selection'))?.body).toEqual({
      capabilityIds: ['capability-1', 'capability-2'],
    });
    expect(screen.queryByLabelText('Correo de la persona')).toBeNull();
  });
});
