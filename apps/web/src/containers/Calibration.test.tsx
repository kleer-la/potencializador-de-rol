// @vitest-environment jsdom
import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Board } from '../api/client.ts';
import { fakeBackend, json, type Routes } from '../test-support/fake-backend.ts';
import { BoardView } from './BoardsPage.tsx';

const viewer = (overrides: Partial<Board['viewer']>): Board['viewer'] => ({
  isOwner: false,
  panelRoles: ['leader'],
  canAdd: true,
  canRemove: true,
  canSelfAssess: false,
  canCalibrate: false,
  canRecordInitialLevel: false,
  ...overrides,
});

const base: Board = {
  id: 'board-1',
  organizationId: 'org-a',
  program: { id: 'program-1', name: 'Product Owners 2027', mandatoryPanelRoles: ['leader', 'mentor'] },
  ownerName: 'Ana Gómez',
  owner: { personId: 'ana', name: 'Ana Gómez' },
  panel: [
    { personId: 'luis', name: 'Luis Mora', role: 'leader' },
    { personId: 'eva', name: 'Eva Ruiz', role: 'mentor' },
  ],
  status: 'self_assessed',
  hasBaseline: false,
  viewer: viewer({ canCalibrate: true }),
  levels: [
    { id: 'level-0', position: 0, name: 'No sabe', multiplier: 0, requiresTransfer: false },
    { id: 'level-1', position: 1, name: 'Principiante', multiplier: 1, requiresTransfer: false },
    { id: 'level-2', position: 2, name: 'Practicante', multiplier: 2, requiresTransfer: false },
  ],
  dimensions: [{ id: 'dimension-1', name: 'Entender', kind: 'work_cycle', position: 0 }],
  capabilities: [
    { id: 'capability-1', dimensionId: 'dimension-1', statement: 'Identifica a quién sirve el producto', difficulty: 'medium', position: 0 },
    { id: 'capability-2', dimensionId: 'dimension-1', statement: 'Lee el estado actual del producto', difficulty: null, position: 1 },
    { id: 'capability-3', dimensionId: 'dimension-1', statement: 'Mantiene un backlog ordenado', difficulty: null, position: 2 },
  ],
  placements: [
    { capabilityId: 'capability-1', levelId: null, addedAt: '2026-11-13T10:00:00Z' },
    { capabilityId: 'capability-2', levelId: null, addedAt: '2026-11-13T10:00:00Z' },
  ],
  selfAssessment: { submittedAt: '2026-11-14T10:00:00Z', levels: [{ capabilityId: 'capability-1', levelId: 'level-2' }] },
  calibration: null,
  baseline: null,
};

const calibrated: Board = {
  ...base,
  status: 'calibrated',
  hasBaseline: true,
  viewer: viewer({ canRemove: false, canRecordInitialLevel: true }),
  placements: [
    { capabilityId: 'capability-1', levelId: 'level-1', addedAt: '2026-11-13T10:00:00Z' },
    { capabilityId: 'capability-2', levelId: 'level-0', addedAt: '2026-11-13T10:00:00Z' },
    { capabilityId: 'capability-3', levelId: null, addedAt: '2026-11-21T10:00:00Z' },
  ],
  calibration: {
    heldOn: '2026-11-20',
    notes: 'Revisamos dos entregas del trimestre.',
    attendees: [
      { personId: 'ana', name: 'Ana Gómez' },
      { personId: 'luis', name: 'Luis Mora' },
    ],
    levels: [
      { capabilityId: 'capability-1', selfAssessedLevelId: 'level-2', agreedLevelId: 'level-1' },
      { capabilityId: 'capability-2', selfAssessedLevelId: null, agreedLevelId: 'level-0' },
    ],
  },
  baseline: {
    setAt: '2026-11-20T15:00:00Z',
    entries: [
      { capabilityId: 'capability-1', levelId: 'level-1', origin: 'calibration', setAt: '2026-11-20T15:00:00Z' },
      { capabilityId: 'capability-2', levelId: 'level-0', origin: 'calibration', setAt: '2026-11-20T15:00:00Z' },
    ],
  },
};

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

async function open(board: Board, routes: Routes = {}) {
  const calls = fakeBackend({ 'GET /api/boards/board-1': () => json(board), ...routes });
  const user = userEvent.setup();
  render(<BoardView boardId="board-1" onBack={() => {}} />);
  await screen.findByRole('heading', { name: 'Tablero de Ana Gómez' });
  return { calls, user };
}

