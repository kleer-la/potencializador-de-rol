// Rules of evidence, level changes with evidence, bonuses and mentoring. Conceptual base:
// sections 4.2, 5.1 (invariants 4 to 7 and 9), 6.2 step 5, 6.3, 9.1.
import { canSeeBoardContent, isOnPanel, type BoardAccess } from './program.ts';

export const PROPOSAL_STATES = ['proposed', 'approved', 'rejected'] as const;
export type ProposalState = (typeof PROPOSAL_STATES)[number];

/** Owner and panel record the facts of the board, once it has a baseline. */
export function canRecordEvidence(personId: string, board: BoardAccess): boolean {
  return board.hasBaseline && canSeeBoardContent(personId, board);
}

/** Invariant 5: the participant proposes level changes and bonuses... */
export function canProposeChange(personId: string, board: BoardAccess): boolean {
  return board.hasBaseline && personId === board.ownerPersonId;
}

/** ...and one panel member decides; the participant never approves their own. */
export function canDecideProposal(personId: string, board: BoardAccess): boolean {
  return board.hasBaseline && isOnPanel(personId, board);
}

/** The panel conducts the mentoring sessions. */
export function canRecordMentoring(personId: string, board: BoardAccess): boolean {
  return board.hasBaseline && isOnPanel(personId, board);
}

export type ProposalProblem = 'unplaced' | 'not_above' | 'no_evidence' | 'no_transfer_evidence';

/**
 * What keeps a level change proposal from standing. Invariant 4: it cites evidence.
 * Invariant 6: a level that requires transfer cites evidence of having taught others.
 * A level goes down only in a recalibration, so the proposal aims above the current one.
 */
export function proposalProblems(proposal: {
  current: number | null;
  target: number;
  targetRequiresTransfer: boolean;
  evidence: readonly { showsTransfer: boolean }[];
}): ProposalProblem[] {
  const problems: ProposalProblem[] = [];
  if (proposal.current === null) problems.push('unplaced');
  else if (proposal.target <= proposal.current) problems.push('not_above');
  if (proposal.evidence.length === 0) problems.push('no_evidence');
  else if (proposal.targetRequiresTransfer && !proposal.evidence.some((item) => item.showsTransfer)) {
    problems.push('no_transfer_evidence');
  }
  return problems;
}

export type BonusProblem = 'no_evidence' | 'already_awarded';

/** Invariant 7: a bonus cites evidence, and a rule counts at most once per capability. */
export function bonusProblems(bonus: { evidenceCount: number; alreadyAwarded: boolean }): BonusProblem[] {
  return [...(bonus.evidenceCount === 0 ? ['no_evidence' as const] : []), ...(bonus.alreadyAwarded ? ['already_awarded' as const] : [])];
}

/** An evidence link opens a web page: http or https only. */
export function isEvidenceLink(link: string): boolean {
  try {
    const url = new URL(link);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}
