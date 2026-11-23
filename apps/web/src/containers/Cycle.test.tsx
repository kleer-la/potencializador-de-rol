// @vitest-environment jsdom
import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Board, Cycle } from '../api/client.ts';
import { fakeBackend, json, type Routes } from '../test-support/fake-backend.ts';
import { Toaster } from '../components/Toaster.tsx';
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
  calibrationDraft: null,
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
  pastCycles: [],
});

const WARNING = '¡Pilas con tu foco, no agreguemos más de lo que podamos atender!';

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
          hypothesis: 'Si escucho a usuarios reales, el mapa cambia',
          expectedResult: 'Un mapa de usuarios validado',
          state: 'in_progress',
          result: null,
          observedResult: '',
          learnings: '',
          reviewedAt: null,
        },
        {
          id: 'experiment-2',
          description: 'Revisar métricas de uso',
          hypothesis: '',
          expectedResult: '',
          state: 'planned',
          result: null,
          observedResult: '',
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
  render(
    <>
      <Toaster />
      <BoardView boardId="board-1" onBack={() => {}} />
    </>,
  );
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
    expect((await screen.findByRole('status')).textContent).toContain('Ciclo creado.');
  });

  it('shows the planned cycle and lets owner and panel add a focus above its current level and an experiment', async () => {
    const { calls, user, section } = await open(board(planned), {
      'POST /api/boards/board-1/cycles/cycle-1/focuses': () => json({ focusId: 'focus-2' }, 201),
      'POST /api/boards/board-1/cycles/cycle-1/focuses/focus-1/experiments': () => json({ experimentId: 'experiment-1' }, 201),
    });

    expect(within(section()).getByText(/Ciclo 1 · Planeado/)).toBeTruthy();
    expect(within(section()).getByText('Focos: 1 · recomendados: 3')).toBeTruthy();
    expect(within(section()).queryByText(WARNING)).toBeNull();
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
    expect(await screen.findByText('Foco agregado.')).toBeTruthy();

    const fields = within(focus).getAllByRole('textbox').map((field) => field.closest('label')?.firstChild?.textContent);
    expect(fields).toEqual(['Hipótesis', 'Experimento', 'Resultado esperado']);
    await user.type(within(focus).getByLabelText('Experimento'), 'Entrevistar a tres usuarios');
    await user.type(within(focus).getByLabelText('Hipótesis'), 'Si escucho a usuarios reales, el mapa cambia');
    await user.type(within(focus).getByLabelText('Resultado esperado'), 'Un mapa de usuarios validado');
    await user.click(within(focus).getByRole('button', { name: 'Agregar experimento' }));
    expect(calls.find((call) => call.route.endsWith('/experiments'))?.body).toEqual({
      description: 'Entrevistar a tres usuarios',
      hypothesis: 'Si escucho a usuarios reales, el mapa cambia',
      expectedResult: 'Un mapa de usuarios validado',
    });
    expect(await screen.findByText('Experimento agregado.')).toBeTruthy();
    expect(within(section()).queryByRole('button', { name: 'Iniciar ciclo' })).toBeNull();
  });

  it('keeps adding focuses above the recommended number, warning when creating one', async () => {
    const { calls, user, section } = await open(board({ ...planned, maxFocuses: 1 }), {
      'POST /api/boards/board-1/cycles/cycle-1/focuses': () => json({ focusId: 'focus-2' }, 201),
    });

    expect(within(section()).getByText('Focos: 1 · recomendados: 1')).toBeTruthy();
    const form = within(section()).getByRole('heading', { name: 'Nuevo foco' }).closest('form')!;
    expect(within(form).getByText(WARNING)).toBeTruthy();
    await user.selectOptions(within(form).getByLabelText('Capacidad'), 'capability-2');
    await user.selectOptions(within(form).getByLabelText('Nivel objetivo'), 'level-1');
    await user.click(within(form).getByRole('button', { name: 'Agregar foco' }));
    expect(calls.find((call) => call.route.endsWith('/focuses'))?.body).toEqual({
      capabilityId: 'capability-2',
      targetLevelId: 'level-1',
    });
  });

  it('says why a focus was refused and reloads the board after a change', async () => {
    const { calls, user, section } = await open(board(planned), {
      'POST /api/boards/board-1/cycles/cycle-1/focuses': () => json({ error: 'already_focus' }, 409),
      'POST /api/boards/board-1/cycles/cycle-1/focuses/focus-1/experiments': () => json({ experimentId: 'experiment-1' }, 201),
    });

    await user.selectOptions(within(section()).getByLabelText('Capacidad'), 'capability-2');
    await user.selectOptions(within(section()).getByLabelText('Nivel objetivo'), 'level-1');
    await user.click(within(section()).getByRole('button', { name: 'Agregar foco' }));
    expect(await within(section()).findByText('Esa capacidad ya es un foco de este ciclo.')).toBeTruthy();

    const focus = within(section()).getByRole('article', { name: 'Identifica a quién sirve el producto' });
    await user.type(within(focus).getByLabelText('Experimento'), 'Entrevistar a tres usuarios');
    await user.click(within(focus).getByRole('button', { name: 'Agregar experimento' }));
    await screen.findByRole('heading', { name: 'Tablero de Ana Gómez' });
    expect(calls.filter((call) => call.route === 'GET /api/boards/board-1')).toHaveLength(2);
  });

  it('lets a panel member start the cycle after confirming, naming the focuses without an experiment', async () => {
    const { user, section } = await open(board(planned, leader), {
      'POST /api/boards/board-1/cycles/cycle-1/start': () =>
        json({ error: 'cannot_start', noFocus: false, withoutExperiment: ['capability-1'] }, 422),
    });

    await user.click(within(section()).getByRole('button', { name: 'Iniciar ciclo' }));
    expect(within(section()).getByText(/los focos ya no se agregan ni se quitan/)).toBeTruthy();
    await user.click(within(section()).getByRole('button', { name: 'Confirmar inicio' }));

    const alert = await within(section()).findByRole('alert');
    expect(within(alert).getByText('Identifica a quién sirve el producto')).toBeTruthy();
  });

  it('lets owner and panel change the target level of a focus in an active cycle', async () => {
    const retargetable: Cycle = {
      ...active,
      focuses: [{ ...active.focuses[0]!, id: 'focus-2', capabilityId: 'capability-2', targetLevelId: 'level-1' }],
    };
    const { calls, user, section } = await open(board(retargetable, leader), {
      'PATCH /api/boards/board-1/cycles/cycle-1/focuses/focus-2': () => json({ targetLevelId: 'level-2' }),
    });

    const focus = within(section()).getByRole('article', { name: 'Lee el estado actual del producto' });
    const options = within(within(focus).getByLabelText('Cambiar objetivo')).getAllByRole('option');
    expect(options.map((option) => option.textContent)).toEqual(['1 · Principiante', '2 · Practicante']);
    expect(within(focus).getByRole('button', { name: 'Guardar objetivo' }).hasAttribute('disabled')).toBe(true);
    await user.selectOptions(within(focus).getByLabelText('Cambiar objetivo'), 'level-2');
    await user.click(within(focus).getByRole('button', { name: 'Guardar objetivo' }));
    expect(calls.find((call) => call.route.startsWith('PATCH'))?.body).toEqual({ targetLevelId: 'level-2' });
  });

  it('offers no target change without another level above, nor in a closed cycle', async () => {
    const closed: Cycle = {
      ...active,
      id: 'cycle-0',
      state: 'closed',
      focuses: [{ id: 'focus-0', capabilityId: 'capability-2', targetLevelId: 'level-1', experiments: [] }],
    };
    const { user, section } = await open({ ...board(active, leader), pastCycles: [closed] });
    const focus = within(section()).getByRole('article', { name: 'Identifica a quién sirve el producto' });
    expect(within(focus).queryByLabelText('Cambiar objetivo')).toBeNull();

    const past = within(section()).getByRole('region', { name: 'Ciclos anteriores' });
    await user.click(within(past).getByText(/Ciclo 1 · Cerrado/));
    expect(within(past).getByRole('article', { name: 'Lee el estado actual del producto' })).toBeTruthy();
    expect(within(past).queryByLabelText('Cambiar objetivo')).toBeNull();
  });

  it('lets the participant edit an experiment that is not reviewed yet', async () => {
    const withReviewed: Cycle = {
      ...active,
      focuses: [
        {
          ...active.focuses[0]!,
          experiments: [
            ...active.focuses[0]!.experiments,
            { ...active.focuses[0]!.experiments[0]!, id: 'experiment-3', description: 'Ya revisado', state: 'reviewed', result: 'discarded' },
          ],
        },
      ],
    };
    const { calls, user, section } = await open(board(withReviewed), {
      'PUT /api/boards/board-1/experiments/experiment-1': () => json({ description: 'Entrevistar a cinco usuarios' }),
    });

    expect(within(section()).queryByRole('button', { name: 'Editar «Ya revisado»' })).toBeNull();
    const experiment = within(section()).getByRole('listitem', { name: 'Entrevistar a tres usuarios' });
    await user.click(within(experiment).getByRole('button', { name: 'Editar «Entrevistar a tres usuarios»' }));
    const description = within(experiment).getByLabelText('Experimento');
    expect((within(experiment).getByLabelText('Resultado esperado') as HTMLInputElement).value).toBe('Un mapa de usuarios validado');
    const editFields = within(experiment).getAllByRole('textbox').map((field) => field.closest('label')?.firstChild?.textContent);
    expect(editFields).toEqual(['Hipótesis', 'Experimento', 'Resultado esperado']);
    const hypothesis = within(experiment).getByLabelText('Hipótesis') as HTMLTextAreaElement;
    expect(hypothesis.value).toBe('Si escucho a usuarios reales, el mapa cambia');
    await user.clear(description);
    await user.type(description, 'Entrevistar a cinco usuarios');
    await user.clear(hypothesis);
    await user.type(hypothesis, 'Cinco voces muestran el patrón');
    await user.click(within(experiment).getByRole('button', { name: 'Guardar' }));
    expect(calls.find((call) => call.route.startsWith('PUT'))?.body).toEqual({
      description: 'Entrevistar a cinco usuarios',
      hypothesis: 'Cinco voces muestran el patrón',
      expectedResult: 'Un mapa de usuarios validado',
    });
  });

  it('shows the hypothesis of an experiment only when it has one', async () => {
    const { section } = await open(board(active));
    const withHypothesis = within(section()).getByRole('listitem', { name: 'Entrevistar a tres usuarios' });
    expect(within(withHypothesis).getByText('Hipótesis: Si escucho a usuarios reales, el mapa cambia')).toBeTruthy();
    const without = within(section()).getByRole('listitem', { name: 'Revisar métricas de uso' });
    expect(within(without).queryByText(/Hipótesis:/)).toBeNull();
  });

  it('cancels an experiment edit without saving', async () => {
    const { calls, user, section } = await open(board(active));
    const experiment = within(section()).getByRole('listitem', { name: 'Revisar métricas de uso' });
    await user.click(within(experiment).getByRole('button', { name: 'Editar «Revisar métricas de uso»' }));
    await user.click(within(experiment).getByRole('button', { name: 'Cancelar' }));
    expect(within(experiment).queryByLabelText('Experimento')).toBeNull();
    expect(calls.some((call) => call.route.startsWith('PUT'))).toBe(false);
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
    await user.selectOptions(within(experiment).getByLabelText('Conclusión'), 'consolidated');
    await user.type(within(experiment).getByLabelText(/^Resultado/), 'Dos usuarios pidieron exportar');
    await user.type(within(experiment).getByLabelText('Aprendizajes'), 'Escuchar antes de proponer');
    await user.click(within(experiment).getByRole('button', { name: 'Registrar revisión «Entrevistar a tres usuarios»' }));

    expect(calls.find((call) => call.route.startsWith('PATCH'))?.body).toEqual({
      state: 'reviewed',
      result: 'consolidated',
      observedResult: 'Dos usuarios pidieron exportar',
      learnings: 'Escuchar antes de proponer',
    });
  });

  it('shows the closed cycles with their focuses and experiments, read-only', async () => {
    const closed: Cycle = {
      ...active,
      id: 'cycle-0',
      number: 1,
      startsOn: '2026-09-01',
      endsOn: '2026-11-30',
      state: 'closed',
      focuses: [
        {
          id: 'focus-0',
          capabilityId: 'capability-1',
          targetLevelId: 'level-2',
          experiments: [
            {
              id: 'experiment-0',
              description: 'Entrevistar a tres usuarios',
              hypothesis: '',
              expectedResult: 'Un mapa de usuarios validado',
              state: 'reviewed',
              result: 'consolidated',
              observedResult: 'Dos usuarios pidieron exportar',
              learnings: 'Escuchar antes de proponer',
              reviewedAt: '2026-11-20T10:00:00Z',
            },
          ],
        },
      ],
    };
    const { user, section } = await open({ ...board({ ...planned, number: 2 }, leader), pastCycles: [closed] });

    const past = within(section()).getByRole('region', { name: 'Ciclos anteriores' });
    await user.click(within(past).getByText('Ciclo 1 · Cerrado · del 2026-09-01 al 2026-11-30'));
    const focus = within(past).getByRole('article', { name: 'Identifica a quién sirve el producto' });
    expect(within(focus).getByText('Nivel actual: 1 · Principiante · Objetivo: 2 · Practicante')).toBeTruthy();
    const experiment = within(focus).getByRole('listitem', { name: 'Entrevistar a tres usuarios' });
    expect(within(experiment).getByText('Revisado: Consolidó')).toBeTruthy();
    expect(within(experiment).getByText('Resultado: Dos usuarios pidieron exportar')).toBeTruthy();
    expect(within(experiment).getByText('Aprendizajes: Escuchar antes de proponer')).toBeTruthy();
    expect(within(past).queryByRole('button')).toBeNull();
    expect(within(past).queryByRole('textbox')).toBeNull();
  });

  it('shows no past cycles block before any cycle closes', async () => {
    const { section } = await open(board(planned));
    expect(within(section()).queryByRole('region', { name: 'Ciclos anteriores' })).toBeNull();
  });
});
