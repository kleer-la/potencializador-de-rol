// @vitest-environment jsdom
import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Board } from '../api/client.ts';
import { fakeBackend, json, type Routes } from '../test-support/fake-backend.ts';
import { BoardView } from './BoardsPage.tsx';
import { localToday } from './Evidence.tsx';

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
  canRecordEvidence: true,
  canProposeChanges: true,
  canDecideProposals: false,
  canRecordMentoring: false,
  canCloseCycle: false,
  canRecalibrate: false,
  canCloseBoard: false,
  ...overrides,
});
const owner = viewer({});
const leader = viewer({
  isOwner: false,
  panelRoles: ['leader'],
  canProposeChanges: false,
  canDecideProposals: true,
  canRecordMentoring: true,
  canStartCycle: true,
  canReviewExperiments: true,
});

const board = (who: Board['viewer']): Board => ({
  id: 'board-1',
  organizationId: 'org-a',
  program: { id: 'program-1', name: 'Product Owners 2027', mandatoryPanelRoles: ['leader'] },
  ownerName: 'Ana Gómez',
  owner: { personId: 'ana', name: 'Ana Gómez' },
  panel: [{ personId: 'luis', name: 'Luis Mora', role: 'leader' }],
  status: 'in_cycle',
  hasBaseline: true,
  viewer: who,
  levels: [
    { id: 'level-0', position: 0, name: 'No sabe', multiplier: 0, requiresTransfer: false },
    { id: 'level-1', position: 1, name: 'Principiante', multiplier: 1, requiresTransfer: false },
    { id: 'level-2', position: 2, name: 'Enseña', multiplier: 2, requiresTransfer: true },
  ],
  dimensions: [{ id: 'dimension-1', name: 'Entender', kind: 'work_cycle', position: 0 }],
  capabilities: [
    { id: 'capability-1', dimensionId: 'dimension-1', statement: 'Identifica a quién sirve el producto', difficulty: null, position: 0 },
  ],
  placements: [{ capabilityId: 'capability-1', levelId: 'level-0', addedAt: '2026-11-13T10:00:00Z' }],
  selfAssessment: null,
  calibration: null,
  baseline: { setAt: '2026-11-20T15:00:00Z', entries: [] },
  cycle: {
    id: 'cycle-1',
    number: 1,
    startsOn: '2026-12-01',
    endsOn: '2027-02-28',
    state: 'active',
    startedAt: '2026-12-01T10:00:00Z',
    maxFocuses: 3,
    focuses: [
      {
        id: 'focus-1',
        capabilityId: 'capability-1',
        targetLevelId: 'level-1',
        experiments: [
          {
            id: 'experiment-1',
            description: 'Entrevistar a tres usuarios',
            expectedResult: '',
            state: 'in_progress',
            result: null,
            learnings: '',
            reviewedAt: null,
          },
        ],
      },
    ],
  },
  evidence: [
    {
      id: 'evidence-1',
      description: 'Facilitó la revisión con datos',
      link: 'https://example.test/acta',
      occurredOn: '2026-12-10',
      showsTransfer: false,
      experimentId: null,
      authorId: 'ana',
      authorName: 'Ana Gómez',
    },
    {
      id: 'evidence-2',
      description: 'Enseñó la técnica a dos colegas',
      link: null,
      occurredOn: '2026-12-12',
      showsTransfer: true,
      experimentId: null,
      authorId: 'ana',
      authorName: 'Ana Gómez',
    },
  ],
  proposals: [
    {
      id: 'proposal-1',
      capabilityId: 'capability-1',
      proposedLevelId: 'level-1',
      state: 'proposed',
      proposedAt: '2026-12-13T10:00:00Z',
      decidedAt: null,
      decisionNote: '',
      evidenceIds: ['evidence-1'],
    },
  ],
  bonuses: [],
  bonusRules: [{ id: 'rule-1', name: 'Uso de IA', extraPoints: 1, condition: 'Usó IA y la transfirió' }],
  mentoringSessions: [],
  score: null,
  evolution: [],
  recalibrations: [],
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

async function open(who: Board['viewer'], routes: Routes = {}) {
  const calls = fakeBackend({ 'GET /api/boards/board-1': () => json(board(who)), ...routes });
  const user = userEvent.setup();
  render(<BoardView boardId="board-1" onBack={() => {}} />);
  await screen.findByRole('heading', { name: 'Tablero de Ana Gómez' });
  const region = (name: string) => screen.getByRole('region', { name });
  return { calls, user, region };
}

describe('default dates', () => {
  it('use the local date, not the UTC one', () => {
    // 21:30 on 15 December in a time zone behind UTC is already 16 December in UTC.
    const lateEvening = new Date(2026, 11, 15, 21, 30);
    expect(localToday(lateEvening)).toBe('2026-12-15');
  });
});

describe('evidence', () => {
  it('lists the facts and lets the owner record one, saying whether it shows transfer', async () => {
    const { calls, user, region } = await open(owner, {
      'POST /api/boards/board-1/evidence': () => json({ evidenceId: 'evidence-3' }, 201),
    });

    const facts = region('Evidencias');
    expect(within(facts).getByRole('link', { name: 'https://example.test/acta' })).toBeTruthy();
    expect(within(facts).getByText('Enseñó a otros')).toBeTruthy();
    await user.type(within(facts).getByLabelText('Hecho'), 'Presentó el roadmap al comité');
    await user.clear(within(facts).getByLabelText('Fecha del hecho'));
    await user.type(within(facts).getByLabelText('Fecha del hecho'), '2026-12-15');
    await user.type(within(facts).getByLabelText('Enlace (opcional)'), 'https://example.test/roadmap');
    await user.click(within(facts).getByRole('checkbox', { name: 'Muestra que enseñó a otros' }));
    await user.click(within(facts).getByRole('button', { name: 'Registrar evidencia' }));

    expect(calls.find((call) => call.route.endsWith('/evidence'))?.body).toEqual({
      description: 'Presentó el roadmap al comité',
      occurredOn: '2026-12-15',
      link: 'https://example.test/roadmap',
      showsTransfer: true,
    });
  });
});

describe('level changes', () => {
  it('lets the owner propose a higher level citing evidence, and explains a refusal', async () => {
    const { calls, user, region } = await open(owner, {
      'POST /api/boards/board-1/level-proposals': () => json({ error: 'invalid_proposal', problems: ['no_transfer_evidence'] }, 422),
    });

    const changes = region('Cambios de nivel');
    expect(within(changes).getByText(/Identifica a quién sirve el producto → 1 · Principiante/)).toBeTruthy();
    expect(within(changes).queryByRole('button', { name: /Aprobar/ })).toBeNull();
    await user.selectOptions(within(changes).getByLabelText('Capacidad'), 'capability-1');
    const target = within(changes).getByLabelText('Nivel propuesto');
    expect(within(target).queryByRole('option', { name: '0 · No sabe' })).toBeNull();
    await user.selectOptions(target, 'level-2');
    await user.click(within(changes).getByRole('checkbox', { name: 'Facilitó la revisión con datos' }));
    await user.click(within(changes).getByRole('button', { name: 'Proponer cambio' }));

    expect(calls.find((call) => call.route.endsWith('/level-proposals'))?.body).toEqual({
      capabilityId: 'capability-1',
      levelId: 'level-2',
      evidenceIds: ['evidence-1'],
    });
    expect(await within(changes).findByText('Ese nivel exige una evidencia de haber enseñado a otros.')).toBeTruthy();
  });

  it('lets a panel member approve a proposal with a note', async () => {
    const { calls, user, region } = await open(leader, {
      'POST /api/boards/board-1/level-proposals/proposal-1/decision': () => json({ state: 'approved' }),
    });

    const changes = region('Cambios de nivel');
    expect(within(changes).queryByRole('button', { name: 'Proponer cambio' })).toBeNull();
    const subject = '«Identifica a quién sirve el producto → 1 · Principiante»';
    await user.type(within(changes).getByLabelText(`Nota de la decisión sobre ${subject}`), 'Consolidado en dos sprints');
    await user.click(within(changes).getByRole('button', { name: `Aprobar ${subject}` }));

    expect(calls.find((call) => call.route.endsWith('/decision'))?.body).toEqual({ approve: true, note: 'Consolidado en dos sprints' });
  });
});

describe('bonuses and mentoring', () => {
  it('lets the owner propose a bonus of the map with evidence', async () => {
    const { calls, user, region } = await open(owner, {
      'POST /api/boards/board-1/bonuses': () => json({ bonusId: 'bonus-1' }, 201),
    });

    const bonuses = region('Bonificaciones');
    expect(within(bonuses).getByText(/Uso de IA \(\+1\): Usó IA y la transfirió/)).toBeTruthy();
    await user.selectOptions(within(bonuses).getByLabelText('Capacidad'), 'capability-1');
    await user.selectOptions(within(bonuses).getByLabelText('Regla'), 'rule-1');
    await user.click(within(bonuses).getByRole('checkbox', { name: 'Enseñó la técnica a dos colegas' }));
    await user.click(within(bonuses).getByRole('button', { name: 'Proponer bonificación' }));

    expect(calls.find((call) => call.route.endsWith('/bonuses'))?.body).toEqual({
      capabilityId: 'capability-1',
      bonusRuleId: 'rule-1',
      evidenceIds: ['evidence-2'],
    });
  });

  it('lets a panel member record a mentoring session with the experiments reviewed', async () => {
    const { calls, user, region } = await open(leader, {
      'POST /api/boards/board-1/mentoring-sessions': () => json({ mentoringSessionId: 'session-1' }, 201),
    });

    const mentoring = region('Mentorías');
    await user.clear(within(mentoring).getByLabelText('Fecha de la sesión'));
    await user.type(within(mentoring).getByLabelText('Fecha de la sesión'), '2027-01-15');
    await user.type(within(mentoring).getByLabelText('Notas'), 'Revisamos el avance');
    await user.click(within(mentoring).getByRole('checkbox', { name: 'Entrevistar a tres usuarios' }));
    await user.click(within(mentoring).getByRole('button', { name: 'Registrar mentoría' }));

    expect(calls.find((call) => call.route.endsWith('/mentoring-sessions'))?.body).toEqual({
      heldOn: '2027-01-15',
      notes: 'Revisamos el avance',
      experimentIds: ['experiment-1'],
    });
  });
});
