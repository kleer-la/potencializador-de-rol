// @vitest-environment jsdom
import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Board, Cycle } from '../api/client.ts';
import { fakeBackend, json, type Routes } from '../test-support/fake-backend.ts';
import { BoardView } from './BoardsPage.tsx';

const viewer = (overrides: Partial<Board['viewer']>): Board['viewer'] => ({
  isOwner: false,
  panelRoles: ['leader'],
  canAdd: true,
  canRemove: false,
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

const activeCycle: Cycle = {
  id: 'cycle-1',
  number: 1,
  startsOn: '2026-12-01',
  endsOn: '2027-02-28',
  state: 'active',
  startedAt: '2026-12-01T10:00:00Z',
  maxFocuses: 3,
  focuses: [],
};

const board = (who: Board['viewer'], overrides: Partial<Board> = {}): Board => ({
  id: 'board-1',
  organizationId: 'org-a',
  program: { id: 'program-1', name: 'Product Owners 2027', mandatoryPanelRoles: ['leader'] },
  ownerName: 'Ana Gómez',
  owner: { personId: 'ana', name: 'Ana Gómez' },
  panel: [{ personId: 'luis', name: 'Luis Mora', role: 'leader' }],
  status: 'between_cycles',
  hasBaseline: true,
  viewer: who,
  levels: [
    { id: 'level-0', position: 0, name: 'No sabe', multiplier: 0, requiresTransfer: false },
    { id: 'level-1', position: 1, name: 'Principiante', multiplier: 1, requiresTransfer: false },
  ],
  dimensions: [
    { id: 'dimension-1', name: 'Entender', kind: 'work_cycle', position: 0 },
    { id: 'dimension-2', name: 'Comunicación', kind: 'transversal', position: 1 },
  ],
  capabilities: [
    { id: 'capability-1', dimensionId: 'dimension-1', statement: 'Identifica a quién sirve el producto', difficulty: 'high', position: 0 },
    { id: 'capability-2', dimensionId: 'dimension-2', statement: 'Comunica por escrito', difficulty: 'low', position: 0 },
  ],
  placements: [
    { capabilityId: 'capability-1', levelId: 'level-1', addedAt: '2026-11-13T10:00:00Z' },
    { capabilityId: 'capability-2', levelId: 'level-0', addedAt: '2026-11-13T10:00:00Z' },
  ],
  selfAssessment: null,
  calibration: null,
  baseline: { setAt: '2026-11-20T15:00:00Z', entries: [] },
  cycle: null,
  evidence: [],
  proposals: [],
  bonuses: [],
  bonusRules: [],
  mentoringSessions: [],
  score: {
    total: 2,
    maximum: 2,
    capabilities: 2,
    byDimension: [
      { dimensionId: 'dimension-1', total: 2, maximum: 1, capabilities: 1 },
      { dimensionId: 'dimension-2', total: 0, maximum: 1, capabilities: 1 },
    ],
    byDifficulty: [
      { difficulty: 'low', total: 0, maximum: 1, capabilities: 1 },
      { difficulty: 'high', total: 2, maximum: 1, capabilities: 1 },
    ],
  },
  evolution: [
    { kind: 'baseline', date: '2026-11-20T15:00:00Z', total: 0, maximum: 2, capabilities: 2, change: null },
    { kind: 'cycle_close', date: '2027-02-28T15:00:00Z', total: 2, maximum: 2, capabilities: 2, change: 2 },
    { kind: 'today', date: '2027-03-01T10:00:00Z', total: 2, maximum: 2, capabilities: 2, change: 0 },
  ],
  recalibrations: [],
  ...overrides,
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

async function open(loaded: Board, routes: Routes = {}) {
  const calls = fakeBackend({ 'GET /api/boards/board-1': () => json(loaded), ...routes });
  const user = userEvent.setup();
  render(<BoardView boardId="board-1" onBack={() => {}} />);
  await screen.findByRole('heading', { name: 'Tablero de Ana Gómez' });
  return { calls, user };
}

describe('maturity score', () => {
  it('shows the total with its maximum, its evolution and its breakdowns', async () => {
    await open(board(viewer({})));

    const score = screen.getByRole('region', { name: 'Puntaje de madurez' });
    expect(within(score).getByText('2 de 2', { selector: 'strong' })).toBeTruthy();
    const evolution = within(score).getByRole('table', { name: 'Evolución' });
    const close = within(evolution).getByRole('row', { name: /Cierre de ciclo/ });
    expect(within(close).getByText('+2')).toBeTruthy();
    expect(within(evolution).getByRole('row', { name: /Línea base/ })).toBeTruthy();
    const dimensions = within(score).getByRole('table', { name: 'Por dimensión' });
    expect(within(dimensions).getByRole('row', { name: /Comunicación/ })).toBeTruthy();
    const difficulty = within(score).getByRole('table', { name: 'Por dificultad' });
    expect(within(difficulty).getByRole('row', { name: /Alta/ })).toBeTruthy();
    expect(within(score).getByText(/La dificultad se muestra; no pondera el puntaje/)).toBeTruthy();
  });

  it('shows nothing of a score before the baseline', async () => {
    await open(board(viewer({}), { hasBaseline: false, baseline: null, score: null, evolution: [], status: 'self_assessed' }));
    expect(screen.queryByRole('region', { name: 'Puntaje de madurez' })).toBeNull();
  });
});

describe('closing and recalibration', () => {
  it('lets a panel member close the active cycle after confirming', async () => {
    const { calls, user } = await open(
      board(viewer({ canCloseCycle: true }), { status: 'in_cycle', cycle: activeCycle }),
      { 'POST /api/boards/board-1/cycles/cycle-1/close': () => json({ snapshotId: 'snapshot-1' }) },
    );

    const cycle = screen.getByRole('region', { name: 'Ciclo de mejora' });
    await user.click(within(cycle).getByRole('button', { name: 'Cerrar ciclo' }));
    expect(within(cycle).getByText(/se toma una fotografía del tablero/)).toBeTruthy();
    await user.click(within(cycle).getByRole('button', { name: 'Confirmar cierre' }));

    expect(calls.some((call) => call.route === 'POST /api/boards/board-1/cycles/cycle-1/close')).toBe(true);
  });

  it('lets a panel member recalibrate between cycles, starting from the current levels', async () => {
    const { calls, user } = await open(board(viewer({ canRecalibrate: true })), {
      'POST /api/boards/board-1/recalibration': () => json({ recalibrationId: 'r-1' }, 201),
    });

    const form = screen.getByRole('region', { name: 'Recalibración' });
    await user.clear(within(form).getByLabelText('Fecha de la sesión'));
    await user.type(within(form).getByLabelText('Fecha de la sesión'), '2027-03-05');
    await user.click(within(form).getByRole('checkbox', { name: 'Ana Gómez (Participante)' }));
    await user.click(within(form).getByRole('checkbox', { name: 'Luis Mora (Líder)' }));
    const first = within(form).getByRole('radiogroup', { name: 'Identifica a quién sirve el producto' });
    expect((within(first).getByRole('radio', { name: '1 · Principiante' }) as HTMLInputElement).checked).toBe(true);
    await user.click(within(first).getByRole('radio', { name: '0 · No sabe' }));
    await user.click(within(form).getByRole('button', { name: 'Registrar recalibración' }));
    await user.click(within(form).getByRole('button', { name: 'Confirmar' }));

    expect(calls.find((call) => call.route.endsWith('/recalibration'))?.body).toEqual({
      heldOn: '2027-03-05',
      notes: '',
      attendees: ['ana', 'luis'],
      levels: [
        { capabilityId: 'capability-1', levelId: 'level-0' },
        { capabilityId: 'capability-2', levelId: 'level-0' },
      ],
    });
  });

  it('lets a panel member close the board after confirming', async () => {
    const { calls, user } = await open(board(viewer({ canCloseBoard: true })), {
      'POST /api/boards/board-1/close': () => json({ status: 'closed' }),
    });

    await user.click(screen.getByRole('button', { name: 'Cerrar tablero' }));
    expect(screen.getByText(/Ya no admitirá cambios/)).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Confirmar cierre del tablero' }));

    expect(calls.some((call) => call.route === 'POST /api/boards/board-1/close')).toBe(true);
  });
});
