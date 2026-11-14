import { describe, expect, it } from 'vitest';
import type { BoardAccess } from './program.ts';
import { canCloseBoard, canCloseCycle, canRecalibrate, computeScore, withChanges, type ScoreEntry } from './score.ts';

const entry = (capabilityId: string, multiplier: number | null, overrides: Partial<ScoreEntry> = {}): ScoreEntry => ({
  capabilityId,
  dimensionId: 'd1',
  difficulty: null,
  multiplier,
  bonusPoints: 0,
  ...overrides,
});

describe('maturity score (document §5.2)', () => {
  it('reproduces the verified example: 10 capabilities score 17, with a maximum of 40', () => {
    const levels = [0, 0, 1, 1, 1, 2, 2, 2, 3, 4];
    const entries = levels.map((multiplier, index) => entry(`c${index}`, multiplier, { bonusPoints: index === 9 ? 1 : 0 }));

    const score = computeScore(entries, 4);

    expect(score).toMatchObject({ total: 17, maximum: 40, capabilities: 10 });
  });

  it('counts an unplaced capability as zero, and it still raises the maximum', () => {
    expect(computeScore([entry('a', 2), entry('b', null)], 4)).toMatchObject({ total: 2, maximum: 8, capabilities: 2 });
  });

  it('breaks the score down by dimension and by difficulty, without weighting difficulty', () => {
    const score = computeScore(
      [
        entry('a', 3, { dimensionId: 'd1', difficulty: 'high' }),
        entry('b', 1, { dimensionId: 'd2', difficulty: 'low', bonusPoints: 1 }),
        entry('c', 2, { dimensionId: 'd1', difficulty: 'low' }),
        entry('d', null, { dimensionId: 'd2' }),
      ],
      4,
    );

    expect(score.total).toBe(7);
    expect(score.byDimension).toEqual([
      { dimensionId: 'd1', total: 5, maximum: 8, capabilities: 2 },
      { dimensionId: 'd2', total: 2, maximum: 8, capabilities: 2 },
    ]);
    expect(score.byDifficulty).toEqual([
      { difficulty: 'low', total: 4, maximum: 8, capabilities: 2 },
      { difficulty: 'high', total: 3, maximum: 4, capabilities: 1 },
      { difficulty: null, total: 0, maximum: 4, capabilities: 1 },
    ]);
  });
});

describe('evolution', () => {
  it('adds the change from the previous point', () => {
    expect(
      withChanges([
        { kind: 'baseline', total: 10 },
        { kind: 'cycle_close', total: 14 },
        { kind: 'today', total: 13 },
      ]),
    ).toEqual([
      { kind: 'baseline', total: 10, change: null },
      { kind: 'cycle_close', total: 14, change: 4 },
      { kind: 'today', total: 13, change: -1 },
    ]);
  });
});

describe('who closes and recalibrates', () => {
  const board: BoardAccess = { ownerPersonId: 'ana', panel: [{ personId: 'eva', role: 'mentor' }], hasBaseline: true };

  it('a panel member closes the active cycle; never the owner', () => {
    expect(canCloseCycle('eva', board, 'active')).toBe(true);
    expect(canCloseCycle('ana', board, 'active')).toBe(false);
    expect(canCloseCycle('eva', board, 'planned')).toBe(false);
  });

  it('a panel member recalibrates between cycles only', () => {
    expect(canRecalibrate('eva', board, 'between_cycles')).toBe(true);
    expect(canRecalibrate('eva', board, 'in_cycle')).toBe(false);
    expect(canRecalibrate('ana', board, 'between_cycles')).toBe(false);
  });

  it('a panel member closes a board with no cycle open', () => {
    expect(canCloseBoard('eva', board, 'between_cycles')).toBe(true);
    expect(canCloseBoard('eva', board, 'calibrated')).toBe(true);
    expect(canCloseBoard('eva', board, 'in_cycle')).toBe(false);
    expect(canCloseBoard('eva', board, 'closed')).toBe(false);
    expect(canCloseBoard('ana', board, 'between_cycles')).toBe(false);
  });
});
