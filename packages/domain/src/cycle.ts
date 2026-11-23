// Rules of improvement cycles, focuses and experiments. Conceptual base: sections 5.1
// (invariants 8 and 9), 6.2 steps 3 to 5, 6.3.
import { isOnPanel, takesPartIn, type BoardAccess } from './program.ts';

export const CYCLE_STATES = ['planned', 'active', 'closed'] as const;
export type CycleState = (typeof CYCLE_STATES)[number];

export const EXPERIMENT_STATES = ['planned', 'in_progress', 'reviewed'] as const;
export type ExperimentState = (typeof EXPERIMENT_STATES)[number];

export const EXPERIMENT_RESULTS = ['consolidated', 'not_consolidated', 'discarded'] as const;
export type ExperimentResult = (typeof EXPERIMENT_RESULTS)[number];

/** Participant and panel plan cycles together, once the board has its baseline. */
export function canPlanCycle(personId: string, board: BoardAccess): boolean {
  return board.hasBaseline && takesPartIn(personId, board);
}

/** Starting the cycle is the panel's agreement on its focuses. */
export function canStartCycle(personId: string, board: BoardAccess): boolean {
  return board.hasBaseline && isOnPanel(personId, board);
}

/** The panel reviews experiments, as in a mentoring session. */
export function canReviewExperiment(personId: string, board: BoardAccess): boolean {
  return board.hasBaseline && isOnPanel(personId, board);
}

/**
 * Invariant 8: the program recommends how many focuses a cycle takes. A new focus beyond
 * that number is allowed, with a warning: few focuses are what the person can attend to.
 */
export function addsFocusAboveRecommended(recommendedFocuses: number, focusCount: number): boolean {
  return focusCount >= recommendedFocuses;
}

/**
 * Invariant 8: what keeps a planned cycle from starting. It needs a focus and at least one
 * experiment per focus (named, in the given order), whatever the number of focuses.
 */
export function startBlockers(
  focuses: readonly { capabilityId: string; experiments: number }[],
): { noFocus: boolean; withoutExperiment: string[] } {
  return {
    noFocus: focuses.length === 0,
    withoutExperiment: focuses.filter((focus) => focus.experiments === 0).map((focus) => focus.capabilityId),
  };
}

/**
 * What keeps an active cycle from closing: experiments not reviewed yet, planned or in
 * progress (user decision of 2026-11-23), named in the given order. A planned one that
 * never ran is reviewed as discarded, so the panel can always close.
 */
export function closeBlockers(experiments: readonly { id: string; state: ExperimentState }[]): string[] {
  return experiments.filter((experiment) => experiment.state !== 'reviewed').map((experiment) => experiment.id);
}

/**
 * A focus aims above where the capability is now. A capability without a level (added
 * after the baseline, before its initial leveling) cannot be a focus yet.
 */
export function isValidTarget(currentPosition: number | null, targetPosition: number): boolean {
  return currentPosition !== null && targetPosition > currentPosition;
}

/**
 * Experiment states: planned → in progress → reviewed with a result. A planned one may be
 * reviewed only as discarded. Nothing moves outside an active cycle, and reviewed is final.
 */
export function canMoveExperiment(
  from: ExperimentState,
  to: ExperimentState,
  cycle: CycleState,
  result?: ExperimentResult,
): boolean {
  if (cycle !== 'active') return false;
  if (from === 'planned' && to === 'in_progress') return result === undefined;
  if (to !== 'reviewed' || result === undefined) return false;
  if (from === 'in_progress') return true;
  return from === 'planned' && result === 'discarded';
}
