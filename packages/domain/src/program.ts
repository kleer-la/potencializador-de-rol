// Rules of programs, panels and boards. Conceptual base: sections 4.2, 5.1 (invariants 1
// and 9) and 7.

export const PANEL_ROLES = ['leader', 'specialist', 'mentor'] as const;
export type PanelRole = (typeof PANEL_ROLES)[number];

export const ENROLLMENT_ROLES = ['participant', ...PANEL_ROLES] as const;
export type EnrollmentRole = (typeof ENROLLMENT_ROLES)[number];

/**
 * A person of the mentoring firm accompanies participants of a client's program; they
 * never are one (user decision of 2026-11-13).
 */
export function canEnrollAs(person: { isFirmPerson: boolean }, role: EnrollmentRole): boolean {
  return !(person.isFirmPerson && role === 'participant');
}

/** What decides who may see and change one board. */
export type BoardAccess = {
  ownerPersonId: string;
  panel: readonly { personId: string; role: PanelRole }[];
  hasBaseline: boolean;
};

const onPanel = (personId: string, board: BoardAccess) =>
  board.panel.some((member) => member.personId === personId);

/**
 * Invariant 9: a board is seen by its owner and their panel. Administrators, super
 * administrators included, see that it exists and its state, never its content.
 */
export function canSeeBoardContent(personId: string, board: BoardAccess): boolean {
  return personId === board.ownerPersonId || onPanel(personId, board);
}

/**
 * Invariant 1: the panel adds capabilities to a board at any time and removes them only
 * before the baseline is set. The owner proposes; the panel decides.
 */
export function canAdjustSelection(personId: string, board: BoardAccess, change: 'add' | 'remove'): boolean {
  if (!onPanel(personId, board)) return false;
  return change === 'add' || !board.hasBaseline;
}

/** Mandatory panel roles that nobody plays yet for a participant. */
export function missingPanelRoles(
  mandatory: readonly PanelRole[],
  panel: readonly { role: PanelRole }[],
): PanelRole[] {
  return mandatory.filter((role) => !panel.some((member) => member.role === role));
}
