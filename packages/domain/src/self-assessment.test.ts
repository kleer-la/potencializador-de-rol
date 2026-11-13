import { describe, expect, it } from 'vitest';
import type { BoardAccess } from './program.ts';
import { canSeeSelfAssessment, canWriteSelfAssessment, missingFromSelfAssessment } from './self-assessment.ts';

const board: BoardAccess = {
  ownerPersonId: 'ana',
  panel: [{ personId: 'luis', role: 'leader' }],
  hasBaseline: false,
};

describe('who writes a self-assessment', () => {
  it('only the owner, and only until it is submitted', () => {
    expect(canWriteSelfAssessment('ana', board, false)).toBe(true);
    expect(canWriteSelfAssessment('ana', board, true)).toBe(false);
    expect(canWriteSelfAssessment('luis', board, false)).toBe(false);
    expect(canWriteSelfAssessment('someone', board, false)).toBe(false);
  });
});

describe('INV-9 who sees a self-assessment', () => {
  it('INV-9 the owner always, the panel once submitted, nobody else', () => {
    expect(canSeeSelfAssessment('ana', board, false)).toBe(true);
    expect(canSeeSelfAssessment('luis', board, false)).toBe(false);
    expect(canSeeSelfAssessment('luis', board, true)).toBe(true);
    expect(canSeeSelfAssessment('someone', board, true)).toBe(false);
  });
});

describe('what is missing to submit', () => {
  it('names every capability on the board without a proposed level, in board order', () => {
    const missing = missingFromSelfAssessment(
      ['c1', 'c2', 'c3', 'c4'],
      [
        { capabilityId: 'c1', levelId: 'l0' },
        { capabilityId: 'c3', levelId: null },
        { capabilityId: 'gone', levelId: 'l1' },
      ],
    );

    expect(missing).toEqual(['c2', 'c3', 'c4']);
  });

  it('is empty when every capability has a level', () => {
    expect(missingFromSelfAssessment(['c1'], [{ capabilityId: 'c1', levelId: 'l2' }])).toEqual([]);
  });
});
