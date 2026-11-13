import { describe, expect, it } from 'vitest';
import {
  canMoveExperiment,
  canPlanCycle,
  canReviewExperiment,
  canStartCycle,
  isValidTarget,
  remainingFocuses,
  startBlockers,
} from './cycle.ts';
import type { BoardAccess } from './program.ts';

const board: BoardAccess = {
  ownerPersonId: 'ana',
  panel: [
    { personId: 'luis', role: 'leader' },
    { personId: 'eva', role: 'mentor' },
  ],
  hasBaseline: true,
};
const beforeBaseline: BoardAccess = { ...board, hasBaseline: false };

describe('who plans and who starts a cycle', () => {
  it('owner and panel plan it once the board has a baseline; nobody else', () => {
    expect(canPlanCycle('ana', board)).toBe(true);
    expect(canPlanCycle('luis', board)).toBe(true);
    expect(canPlanCycle('someone', board)).toBe(false);
    expect(canPlanCycle('ana', beforeBaseline)).toBe(false);
  });

  it('only a panel member starts it and reviews experiments', () => {
    expect(canStartCycle('eva', board)).toBe(true);
    expect(canStartCycle('ana', board)).toBe(false);
    expect(canStartCycle('eva', beforeBaseline)).toBe(false);
    expect(canReviewExperiment('luis', board)).toBe(true);
    expect(canReviewExperiment('ana', board)).toBe(false);
  });
});

describe('INV-8 bounded focuses', () => {
  it('INV-8 counts the focuses still allowed by the program maximum', () => {
    expect(remainingFocuses(3, 1)).toBe(2);
    expect(remainingFocuses(3, 3)).toBe(0);
    expect(remainingFocuses(2, 3)).toBe(0);
  });

  it('INV-8 a cycle starts with at least one focus, within the maximum, each with an experiment', () => {
    expect(startBlockers([{ capabilityId: 'c1', experiments: 1 }], 3)).toEqual({
      noFocus: false,
      tooMany: false,
      withoutExperiment: [],
    });
    expect(startBlockers([], 3)).toEqual({ noFocus: true, tooMany: false, withoutExperiment: [] });
    expect(
      startBlockers(
        [
          { capabilityId: 'c1', experiments: 0 },
          { capabilityId: 'c2', experiments: 2 },
          { capabilityId: 'c3', experiments: 0 },
        ],
        2,
      ),
    ).toEqual({ noFocus: false, tooMany: true, withoutExperiment: ['c1', 'c3'] });
  });
});

describe('target level of a focus', () => {
  it('is above the current level of a placed capability', () => {
    expect(isValidTarget(1, 2)).toBe(true);
    expect(isValidTarget(2, 2)).toBe(false);
    expect(isValidTarget(3, 1)).toBe(false);
    expect(isValidTarget(null, 1)).toBe(false);
  });
});

describe('experiment states', () => {
  it('goes from planned to in progress only in an active cycle', () => {
    expect(canMoveExperiment('planned', 'in_progress', 'active')).toBe(true);
    expect(canMoveExperiment('planned', 'in_progress', 'planned')).toBe(false);
  });

  it('is reviewed with a result once running; a planned one can only be discarded', () => {
    expect(canMoveExperiment('in_progress', 'reviewed', 'active', 'consolidated')).toBe(true);
    expect(canMoveExperiment('in_progress', 'reviewed', 'active', 'not_consolidated')).toBe(true);
    expect(canMoveExperiment('in_progress', 'reviewed', 'active', 'discarded')).toBe(true);
    expect(canMoveExperiment('planned', 'reviewed', 'active', 'discarded')).toBe(true);
    expect(canMoveExperiment('planned', 'reviewed', 'active', 'consolidated')).toBe(false);
    expect(canMoveExperiment('in_progress', 'reviewed', 'active')).toBe(false);
  });

  it('never leaves the reviewed state, and nothing moves in a cycle that is not active', () => {
    expect(canMoveExperiment('reviewed', 'in_progress', 'active')).toBe(false);
    expect(canMoveExperiment('reviewed', 'reviewed', 'active', 'discarded')).toBe(false);
    expect(canMoveExperiment('in_progress', 'reviewed', 'closed', 'consolidated')).toBe(false);
  });
});
