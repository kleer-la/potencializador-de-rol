import { describe, expect, it } from 'vitest';
import {
  canAdjustSelection,
  canEnrollAs,
  canSeeBoardContent,
  ENROLLMENT_ROLES,
  missingPanelRoles,
  PANEL_ROLES,
  type BoardAccess,
} from './program.ts';

const board: BoardAccess = {
  ownerPersonId: 'ana',
  panel: [
    { personId: 'luis', role: 'leader' },
    { personId: 'kleer-mentor', role: 'mentor' },
  ],
  hasBaseline: false,
};

describe('enrollment roles', () => {
  it('are participant plus the three panel roles', () => {
    expect(PANEL_ROLES).toEqual(['leader', 'specialist', 'mentor']);
    expect(ENROLLMENT_ROLES).toEqual(['participant', 'leader', 'specialist', 'mentor']);
  });

  it('let a person of the organization take any role', () => {
    for (const role of ENROLLMENT_ROLES) {
      expect(canEnrollAs({ isFirmPerson: false }, role), role).toBe(true);
    }
  });

  it('let a person of the mentoring firm join a panel but never be a participant', () => {
    expect(canEnrollAs({ isFirmPerson: true }, 'mentor')).toBe(true);
    expect(canEnrollAs({ isFirmPerson: true }, 'leader')).toBe(true);
    expect(canEnrollAs({ isFirmPerson: true }, 'participant')).toBe(false);
  });
});

describe('INV-9 who sees the content of a board', () => {
  it('INV-9 its owner and each member of their panel', () => {
    expect(canSeeBoardContent('ana', board)).toBe(true);
    expect(canSeeBoardContent('luis', board)).toBe(true);
    expect(canSeeBoardContent('kleer-mentor', board)).toBe(true);
  });

  it('INV-9 nobody else, whatever their organization role', () => {
    expect(canSeeBoardContent('another-participant', board)).toBe(false);
    expect(canSeeBoardContent('organization-administrator', board)).toBe(false);
  });
});

describe('INV-1 who changes the capabilities of a board', () => {
  it('INV-1 a panel member adds at any time and removes only before the baseline', () => {
    expect(canAdjustSelection('luis', board, 'add')).toBe(true);
    expect(canAdjustSelection('luis', board, 'remove')).toBe(true);

    const withBaseline = { ...board, hasBaseline: true };
    expect(canAdjustSelection('luis', withBaseline, 'add')).toBe(true);
    expect(canAdjustSelection('luis', withBaseline, 'remove')).toBe(false);
  });

  it('INV-1 not the owner, and not someone outside the panel', () => {
    expect(canAdjustSelection('ana', board, 'add')).toBe(false);
    expect(canAdjustSelection('organization-administrator', board, 'add')).toBe(false);
  });
});

describe('mandatory panel roles', () => {
  it('names the mandatory roles nobody plays yet for a participant', () => {
    expect(missingPanelRoles(['leader', 'specialist', 'mentor'], board.panel)).toEqual(['specialist']);
    expect(missingPanelRoles(['mentor'], board.panel)).toEqual([]);
  });
});
