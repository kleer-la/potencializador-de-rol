// Rules of the self-assessment. Conceptual base: sections 5.1 (invariants 2 and 9), 6.2.
import type { BoardAccess } from './program.ts';

/** The owner proposes their own levels, until they submit; nobody proposes for them. */
export function canWriteSelfAssessment(personId: string, board: BoardAccess, submitted: boolean): boolean {
  return personId === board.ownerPersonId && !submitted;
}

/** A draft is the owner's only; once submitted, the panel sees it for the calibration. */
export function canSeeSelfAssessment(personId: string, board: BoardAccess, submitted: boolean): boolean {
  if (personId === board.ownerPersonId) return true;
  return submitted && board.panel.some((member) => member.personId === personId);
}

/** Capabilities on the board, in board order, that have no proposed level yet. */
export function missingFromSelfAssessment(
  capabilityIdsOnBoard: readonly string[],
  entries: readonly { capabilityId: string; levelId: string | null }[],
): string[] {
  const placed = new Set(entries.filter((entry) => entry.levelId !== null).map((entry) => entry.capabilityId));
  return capabilityIdsOnBoard.filter((capabilityId) => !placed.has(capabilityId));
}
