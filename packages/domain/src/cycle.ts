// Rules of improvement cycles, focuses and experiments. Conceptual base: sections 5.1
// (invariants 8 and 9), 6.2 steps 3 to 5, 6.3.
import { canSeeBoardContent, isOnPanel, type BoardAccess } from './program.ts';

export const CYCLE_STATES = ['planned', 'active', 'closed'] as const;
export type CycleState = (typeof CYCLE_STATES)[number];

export const EXPERIMENT_STATES = ['planned', 'in_progress', 'reviewed'] as const;
export type ExperimentState = (typeof EXPERIMENT_STATES)[number];

export const EXPERIMENT_RESULTS = ['consolidated', 'not_consolidated', 'discarded'] as const;
export type ExperimentResult = (typeof EXPERIMENT_RESULTS)[number];

/** Participant and panel plan cycles together, once the board has its baseline. */
export function canPlanCycle(personId: string, board: BoardAccess): boolean {
  return board.hasBaseline && canSeeBoardContent(personId, board);
}

/** Starting the cycle is the panel's agreement on its focuses. */
export function canStartCycle(personId: string, board: BoardAccess): boolean {
  return board.hasBaseline && isOnPanel(personId, board);
}

/** The panel reviews experiments, as in a mentoring session. */
export function canReviewExperiment(personId: string, board: BoardAccess): boolean {
  return board.hasBaseline && isOnPanel(personId, board);
}

/** Invariant 8: focuses a cycle may still take under the program's maximum. */
export function remainingFocuses(maxFocuses: number, focusCount: number): number {
  return Math.max(0, maxFocuses - focusCount);
}

/**
 * Invariant 8: what keeps a planned cycle from starting. It needs a focus, no more focuses
 * than the maximum, and at least one experiment per focus (named, in the given order).
 */
export function startBlockers(
  focuses: readonly { capabilityId: string; experiments: number }[],
  maxFocuses: number,
): { noFocus: boolean; tooMany: boolean; withoutExperiment: string[] } {
  return {
    noFocus: focuses.length === 0,
    tooMany: focuses.length > maxFocuses,
    withoutExperiment: focuses.filter((focus) => focus.experiments === 0).map((focus) => focus.capabilityId),
  };
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
