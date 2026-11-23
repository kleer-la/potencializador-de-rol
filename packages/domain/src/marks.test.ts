import { describe, expect, it } from 'vitest';
import { BOARD_MARKS, canMarkCapability, isMarkedByHand } from './marks.ts';
import type { BoardAccess } from './program.ts';

const board: BoardAccess = {
  ownerPersonId: 'ana',
  panel: [{ personId: 'luis', role: 'mentor' }],
  programLeaders: ['marta'],
  hasBaseline: true,
};

describe('marks on the capabilities of a board', () => {
  it('come from one catalog: candidate and work in progress', () => {
    expect(BOARD_MARKS).toEqual(['candidate', 'wip']);
  });

  it('are put and taken off by the owner and their panel only', () => {
    expect(canMarkCapability('ana', board)).toBe(true);
    expect(canMarkCapability('luis', board)).toBe(true);
    expect(canMarkCapability('marta', board)).toBe(false);
    expect(canMarkCapability('stranger', board)).toBe(false);
  });

  it('are put by hand except work in progress, which follows the experiments', () => {
    expect(isMarkedByHand('candidate')).toBe(true);
    expect(isMarkedByHand('wip')).toBe(false);
  });
});
