// @vitest-environment jsdom
import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Board, Cycle } from '../api/client.ts';
import { fakeBackend, json, type Routes } from '../test-support/fake-backend.ts';
import { BoardView } from './BoardsPage.tsx';

const viewer = (overrides: Partial<Board['viewer']>): Board['viewer'] => ({
  isOwner: true,
  panelRoles: [],
  canAdd: false,
  canRemove: false,
  canSelfAssess: false,
  canCalibrate: false,
  canRecordInitialLevel: false,
  canPlanCycle: true,
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
const leader = viewer({ isOwner: false, panelRoles: ['leader'], canAdd: true, canStartCycle: true, canReviewExperiments: true });

const board = (cycle: Cycle | null, who = viewer({})): Board => ({
  id: 'board-1',
  organizationId: 'org-a',
  program: { id: 'program-1', name: 'Product Owners 2027', mandatoryPanelRoles: ['leader'] },
  ownerName: 'Ana Gómez',
  owner: { personId: 'ana', name: 'Ana Gómez' },
  panel: [{ personId: 'luis', name: 'Luis Mora', role: 'leader' }],
  status: cycle?.state === 'active' ? 'in_cycle' : 'calibrated',
  hasBaseline: true,
  viewer: who,
  levels: [
    { id: 'level-0', position: 0, name: 'No sabe', multiplier: 0, requiresTransfer: false },
    { id: 'level-1', position: 1, name: 'Principiante', multiplier: 1, requiresTransfer: false },
    { id: 'level-2', position: 2, name: 'Practicante', multiplier: 2, requiresTransfer: false },
  ],
  dimensions: [{ id: 'dimension-1', name: 'Entender', kind: 'work_cycle', position: 0 }],
  capabilities: [
    { id: 'capability-1', dimensionId: 'dimension-1', statement: 'Identifica a quién sirve el producto', difficulty: 'medium', position: 0 },
    { id: 'capability-2', dimensionId: 'dimension-1', statement: 'Lee el estado actual del producto', difficulty: null, position: 1 },
  ],
  placements: [
    { capabilityId: 'capability-1', levelId: 'level-1', addedAt: '2026-11-13T10:00:00Z' },
    { capabilityId: 'capability-2', levelId: 'level-0', addedAt: '2026-11-13T10:00:00Z' },
  ],
  selfAssessment: null,
  calibration: null,
  baseline: { setAt: '2026-11-20T15:00:00Z', entries: [] },
  cycle,
  evidence: [],
  proposals: [],
  bonuses: [],
  bonusRules: [],
  mentoringSessions: [],
  score: null,
  evolution: [],
  recalibrations: [],
});

const planned: Cycle = {
  id: 'cycle-1',
  number: 1,
  startsOn: '2026-12-01',
  endsOn: '2027-02-28',
  state: 'planned',
  startedAt: null,
  maxFocuses: 3,
  focuses: [{ id: 'focus-1', capabilityId: 'capability-1', targetLevelId: 'level-2', experiments: [] }],
};

const active: Cycle = {
  ...planned,
  state: 'active',
  startedAt: '2026-12-01T10:00:00Z',
  focuses: [
    {
      id: 'focus-1',
      capabilityId: 'capability-1',
      targetLevelId: 'level-2',
      experiments: [
        {
          id: 'experiment-1',
          description: 'Entrevistar a tres usuarios',
          expectedResult: 'Un mapa de usuarios validado',
          state: 'in_progress',
          result: null,
          learnings: '',
          reviewedAt: null,
        },
        {
          id: 'experiment-2',
          description: 'Revisar métricas de uso',
          expectedResult: '',
          state: 'planned',
          result: null,
          learnings: '',
          reviewedAt: null,
        },
      ],
    },
  ],
};

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

async function open(loaded: Board, routes: Routes = {}) {
  const calls = fakeBackend({ 'GET /api/boards/board-1': () => json(loaded), ...routes });
  const user = userEvent.setup();
  render(<BoardView boardId="board-1" onBack={() => {}} />);
  await screen.findByRole('heading', { name: 'Tablero de Ana Gómez' });
  return { calls, user, section: () => screen.getByRole('region', { name: 'Ciclo de mejora' }) };
}

describe('cycle', () => {
  it('lets the participant open a cycle with its dates', async () => {
    const { calls, user, section } = await open(board(null), {
      'POST /api/boards/board-1/cycles': () => json({ cycleId: 'cycle-1' }, 201),
    });

    await user.type(within(section()).getByLabelText('Inicio'), '2026-12-01');
    await user.type(within(section()).getByLabelText('Fin'), '2027-02-28');
    await user.click(within(section()).getByRole('button', { name: 'Crear ciclo' }));

    expect(calls.find((call) => call.route === 'POST /api/boards/board-1/cycles')?.body).toEqual({
      startsOn: '2026-12-01',
      endsOn: '2027-02-28',
    });
  });

  it('shows the planned cycle and lets owner and panel add a focus above its current level and an experiment', async () => {
    const { calls, user, section } = await open(board(planned), {
      'POST /api/boards/board-1/cycles/cycle-1/focuses': () => json({ focusId: 'focus-2' }, 201),
      'POST /api/boards/board-1/cycles/cycle-1/focuses/focus-1/experiments': () => json({ experimentId: 'experiment-1' }, 201),
    });

    expect(within(section()).getByText(/Ciclo 1 · Planeado/)).toBeTruthy();
    expect(within(section()).getByText('1 de 3 focos')).toBeTruthy();
    const focus = within(section()).getByRole('article', { name: 'Identifica a quién sirve el producto' });
    expect(within(focus).getByText('Nivel actual: 1 · Principiante · Objetivo: 2 · Practicante')).toBeTruthy();

    await user.selectOptions(within(section()).getByLabelText('Capacidad'), 'capability-2');
    const target = within(section()).getByLabelText('Nivel objetivo');
    expect(within(target).queryByRole('option', { name: '0 · No sabe' })).toBeNull();
    await user.selectOptions(target, 'level-1');
    await user.click(within(section()).getByRole('button', { name: 'Agregar foco' }));
    expect(calls.find((call) => call.route.endsWith('/focuses'))?.body).toEqual({
      capabilityId: 'capability-2',
      targetLevelId: 'level-1',
    });

    await user.type(within(focus).getByLabelText('Experimento'), 'Entrevistar a tres usuarios');
    await user.type(within(focus).getByLabelText('Resultado esperado'), 'Un mapa de usuarios validado');
    await user.click(within(focus).getByRole('button', { name: 'Agregar experimento' }));
    expect(calls.find((call) => call.route.endsWith('/experiments'))?.body).toEqual({
      description: 'Entrevistar a tres usuarios',
      expectedResult: 'Un mapa de usuarios validado',
    });
    expect(within(section()).queryByRole('button', { name: 'Iniciar ciclo' })).toBeNull();
  });

  it('says why a focus was refused and reloads the board after a change', async () => {
    const { calls, user, section } = await open(board(planned), {
      'POST /api/boards/board-1/cycles/cycle-1/focuses': () => json({ error: 'too_many_focuses', maxFocuses: 3 }, 422),
      'POST /api/boards/board-1/cycles/cycle-1/focuses/focus-1/experiments': () => json({ experimentId: 'experiment-1' }, 201),
    });

    await user.selectOptions(within(section()).getByLabelText('Capacidad'), 'capability-2');
    await user.selectOptions(within(section()).getByLabelText('Nivel objetivo'), 'level-1');
    await user.click(within(section()).getByRole('button', { name: 'Agregar foco' }));
    expect(await within(section()).findByText('El ciclo ya tiene el máximo de focos del programa.')).toBeTruthy();

    const focus = within(section()).getByRole('article', { name: 'Identifica a quién sirve el producto' });
    await user.type(within(focus).getByLabelText('Experimento'), 'Entrevistar a tres usuarios');
    await user.click(within(focus).getByRole('button', { name: 'Agregar experimento' }));
    await screen.findByRole('heading', { name: 'Tablero de Ana Gómez' });
    expect(calls.filter((call) => call.route === 'GET /api/boards/board-1')).toHaveLength(2);
  });

  it('lets a panel member start the cycle after confirming, naming the focuses without an experiment', async () => {
    const { user, section } = await open(board(planned, leader), {
      'POST /api/boards/board-1/cycles/cycle-1/start': () =>
        json({ error: 'cannot_start', noFocus: false, tooMany: false, withoutExperiment: ['capability-1'] }, 422),
    });

    await user.click(within(section()).getByRole('button', { name: 'Iniciar ciclo' }));
    expect(within(section()).getByText(/los focos quedan fijos/)).toBeTruthy();
    await user.click(within(section()).getByRole('button', { name: 'Confirmar inicio' }));

    const alert = await within(section()).findByRole('alert');
    expect(within(alert).getByText('Identifica a quién sirve el producto')).toBeTruthy();
  });

  it('lets the participant mark an experiment in progress, without reviewing it', async () => {
    const { calls, user, section } = await open(board(active), {
      'PATCH /api/boards/board-1/experiments/experiment-2': () => json({ state: 'in_progress' }),
    });

    expect(within(section()).getByText(/Ciclo 1 · Activo/)).toBeTruthy();
    expect(within(section()).queryByRole('button', { name: /Quitar foco/ })).toBeNull();
    await user.click(within(section()).getByRole('button', { name: 'Marcar en curso «Revisar métricas de uso»' }));
    expect(calls.find((call) => call.route.startsWith('PATCH'))?.body).toEqual({ state: 'in_progress' });
    expect(within(section()).queryByRole('button', { name: /Registrar revisión/ })).toBeNull();
  });

  it('lets a panel member review an experiment with its result and learnings', async () => {
    const { calls, user, section } = await open(board(active, leader), {
      'PATCH /api/boards/board-1/experiments/experiment-1': () => json({ state: 'reviewed' }),
    });

    const experiment = within(section()).getByRole('listitem', { name: 'Entrevistar a tres usuarios' });
    await user.selectOptions(within(experiment).getByLabelText('Resultado'), 'consolidated');
    await user.type(within(experiment).getByLabelText('Aprendizajes'), 'Escuchar antes de proponer');
    await user.click(within(experiment).getByRole('button', { name: 'Registrar revisión «Entrevistar a tres usuarios»' }));

    expect(calls.find((call) => call.route.startsWith('PATCH'))?.body).toEqual({
      state: 'reviewed',
      result: 'consolidated',
      learnings: 'Escuchar antes de proponer',
    });
  });
});