describe('calibration', () => {
  it('lets a panel member record attendance, notes and the agreed levels, and fix the baseline after confirming', async () => {
    const { calls, user } = await open(base, {
      'POST /api/boards/board-1/calibration': () => json({ calibrationId: 'calibration-1' }, 201),
    });

    const form = screen.getByRole('region', { name: 'Calibración' });
    expect(within(form).getByText(/Roles obligatorios: Líder, Mentor/)).toBeTruthy();
    await user.clear(within(form).getByLabelText('Fecha de la sesión'));
    await user.type(within(form).getByLabelText('Fecha de la sesión'), '2026-11-20');
    await user.click(within(form).getByRole('checkbox', { name: 'Ana Gómez (Participante)' }));
    await user.click(within(form).getByRole('checkbox', { name: 'Luis Mora (Líder)' }));
    await user.click(within(form).getByRole('checkbox', { name: 'Eva Ruiz (Mentor)' }));
    await user.type(within(form).getByLabelText('Notas'), 'Casos reales');
    const first = within(form).getByRole('radiogroup', { name: 'Identifica a quién sirve el producto' });
    expect(within(form).getByText('Autoevaluación: 2 · Practicante')).toBeTruthy();
    expect(within(form).getByText('Autoevaluación: sin propuesta')).toBeTruthy();
    await user.click(within(first).getByRole('radio', { name: '1 · Principiante' }));
    const second = within(form).getByRole('radiogroup', { name: 'Lee el estado actual del producto' });
    await user.click(within(second).getByRole('radio', { name: '0 · No sabe' }));
    expect(within(form).getByText('2 de 2 capacidades acordadas')).toBeTruthy();
    await user.click(within(form).getByRole('button', { name: 'Fijar línea base' }));
    expect(within(form).getByText(/no se podrá cambiar/)).toBeTruthy();
    await user.click(within(form).getByRole('button', { name: 'Confirmar' }));

    expect(calls.find((call) => call.route === 'POST /api/boards/board-1/calibration')?.body).toEqual({
      heldOn: '2026-11-20',
      notes: 'Casos reales',
      attendees: ['ana', 'luis', 'eva'],
      levels: [
        { capabilityId: 'capability-1', levelId: 'level-1' },
        { capabilityId: 'capability-2', levelId: 'level-0' },
      ],
    });
    // The board reloads after the baseline is fixed.
    expect(calls.filter((call) => call.route === 'GET /api/boards/board-1')).toHaveLength(2);
  });

  it('says who is missing when the attendance does not allow a baseline', async () => {
    const { user } = await open(base, {
      'POST /api/boards/board-1/calibration': () =>
        json({ error: 'attendance', participantMissing: true, missingRoles: ['mentor'] }, 422),
    });

    const form = screen.getByRole('region', { name: 'Calibración' });
    await user.click(within(form).getByRole('button', { name: 'Fijar línea base' }));
    await user.click(within(form).getByRole('button', { name: 'Confirmar' }));

    const alert = await screen.findByRole('alert');
    expect(within(alert).getByText(/Para fijar la línea base deben asistir/)).toBeTruthy();
    expect(within(alert).getByText('Ana Gómez (Participante)')).toBeTruthy();
    expect(within(alert).getByText('Alguien con el rol Mentor')).toBeTruthy();
  });

  it('names the capabilities without an agreed level', async () => {
    const { user } = await open(base, {
      'POST /api/boards/board-1/calibration': () => json({ error: 'incomplete', missing: ['capability-2'] }, 422),
    });

    const form = screen.getByRole('region', { name: 'Calibración' });
    await user.click(within(form).getByRole('button', { name: 'Fijar línea base' }));
    await user.click(within(form).getByRole('button', { name: 'Confirmar' }));

    const alert = await screen.findByRole('alert');
    expect(within(alert).getByText('Lee el estado actual del producto')).toBeTruthy();
  });

  it('shows the owner neither the calibration form nor the initial leveling', async () => {
    await open({ ...calibrated, viewer: viewer({ isOwner: true, panelRoles: [], canAdd: false, canRemove: false }) });

    expect(screen.queryByRole('region', { name: 'Calibración' })).toBeNull();
    expect(screen.queryByRole('region', { name: 'Capacidades por nivelar' })).toBeNull();
    expect(screen.getByRole('region', { name: 'Línea base' })).toBeTruthy();
  });
});

describe('baseline', () => {
  it('shows the calibration, the agreed level beside the self-assessed one and the difference', async () => {
    await open(calibrated);

    const baseline = screen.getByRole('region', { name: 'Línea base' });
    expect(within(baseline).getByText(/Ana Gómez, Luis Mora/)).toBeTruthy();
    expect(within(baseline).getByText('Revisamos dos entregas del trimestre.')).toBeTruthy();
    const table = within(baseline).getByRole('table', { name: 'Autoevaluación y nivel acordado' });
    const first = within(table).getByRole('row', { name: /Identifica a quién sirve el producto/ });
    expect(within(first).getByText('2 · Practicante')).toBeTruthy();
    expect(within(first).getByText('1 · Principiante')).toBeTruthy();
    expect(within(first).getByText('−1')).toBeTruthy();
    const second = within(table).getByRole('row', { name: /Lee el estado actual del producto/ });
    expect(within(second).getByText('Sin propuesta')).toBeTruthy();
  });

  it('lets a panel member record the initial level of a capability added after the baseline', async () => {
    const { calls, user } = await open(calibrated, {
      'POST /api/boards/board-1/initial-levels': () => json({ levelChangeId: 'change-1' }, 201),
    });

    const pending = screen.getByRole('region', { name: 'Capacidades por nivelar' });
    await user.selectOptions(within(pending).getByLabelText('Nivel inicial de «Mantiene un backlog ordenado»'), 'level-2');
    await user.click(within(pending).getByRole('button', { name: 'Fijar nivel inicial de «Mantiene un backlog ordenado»' }));

    expect(calls.find((call) => call.route === 'POST /api/boards/board-1/initial-levels')?.body).toEqual({
      capabilityId: 'capability-3',
      levelId: 'level-2',
    });
  });
});
