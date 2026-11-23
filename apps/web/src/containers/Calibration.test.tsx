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
  canPlanCycle: false,
  canStartCycle: false,
  canReviewExperiments: false,
  canRecordEvidence: false,
  canProposeChanges: false,
  canDecideProposals: false,
  canRecordMentoring: false,
  canCloseCycle: false,
  canRecalibrate: false,
  canCloseBoard: false,
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
  cycle: null,
  evidence: [],
  proposals: [],
  bonuses: [],
  bonusRules: [],
  mentoringSessions: [],
  score: null,
  evolution: [],
  recalibrations: [],
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
    missingPanelRoles: [],
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

/** After the baseline, an approved level change moved the first capability one level up. */
const movedOn: Board = {
  ...calibrated,
  viewer: viewer({ canRemove: false }),
  placements: [
    { capabilityId: 'capability-1', levelId: 'level-2', addedAt: '2026-11-13T10:00:00Z' },
    { capabilityId: 'capability-2', levelId: 'level-0', addedAt: '2026-11-13T10:00:00Z' },
  ],
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

  it('offers to fix the baseline without a mandatory role, after confirming, when only panel roles are missing', async () => {
    const { user, calls } = await open(base, {
      'POST /api/boards/board-1/calibration': (body) =>
        (body as { allowMissingRoles?: boolean }).allowMissingRoles === true
          ? json({ calibrationId: 'calibration-1' }, 201)
          : json({ error: 'attendance', participantMissing: false, missingRoles: ['mentor'] }, 422),
    });

    const form = screen.getByRole('region', { name: 'Calibración' });
    await user.click(within(form).getByRole('button', { name: 'Fijar línea base' }));
    await user.click(within(form).getByRole('button', { name: 'Confirmar' }));

    const alert = await screen.findByRole('alert');
    expect(within(alert).getByText(/Faltan roles obligatorios del panel/)).toBeTruthy();
    expect(within(alert).getByText('Alguien con el rol Mentor')).toBeTruthy();
    await user.click(within(alert).getByRole('button', { name: 'Fijar sin el panel completo' }));
    await user.click(within(alert).getByRole('button', { name: 'Confirmar' }));

    await vi.waitFor(() =>
      expect(calls.filter((call) => call.route === 'POST /api/boards/board-1/calibration').map((call) => call.body)).toEqual([
        expect.not.objectContaining({ allowMissingRoles: true }),
        expect.objectContaining({ allowMissingRoles: true }),
      ]),
    );
    await vi.waitFor(() => expect(calls.filter((call) => call.route === 'GET /api/boards/board-1')).toHaveLength(2));
  });

  it('does not offer to fix the baseline without the participant', async () => {
    const { user } = await open(base, {
      'POST /api/boards/board-1/calibration': () =>
        json({ error: 'attendance', participantMissing: true, missingRoles: ['mentor'] }, 422),
    });

    const form = screen.getByRole('region', { name: 'Calibración' });
    await user.click(within(form).getByRole('button', { name: 'Fijar línea base' }));
    await user.click(within(form).getByRole('button', { name: 'Confirmar' }));

    const alert = await screen.findByRole('alert');
    expect(within(alert).queryByRole('button', { name: 'Fijar sin el panel completo' })).toBeNull();
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
    expect(screen.getByText(/Línea base fijada en la calibración del/)).toBeTruthy();
  });
});

describe('baseline', () => {
  it('notes under the legend when the baseline was fixed, who attended, the notes and what joined later', async () => {
    const { user } = await open({
      ...movedOn,
      baseline: {
        ...movedOn.baseline!,
        entries: [
          ...movedOn.baseline!.entries,
          { capabilityId: 'capability-3', levelId: 'level-2', origin: 'initial_leveling', setAt: '2026-11-21T10:00:00Z' },
        ],
      },
    });

    const note = screen.getByRole('group', { name: 'Contexto de la línea base' });
    expect(within(note).getByText(/Línea base fijada en la calibración del 20 de noviembre de 2026/)).toBeTruthy();
    expect(within(note).getByText(/Asistieron: Ana Gómez, Luis Mora/)).toBeTruthy();
    await user.click(within(note).getByText('Notas de la calibración'));
    expect(within(note).getByText('Revisamos dos entregas del trimestre.')).toBeTruthy();
    await user.click(within(note).getByText('Agregadas después: 1'));
    expect(within(note).getByText(/Mantiene un backlog ordenado: 2 · Practicante \(nivelación inicial del 21 de noviembre de 2026\)/)).toBeTruthy();
    expect(screen.queryByRole('table', { name: 'Línea base y estado actual' })).toBeNull();
    expect(screen.queryByRole('heading', { name: 'Línea base vs estado actual' })).toBeNull();
  });

  it('notes the mandatory roles that did not attend the calibration', async () => {
    await open({ ...movedOn, calibration: { ...movedOn.calibration!, missingPanelRoles: ['mentor', 'specialist'] } });

    const note = screen.getByRole('group', { name: 'Contexto de la línea base' });
    expect(within(note).getByText(/Roles obligatorios ausentes: Mentor, Especialista/)).toBeTruthy();
  });

  it('leaves out the notes and the later additions when there are none', async () => {
    await open({ ...movedOn, calibration: { ...movedOn.calibration!, notes: '' } });

    const note = screen.getByRole('group', { name: 'Contexto de la línea base' });
    expect(within(note).queryByText('Notas de la calibración')).toBeNull();
    expect(within(note).queryByText(/Agregadas después/)).toBeNull();
  });

  it('marks the current level and the baseline on the board, no longer the self-assessment', async () => {
    await open(movedOn);

    const kanban = screen.getByRole('table', { name: 'Tablero' });
    const first = within(kanban).getByRole('row', { name: /Identifica a quién sirve el producto/ });
    const cells = within(first).getAllByRole('cell');
    // Cells: statement, unplaced, then levels 0, 1 and 2.
    expect(within(cells[3]!).getByLabelText('Línea base')).toBeTruthy();
    expect(within(cells[4]!).getByLabelText('Estado actual')).toBeTruthy();
    expect(within(kanban).queryByLabelText('Autoevaluación')).toBeNull();
    expect(screen.getByText('● estado actual · ○ línea base')).toBeTruthy();
    expect(screen.queryByText(/○ autoevaluación/)).toBeNull();
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
