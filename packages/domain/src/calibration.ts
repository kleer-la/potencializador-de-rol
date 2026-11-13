// Rules of the calibration and the baseline. Conceptual base: sections 5.1 (invariants 3,
// 4 and 9), 6.2 step 2.
import { isOnPanel, type BoardAccess, type PanelRole } from './program.ts';
import { missingFromSelfAssessment } from './self-assessment.ts';

type LevelEntry = { capabilityId: string; levelId: string | null };

/** The panel records the calibration with the participant, once: it fixes the baseline. */
export function canCalibrate(personId: string, board: BoardAccess): boolean {
  return isOnPanel(personId, board) && !board.hasBaseline;
}

/**
 * Invariant 3: the baseline is fixed only if the participant and the mandatory roles of
 * the panel attended. A role counts through a person who plays it on this board's panel.
 */
export function missingAttendance(
  attendeePersonIds: readonly string[],
  board: BoardAccess,
  mandatory: readonly PanelRole[],
): { participant: boolean; roles: PanelRole[] } {
  const present = new Set(attendeePersonIds);
  return {
    participant: !present.has(board.ownerPersonId),
    roles: mandatory.filter(
      (role) => !board.panel.some((member) => member.role === role && present.has(member.personId)),
    ),
  };
}

/** Capabilities on the board, in board order, without an agreed level. */
export function missingFromCalibration(capabilityIdsOnBoard: readonly string[], agreed: readonly LevelEntry[]): string[] {
  return missingFromSelfAssessment(capabilityIdsOnBoard, agreed);
}

/**
 * What the calibration keeps: for each capability on the board, the proposed level beside
 * the agreed one and how many steps of the scale lie between them (negative: agreed lower).
 * Without a proposal there is nothing to compare.
 */
export function calibrationDifference(
  capabilityIdsOnBoard: readonly string[],
  levelIdsInOrder: readonly string[],
  selfAssessed: readonly LevelEntry[],
  agreed: readonly LevelEntry[],
): { capabilityId: string; selfAssessedLevelId: string | null; agreedLevelId: string | null; steps: number | null }[] {
  const proposed = new Map(selfAssessed.map((entry) => [entry.capabilityId, entry.levelId]));
  const settled = new Map(agreed.map((entry) => [entry.capabilityId, entry.levelId]));
  const rank = (levelId: string | null) => (levelId === null ? -1 : levelIdsInOrder.indexOf(levelId));
  return capabilityIdsOnBoard.map((capabilityId) => {
    const selfAssessedLevelId = proposed.get(capabilityId) ?? null;
    const agreedLevelId = settled.get(capabilityId) ?? null;
    const from = rank(selfAssessedLevelId);
    const to = rank(agreedLevelId);
    return { capabilityId, selfAssessedLevelId, agreedLevelId, steps: from < 0 || to < 0 ? null : to - from };
  });
}

/**
 * Invariant 3: a capability added after the baseline enters unplaced; a panel member
 * agrees its initial level with the participant.
 */
export function canRecordInitialLevel(personId: string, board: BoardAccess): boolean {
  return isOnPanel(personId, board) && board.hasBaseline;
}
