import { describe, expect, it } from 'vitest';
import {
  calibrationDifference,
  canCalibrate,
  canRecordInitialLevel,
  missingAttendance,
  missingFromCalibration,
} from './calibration.ts';
import type { BoardAccess } from './program.ts';

const board: BoardAccess = {
  ownerPersonId: 'ana',
  panel: [
    { personId: 'luis', role: 'leader' },
    { personId: 'eva', role: 'mentor' },
  ],
  hasBaseline: false,
};
const calibrated: BoardAccess = { ...board, hasBaseline: true };

describe('who records a calibration', () => {
  it('a panel member, while the board has no baseline; never the owner', () => {
    expect(canCalibrate('luis', board)).toBe(true);
    expect(canCalibrate('eva', board)).toBe(true);
    expect(canCalibrate('ana', board)).toBe(false);
    expect(canCalibrate('someone', board)).toBe(false);
    expect(canCalibrate('luis', calibrated)).toBe(false);
  });
});

describe('INV-3 attendance', () => {
  it('INV-3 needs the participant and a person of each mandatory role of the panel', () => {
    expect(missingAttendance(['ana', 'luis', 'eva'], board, ['leader', 'mentor'])).toEqual({
      participant: false,
      roles: [],
    });
    expect(missingAttendance(['luis'], board, ['leader', 'mentor'])).toEqual({
      participant: true,
      roles: ['mentor'],
    });
  });

  it('INV-3 a role counts only through a panel member who plays it on this board', () => {
    expect(missingAttendance(['ana', 'eva', 'stranger'], board, ['leader'])).toEqual({
      participant: false,
      roles: ['leader'],
    });
    expect(missingAttendance(['ana', 'luis'], board, ['specialist'])).toEqual({
      participant: false,
      roles: ['specialist'],
    });
  });
});

describe('what is missing to calibrate', () => {
  it('names every capability on the board without an agreed level, in board order', () => {
    expect(
      missingFromCalibration(
        ['c1', 'c2', 'c3'],
        [
          { capabilityId: 'c2', levelId: 'l1' },
          { capabilityId: 'other', levelId: 'l1' },
        ],
      ),
    ).toEqual(['c1', 'c3']);
  });
});

describe('difference from the self-assessment', () => {
  const levels = ['l0', 'l1', 'l2', 'l3', 'l4'];

  it('keeps each agreed level beside the proposed one, with the steps between them', () => {
    const difference = calibrationDifference(
      ['c1', 'c2', 'c3'],
      levels,
      [
        { capabilityId: 'c1', levelId: 'l3' },
        { capabilityId: 'c2', levelId: 'l1' },
      ],
      [
        { capabilityId: 'c1', levelId: 'l1' },
        { capabilityId: 'c2', levelId: 'l1' },
        { capabilityId: 'c3', levelId: 'l2' },
      ],
    );

    expect(difference).toEqual([
      { capabilityId: 'c1', selfAssessedLevelId: 'l3', agreedLevelId: 'l1', steps: -2 },
      { capabilityId: 'c2', selfAssessedLevelId: 'l1', agreedLevelId: 'l1', steps: 0 },
      { capabilityId: 'c3', selfAssessedLevelId: null, agreedLevelId: 'l2', steps: null },
    ]);
  });
});

describe('who records the initial level of a capability added after the baseline', () => {
  it('a panel member, once the board has a baseline; never the owner', () => {
    expect(canRecordInitialLevel('eva', calibrated)).toBe(true);
    expect(canRecordInitialLevel('ana', calibrated)).toBe(false);
    expect(canRecordInitialLevel('someone', calibrated)).toBe(false);
    expect(canRecordInitialLevel('eva', board)).toBe(false);
  });
});
