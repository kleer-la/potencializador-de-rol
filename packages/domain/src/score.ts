// The maturity score and how it is shown; closing and recalibrating. Conceptual base:
// sections 5.1 (invariants 4 and 9), 5.2, 5.3, 6.2 steps 6 and 7, 6.3.
import type { Difficulty } from './capability-map.ts';
import { isOnPanel, type BoardAccess } from './program.ts';

export type ScoreEntry = {
  capabilityId: string;
  dimensionId: string;
  difficulty: Difficulty | null;
  /** Multiplier of the capability's level; null when unplaced (it counts zero). */
  multiplier: number | null;
  /** Extra points of its approved bonuses. */
  bonusPoints: number;
};

type Part = { total: number; maximum: number; capabilities: number };

const DIFFICULTY_ORDER: (Difficulty | null)[] = ['low', 'medium', 'high', null];

const sum = (entries: readonly ScoreEntry[], topMultiplier: number): Part => ({
  total: entries.reduce((total, entry) => total + (entry.multiplier ?? 0) + entry.bonusPoints, 0),
  maximum: entries.length * topMultiplier,
  capabilities: entries.length,
});

/**
 * The score of a board (§5.2): per capability, the multiplier of its level plus its
 * approved bonuses. The maximum, without bonuses, is every capability at the top level.
 * Difficulty is a breakdown only; it never weights the score.
 */
export function computeScore(entries: readonly ScoreEntry[], topMultiplier: number) {
  const dimensions = [...new Set(entries.map((entry) => entry.dimensionId))];
  return {
    ...sum(entries, topMultiplier),
    byDimension: dimensions.map((dimensionId) => ({
      dimensionId,
      ...sum(
        entries.filter((entry) => entry.dimensionId === dimensionId),
        topMultiplier,
      ),
    })),
    byDifficulty: DIFFICULTY_ORDER.filter((difficulty) => entries.some((entry) => entry.difficulty === difficulty)).map(
      (difficulty) => ({
        difficulty,
        ...sum(
          entries.filter((entry) => entry.difficulty === difficulty),
          topMultiplier,
        ),
      }),
    ),
  };
}

/** Each point of the evolution with its change from the previous one (§5.3). */
export function withChanges<T extends { total: number }>(points: readonly T[]): (T & { change: number | null })[] {
  return points.map((point, index) => ({ ...point, change: index === 0 ? null : point.total - points[index - 1]!.total }));
}

/** A panel member closes the active cycle; the board then waits between cycles. */
export function canCloseCycle(personId: string, board: BoardAccess, cycleState: string): boolean {
  return board.hasBaseline && isOnPanel(personId, board) && cycleState === 'active';
}

/** A recalibration happens between cycles, recorded by a panel member. */
export function canRecalibrate(personId: string, board: BoardAccess, boardStatus: string): boolean {
  return board.hasBaseline && isOnPanel(personId, board) && boardStatus === 'between_cycles';
}

/** A panel member closes a board with no cycle open. */
export function canCloseBoard(personId: string, board: BoardAccess, boardStatus: string): boolean {
  return board.hasBaseline && isOnPanel(personId, board) && (boardStatus === 'calibrated' || boardStatus === 'between_cycles');
}
