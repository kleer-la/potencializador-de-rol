import { describe, expect, it } from 'vitest';
import {
  bonusProblems,
  canDecideProposal,
  canProposeChange,
  canRecordEvidence,
  canRecordMentoring,
  isEvidenceLink,
  proposalProblems,
} from './evidence.ts';
import type { BoardAccess } from './program.ts';

const board: BoardAccess = {
  ownerPersonId: 'ana',
  panel: [{ personId: 'eva', role: 'mentor' }],
  hasBaseline: true,
};
const beforeBaseline: BoardAccess = { ...board, hasBaseline: false };

describe('who records, proposes and decides', () => {
  it('owner and panel record evidence after the baseline; nobody else', () => {
    expect(canRecordEvidence('ana', board)).toBe(true);
    expect(canRecordEvidence('eva', board)).toBe(true);
    expect(canRecordEvidence('someone', board)).toBe(false);
    expect(canRecordEvidence('ana', beforeBaseline)).toBe(false);
  });

  it('INV-5 the owner proposes and a panel member decides; never the other way', () => {
    expect(canProposeChange('ana', board)).toBe(true);
    expect(canProposeChange('eva', board)).toBe(false);
    expect(canDecideProposal('eva', board)).toBe(true);
    expect(canDecideProposal('ana', board)).toBe(false);
    expect(canDecideProposal('someone', board)).toBe(false);
    expect(canProposeChange('ana', beforeBaseline)).toBe(false);
  });

  it('a panel member records mentoring sessions', () => {
    expect(canRecordMentoring('eva', board)).toBe(true);
    expect(canRecordMentoring('ana', board)).toBe(false);
  });
});

describe('a level change proposal', () => {
  const plain = { showsTransfer: false };
  const taught = { showsTransfer: true };

  it('INV-4 needs evidence and a level above the current one', () => {
    expect(proposalProblems({ current: 1, target: 2, targetRequiresTransfer: false, evidence: [plain] })).toEqual([]);
    expect(proposalProblems({ current: 1, target: 2, targetRequiresTransfer: false, evidence: [] })).toEqual(['no_evidence']);
    expect(proposalProblems({ current: 2, target: 2, targetRequiresTransfer: false, evidence: [plain] })).toEqual(['not_above']);
    expect(proposalProblems({ current: null, target: 2, targetRequiresTransfer: false, evidence: [plain] })).toEqual(['unplaced']);
  });

  it('INV-6 a level that requires transfer needs evidence of having taught others', () => {
    expect(proposalProblems({ current: 3, target: 4, targetRequiresTransfer: true, evidence: [plain] })).toEqual([
      'no_transfer_evidence',
    ]);
    expect(proposalProblems({ current: 3, target: 4, targetRequiresTransfer: true, evidence: [plain, taught] })).toEqual([]);
  });
});

describe('a bonus proposal', () => {
  it('INV-7 needs evidence and no other open or approved bonus of the same rule', () => {
    expect(bonusProblems({ evidenceCount: 1, alreadyAwarded: false })).toEqual([]);
    expect(bonusProblems({ evidenceCount: 0, alreadyAwarded: true })).toEqual(['no_evidence', 'already_awarded']);
  });
});

describe('evidence link', () => {
  it('is optional and only http or https', () => {
    expect(isEvidenceLink('https://example.test/acta')).toBe(true);
    expect(isEvidenceLink('http://intranet.local/x')).toBe(true);
    expect(isEvidenceLink('javascript:alert(1)')).toBe(false);
    expect(isEvidenceLink('not a url')).toBe(false);
  });
});
