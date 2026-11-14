import {
  canAdjustSelection,
  bonusProblems,
  canCalibrate,
  canCloseBoard,
  canCloseCycle,
  canDecideProposal,
  canMoveExperiment,
  canProposeChange,
  canRecordEvidence,
  canRecalibrate,
  canRecordMentoring,
  computeScore,
  isEvidenceLink,
  withChanges,
  proposalProblems,
  canPlanCycle,
  canRecordInitialLevel,
  canReviewExperiment,
  canStartCycle,
  EXPERIMENT_RESULTS,
  isValidTarget,
  startBlockers,
  canSeeSelfAssessment,
  isOnPanel,
  missingAttendance,
  missingFromCalibration,
  canWriteSelfAssessment,
  missingFromSelfAssessment,
  type BoardAccess,
  type PanelRole,
} from '@potencializador/domain';
import { and, asc, desc, eq, inArray, ne, sql } from 'drizzle-orm';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { Refusal } from '../maps/map-store.ts';
import { postgresCode, postgresConstraint } from '../infrastructure/postgres-errors.ts';
import {
  baselineEntries,
  boards,
  bonusAwards,
  bonusEvidence,
  bonusRules,
  evidence,
  levelChangeProposals,
  mentoringSessionExperiments,
  mentoringSessions,
  proposalEvidence,
  recalibrationAttendees,
  recalibrationSessions,
  snapshots,
  calibrationAttendees,
  calibrationLevels,
  calibrationSessions,
  capabilities,
  cycles,
  experiments,
  focuses,
  dimensions,
  enrollments,
  levels,
  panelAssignments,
  persons,
  placements,
  programs,
  selfAssessmentLevels,
  selfAssessments,
} from '../infrastructure/schema.ts';
import { withScope, type Database, type ScopedTransaction } from '../infrastructure/scoped-transaction.ts';

const id = z.uuid().toLowerCase();
const boardParams = z.object({ boardId: id });
const capabilityParams = z.object({ boardId: id, capabilityId: id });
const addInput = z.object({ capabilityId: id });
const selfAssessmentInput = z.object({
  levels: z
    .array(z.object({ capabilityId: id, levelId: id }))
    .max(500)
    .refine((levels) => new Set(levels.map((level) => level.capabilityId)).size === levels.length),
});

const levelsInput = z
  .array(z.object({ capabilityId: id, levelId: id }))
  .max(500)
  .refine((levels) => new Set(levels.map((level) => level.capabilityId)).size === levels.length);
const calibrationInput = z.object({
  heldOn: z.iso.date(),
  notes: z.string().max(5000).default(''),
  attendees: z.array(id).max(50),
  levels: levelsInput,
});
const initialLevelInput = z.object({ capabilityId: id, levelId: id });
const cycleParams = z.object({ boardId: id, cycleId: id });
const focusParams = z.object({ boardId: id, cycleId: id, focusId: id });
const experimentParams = z.object({ boardId: id, experimentId: id });
const cycleInput = z
  .object({ startsOn: z.iso.date(), endsOn: z.iso.date() })
  .refine((cycle) => cycle.endsOn >= cycle.startsOn);
const focusInput = z.object({ capabilityId: id, targetLevelId: id });
const experimentInput = z.object({
  description: z.string().trim().min(1).max(2000),
  expectedResult: z.string().trim().max(2000).default(''),
});
const experimentMove = z.discriminatedUnion('state', [
  z.object({ state: z.literal('in_progress') }),
  z.object({ state: z.literal('reviewed'), result: z.enum(EXPERIMENT_RESULTS), learnings: z.string().trim().max(5000).default('') }),
]);

const evidenceInput = z.object({
  description: z.string().trim().min(1).max(2000),
  link: z.string().trim().max(2000).refine(isEvidenceLink).optional(),
  occurredOn: z.iso.date(),
  showsTransfer: z.boolean().default(false),
  experimentId: id.optional(),
});
const evidenceParams = z.object({ boardId: id, evidenceId: id });
const evidenceIds = z.array(id).max(50);
const proposalInput = z.object({ capabilityId: id, levelId: id, evidenceIds });
const bonusInput = z.object({ capabilityId: id, bonusRuleId: id, evidenceIds });
const decisionInput = z.object({ approve: z.boolean(), note: z.string().trim().max(2000).default('') });
const proposalParams = z.object({ boardId: id, proposalId: id });
const bonusParams = z.object({ boardId: id, bonusId: id });
const mentoringInput = z.object({
  heldOn: z.iso.date(),
  notes: z.string().trim().max(5000).default(''),
  experimentIds: z.array(id).max(100),
});

const recalibrationInput = z.object({
  heldOn: z.iso.date(),
  notes: z.string().max(5000).default(''),
  attendees: z.array(id).max(50),
  levels: z
    .array(z.object({ capabilityId: id, levelId: id }))
    .max(500)
    .refine((levels) => new Set(levels.map((level) => level.capabilityId)).size === levels.length),
});

const NOT_FOUND = { error: 'not_found' } as const;

type BoardRow = {
  board_id: string;
  organization_id: string;
  organization_name: string;
  program_id: string;
  program_name: string;
  owner_name: string;
  status: string;
  relation: 'owner' | 'panel';
  panel_roles: PanelRole[];
};

/**
 * Boards, seen by their owner and their panel only (invariant 9). Not under an
 * organization: a participant may hold no organization role and a Kleer mentor belongs to
 * none. The database tells which organization a board belongs to, and only to its owner
 * or panel; anyone else gets the same 404 as for a board that does not exist.
 */
export async function registerBoards(api: FastifyInstance, options: { database: Database }): Promise<void> {
  const db = options.database;

  /** The board, with the viewer's relation to it, inside its organization's scope. */
  const openBoard = async <T>(
    request: FastifyRequest,
    reply: FastifyReply,
    boardId: string,
    work: (tx: ScopedTransaction, board: { access: BoardAccess; personId: string; row: typeof boards.$inferSelect }) => Promise<T>,
  ): Promise<T | null> => {
    const personId = request.personId;
    if (personId === null) {
      await reply.code(401).send({ error: 'not_signed_in' });
      return null;
    }
    const organizationId = await withScope(db, { personId, organizationId: null }, async (tx) => {
      const found = await tx.execute<{ id: string | null }>(sql`select app_board_organization(${boardId}::uuid) as id`);
      return found.rows[0]?.id ?? null;
    });
    if (organizationId === null) {
      await reply.code(404).send(NOT_FOUND);
      return null;
    }
    return withScope(db, { personId, organizationId }, async (tx) => {
      const [row] = await tx.select().from(boards).where(eq(boards.id, boardId));
      if (row === undefined) throw new Refusal(404, NOT_FOUND);
      // A closed board is read-only for everyone (migration 0009 refuses it as well).
      if (request.method !== 'GET' && row.status === 'closed') throw new Refusal(409, { error: 'board_closed' });
      const panel = await tx
        .select({ personId: enrollments.personId, role: panelAssignments.role })
        .from(panelAssignments)
        .innerJoin(enrollments, eq(enrollments.id, panelAssignments.memberEnrollmentId))
        .where(eq(panelAssignments.participantEnrollmentId, row.enrollmentId));
      const access: BoardAccess = { ownerPersonId: row.ownerPersonId, panel, hasBaseline: row.baselineSetAt !== null };
      return work(tx, { access, personId, row });
    });
  };

  /** The board's self-assessment as the viewer may see it (Row Level Security agrees). */
  const readSelfAssessment = async (tx: ScopedTransaction, boardId: string) => {
    const [row] = await tx.select().from(selfAssessments).where(eq(selfAssessments.boardId, boardId));
    if (row === undefined) return null;
    const levelRows = await tx
      .select({ capabilityId: selfAssessmentLevels.capabilityId, levelId: selfAssessmentLevels.levelId })
      .from(selfAssessmentLevels)
      .where(eq(selfAssessmentLevels.selfAssessmentId, row.id));
    return { row, levels: levelRows };
  };

  /** The board's calibration with its attendees and levels, or null before it. */
  const readCalibration = async (
    tx: ScopedTransaction,
    boardId: string,
    byMapOrder: <T extends { capabilityId: string }>(entries: T[]) => T[],
  ) => {
    const [session] = await tx.select().from(calibrationSessions).where(eq(calibrationSessions.boardId, boardId));
    if (session === undefined) return null;
    const attendees = await tx
      .select({ personId: calibrationAttendees.personId, name: persons.name })
      .from(calibrationAttendees)
      .innerJoin(persons, eq(persons.id, calibrationAttendees.personId))
      .where(eq(calibrationAttendees.calibrationSessionId, session.id))
      .orderBy(asc(persons.name));
    const levelRows = await tx
      .select({
        capabilityId: calibrationLevels.capabilityId,
        selfAssessedLevelId: calibrationLevels.selfAssessedLevelId,
        agreedLevelId: calibrationLevels.agreedLevelId,
      })
      .from(calibrationLevels)
      .where(eq(calibrationLevels.calibrationSessionId, session.id));
    return { heldOn: session.heldOn, notes: session.notes, attendees, levels: byMapOrder(levelRows) };
  };

  /** The board's cycle that is not closed, with focuses (map order) and experiments (oldest first). */
  const readOpenCycle = async (
    tx: ScopedTransaction,
    boardId: string,
    maxFocuses: number,
    byMapOrder: <T extends { capabilityId: string }>(entries: T[]) => T[],
  ) => {
    const [cycle] = await tx
      .select()
      .from(cycles)
      .where(and(eq(cycles.boardId, boardId), ne(cycles.state, 'closed')))
      .orderBy(desc(cycles.number))
      .limit(1);
    if (cycle === undefined) return null;
    const focusRows = await tx
      .select({ id: focuses.id, capabilityId: focuses.capabilityId, targetLevelId: focuses.targetLevelId })
      .from(focuses)
      .where(eq(focuses.cycleId, cycle.id));
    const experimentRows =
      focusRows.length === 0
        ? []
        : await tx
            .select({
              id: experiments.id,
              focusId: experiments.focusId,
              description: experiments.description,
              expectedResult: experiments.expectedResult,
              state: experiments.state,
              result: experiments.result,
              learnings: experiments.learnings,
              reviewedAt: experiments.reviewedAt,
            })
            .from(experiments)
            .where(inArray(experiments.focusId, focusRows.map((focus) => focus.id)))
            .orderBy(asc(experiments.createdAt), asc(experiments.id));
    return {
      id: cycle.id,
      number: cycle.number,
      startsOn: cycle.startsOn,
      endsOn: cycle.endsOn,
      state: cycle.state,
      startedAt: cycle.startedAt,
      maxFocuses,
      focuses: byMapOrder(focusRows).map((focus) => ({
        ...focus,
        experiments: experimentRows
          .filter((experiment) => experiment.focusId === focus.id)
          .map(({ focusId: _focusId, ...experiment }) => experiment),
      })),
    };
  };

  /** Evidence, level change proposals, bonuses with the map's rules, and mentoring sessions. */
  const readEvidenceAndDecisions = async (tx: ScopedTransaction, boardId: string, mapId: string) => {
    const facts = await tx
      .select({
        id: evidence.id,
        description: evidence.description,
        link: evidence.link,
        occurredOn: evidence.occurredOn,
        showsTransfer: evidence.showsTransfer,
        experimentId: evidence.experimentId,
        authorId: evidence.author,
        authorName: persons.name,
      })
      .from(evidence)
      .innerJoin(persons, eq(persons.id, evidence.author))
      .where(eq(evidence.boardId, boardId))
      .orderBy(desc(evidence.occurredOn), desc(evidence.createdAt));
    const citedByProposal = await tx
      .select({ ownerId: proposalEvidence.proposalId, evidenceId: proposalEvidence.evidenceId })
      .from(proposalEvidence)
      .where(eq(proposalEvidence.boardId, boardId));
    const citedByBonus = await tx
      .select({ ownerId: bonusEvidence.bonusAwardId, evidenceId: bonusEvidence.evidenceId })
      .from(bonusEvidence)
      .where(eq(bonusEvidence.boardId, boardId));
    const cited = (rows: { ownerId: string; evidenceId: string }[], ownerId: string) =>
      rows.filter((row) => row.ownerId === ownerId).map((row) => row.evidenceId);
    const proposals = await tx
      .select({
        id: levelChangeProposals.id,
        capabilityId: placements.capabilityId,
        proposedLevelId: levelChangeProposals.proposedLevelId,
        state: levelChangeProposals.state,
        proposedAt: levelChangeProposals.proposedAt,
        decidedAt: levelChangeProposals.decidedAt,
        decisionNote: levelChangeProposals.decisionNote,
      })
      .from(levelChangeProposals)
      .innerJoin(placements, eq(placements.id, levelChangeProposals.placementId))
      .where(eq(levelChangeProposals.boardId, boardId))
      .orderBy(desc(levelChangeProposals.proposedAt));
    const bonuses = await tx
      .select({
        id: bonusAwards.id,
        capabilityId: placements.capabilityId,
        bonusRuleId: bonusAwards.bonusRuleId,
        state: bonusAwards.state,
        proposedAt: bonusAwards.proposedAt,
        decidedAt: bonusAwards.decidedAt,
        decisionNote: bonusAwards.decisionNote,
      })
      .from(bonusAwards)
      .innerJoin(placements, eq(placements.id, bonusAwards.placementId))
      .where(eq(bonusAwards.boardId, boardId))
      .orderBy(desc(bonusAwards.proposedAt));
    const rules = await tx
      .select({ id: bonusRules.id, name: bonusRules.name, extraPoints: bonusRules.extraPoints, condition: bonusRules.condition })
      .from(bonusRules)
      .where(eq(bonusRules.mapId, mapId))
      .orderBy(asc(bonusRules.name));
    const sessionRows = await tx
      .select({ id: mentoringSessions.id, heldOn: mentoringSessions.heldOn, notes: mentoringSessions.notes, recordedByName: persons.name })
      .from(mentoringSessions)
      .innerJoin(persons, eq(persons.id, mentoringSessions.recordedBy))
      .where(eq(mentoringSessions.boardId, boardId))
      .orderBy(desc(mentoringSessions.heldOn), desc(mentoringSessions.recordedAt));
    const reviewed = await tx
      .select({ sessionId: mentoringSessionExperiments.mentoringSessionId, experimentId: mentoringSessionExperiments.experimentId })
      .from(mentoringSessionExperiments)
      .where(eq(mentoringSessionExperiments.boardId, boardId));
    return {
      evidence: facts,
      proposals: proposals.map((proposal) => ({ ...proposal, evidenceIds: cited(citedByProposal, proposal.id) })),
      bonuses: bonuses.map((bonus) => ({ ...bonus, evidenceIds: cited(citedByBonus, bonus.id) })),
      bonusRules: rules.map((rule) => ({ ...rule, extraPoints: Number(rule.extraPoints) })),
      mentoringSessions: sessionRows.map((session) => ({
        ...session,
        experimentIds: reviewed.filter((row) => row.sessionId === session.id).map((row) => row.experimentId),
      })),
    };
  };

  /** Evidence of this board among the given ids; a 400 when any is not of the board. */
  const boardEvidence = async (tx: ScopedTransaction, boardId: string, ids: string[]) => {
    const unique = [...new Set(ids)];
    const rows =
      unique.length === 0
        ? []
        : await tx
            .select({ id: evidence.id, showsTransfer: evidence.showsTransfer })
            .from(evidence)
            .where(and(eq(evidence.boardId, boardId), inArray(evidence.id, unique)));
    if (rows.length !== unique.length) throw new Refusal(400, { error: 'unknown_reference' });
    return rows;
  };

  /** Today's score with its breakdowns, its evolution from the baseline, and the recalibrations. */
  const readProgress = async (tx: ScopedTransaction, boardId: string, baselineSetAt: Date, topMultiplier: number) => {
    const placedRows = await tx
      .select({
        placementId: placements.id,
        capabilityId: placements.capabilityId,
        dimensionId: capabilities.dimensionId,
        difficulty: capabilities.difficulty,
        multiplier: levels.multiplier,
      })
      .from(placements)
      .innerJoin(capabilities, eq(capabilities.id, placements.capabilityId))
      .innerJoin(dimensions, eq(dimensions.id, capabilities.dimensionId))
      .leftJoin(levels, eq(levels.id, placements.levelId))
      .where(eq(placements.boardId, boardId))
      .orderBy(asc(dimensions.position), asc(capabilities.position));
    const approved = await tx
      .select({ placementId: bonusAwards.placementId, points: sql<string>`sum(${bonusRules.extraPoints})` })
      .from(bonusAwards)
      .innerJoin(bonusRules, eq(bonusRules.id, bonusAwards.bonusRuleId))
      .where(and(eq(bonusAwards.boardId, boardId), eq(bonusAwards.state, 'approved')))
      .groupBy(bonusAwards.placementId);
    const bonusOf = new Map(approved.map((row) => [row.placementId, Number(row.points)]));
    const score = computeScore(
      placedRows.map((row) => ({
        capabilityId: row.capabilityId,
        dimensionId: row.dimensionId,
        difficulty: row.difficulty,
        multiplier: row.multiplier === null ? null : Number(row.multiplier),
        bonusPoints: bonusOf.get(row.placementId) ?? 0,
      })),
      topMultiplier,
    );
    // The baseline counts its entries, each capability added later with its initial level;
    // no bonus exists before it.
    const [baseline] = await tx
      .select({ total: sql<string>`coalesce(sum(${levels.multiplier}), 0)`, count: sql<number>`count(*)::int` })
      .from(baselineEntries)
      .innerJoin(levels, eq(levels.id, baselineEntries.levelId))
      .where(eq(baselineEntries.boardId, boardId));
    const taken = await tx
      .select({ kind: snapshots.kind, takenAt: snapshots.takenAt, score: snapshots.score, count: snapshots.capabilityCount })
      .from(snapshots)
      .where(eq(snapshots.boardId, boardId))
      .orderBy(asc(snapshots.takenAt));
    const point = (kind: string, date: Date | string, total: number, count: number) => ({
      kind,
      date,
      total,
      capabilities: count,
      maximum: count * topMultiplier,
    });
    const evolution = withChanges([
      point('baseline', baselineSetAt, Number(baseline?.total ?? 0), baseline?.count ?? 0),
      ...taken.map((snapshot) => point(snapshot.kind, snapshot.takenAt, Number(snapshot.score), snapshot.count)),
      point('today', new Date(), score.total, score.capabilities),
    ]);
    const sessions = await tx
      .select({ id: recalibrationSessions.id, heldOn: recalibrationSessions.heldOn, notes: recalibrationSessions.notes })
      .from(recalibrationSessions)
      .where(eq(recalibrationSessions.boardId, boardId))
      .orderBy(asc(recalibrationSessions.recordedAt));
    const attendees = await tx
      .select({ sessionId: recalibrationAttendees.recalibrationSessionId, personId: recalibrationAttendees.personId, name: persons.name })
      .from(recalibrationAttendees)
      .innerJoin(persons, eq(persons.id, recalibrationAttendees.personId))
      .where(eq(recalibrationAttendees.boardId, boardId));
    return {
      score,
      evolution,
      recalibrations: sessions.map((session) => ({
        ...session,
        attendees: attendees
          .filter((attendee) => attendee.sessionId === session.id)
          .map(({ personId, name }) => ({ personId, name })),
      })),
    };
  };

  /** A cycle of this board, or a 404 as for anything not on it. */
  const cycleOfBoard = async (tx: ScopedTransaction, boardId: string, cycleId: string) => {
    const [cycle] = await tx
      .select()
      .from(cycles)
      .where(and(eq(cycles.id, cycleId), eq(cycles.boardId, boardId)));
    if (cycle === undefined) throw new Refusal(404, NOT_FOUND);
    return cycle;
  };

  /** Invariant 8 as the API sees it: what keeps a planned cycle from starting. */
  const blockersOf = async (tx: ScopedTransaction, cycleId: string, maxFocuses: number) => {
    const counted = await tx
      .select({ capabilityId: focuses.capabilityId, experiments: sql<number>`count(${experiments.id})::int` })
      .from(focuses)
      .leftJoin(experiments, eq(experiments.focusId, focuses.id))
      .where(eq(focuses.cycleId, cycleId))
      .groupBy(focuses.id, focuses.capabilityId);
    return startBlockers(counted, maxFocuses);
  };

  /**
   * Serializes the owner's own writes to one board's self-assessment (two first saves at
   * once would both try to create it). A transaction-level advisory lock: boards are not
   * row-locked because the owner may not update them.
   */
  const lockSelfAssessment = (tx: ScopedTransaction, boardId: string) =>
    tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`self-assessment:${boardId}`}, 0))`);

  /** The refusals shared by saving and submitting, in order. */
  const requireOpenDraft = (
    personId: string,
    access: BoardAccess,
    status: string,
    submitted: boolean,
  ) => {
    if (personId !== access.ownerPersonId) throw new Refusal(403, { error: 'forbidden' });
    if (submitted) throw new Refusal(409, { error: 'already_submitted' });
    if (status !== 'not_started') throw new Refusal(409, { error: 'board_not_open' });
  };

  /** Capability ids on the board, in the map's order. */
  const capabilitiesOnBoard = async (tx: ScopedTransaction, boardId: string) =>
    (
      await tx
        .select({ id: placements.capabilityId })
        .from(placements)
        .innerJoin(capabilities, eq(capabilities.id, placements.capabilityId))
        .innerJoin(dimensions, eq(dimensions.id, capabilities.dimensionId))
        .where(eq(placements.boardId, boardId))
        .orderBy(asc(dimensions.position), asc(capabilities.position))
    ).map((row) => row.id);

  const answer = async (reply: FastifyReply, run: () => Promise<{ status?: number; body?: unknown } | null>) => {
    try {
      const result = await run();
      if (result === null) return reply;
      reply.code(result.status ?? 200);
      return result.body === undefined ? reply.send() : reply.send(result.body);
    } catch (error) {
      if (error instanceof Refusal) return reply.code(error.status).send(error.body);
      throw error;
    }
  };

  api.get('/boards', async (request, reply) => {
    const personId = request.personId;
    if (personId === null) return reply.code(401).send({ error: 'not_signed_in' });
    const rows = await withScope(db, { personId, organizationId: null }, async (tx) =>
      (await tx.execute<BoardRow>(sql`select * from app_my_boards()`)).rows,
    );
    const summary = (row: BoardRow) => ({
      id: row.board_id,
      organizationId: row.organization_id,
      organizationName: row.organization_name,
      programId: row.program_id,
      programName: row.program_name,
      ownerName: row.owner_name,
      status: row.status,
      panelRoles: row.panel_roles,
    });
    return {
      mine: rows.filter((row) => row.relation === 'owner').map(summary),
      accompanied: rows.filter((row) => row.relation === 'panel').map(summary),
    };
  });

  api.get('/boards/:boardId', async (request, reply) => {
    const params = boardParams.safeParse(request.params);
    if (!params.success) return reply.code(400).send({ error: 'invalid_request' });
    return answer(reply, () =>
      openBoard(request, reply, params.data.boardId, async (tx, { access, personId, row }) => {
        const [program] = await tx
          .select({
            id: programs.id,
            name: programs.name,
            mapId: programs.mapId,
            mandatoryPanelRoles: programs.mandatoryPanelRoles,
            maxFocuses: programs.maxFocuses,
          })
          .from(programs)
          .where(eq(programs.id, row.programId));
        const [owner] = await tx.select({ name: persons.name }).from(persons).where(eq(persons.id, row.ownerPersonId));
        const scale = await tx
          .select({
            id: levels.id,
            position: levels.position,
            name: levels.name,
            multiplier: levels.multiplier,
            requiresTransfer: levels.requiresTransfer,
          })
          .from(levels)
          .where(eq(levels.mapId, program!.mapId))
          .orderBy(asc(levels.position));
        const dimensionRows = await tx
          .select({ id: dimensions.id, name: dimensions.name, kind: dimensions.kind, position: dimensions.position })
          .from(dimensions)
          .where(eq(dimensions.mapId, program!.mapId))
          .orderBy(asc(dimensions.position));
        const capabilityRows = await tx
          .select({
            id: capabilities.id,
            dimensionId: capabilities.dimensionId,
            statement: capabilities.statement,
            difficulty: capabilities.difficulty,
            position: capabilities.position,
          })
          .from(capabilities)
          .innerJoin(dimensions, eq(dimensions.id, capabilities.dimensionId))
          .where(eq(dimensions.mapId, program!.mapId))
          .orderBy(asc(dimensions.position), asc(capabilities.position));
        const placed = await tx
          .select({ capabilityId: placements.capabilityId, levelId: placements.levelId, addedAt: placements.addedAt })
          .from(placements)
          .where(eq(placements.boardId, row.id));
        const assessment = await readSelfAssessment(tx, row.id);
        const submitted = assessment?.row.submittedAt != null;
        const order = new Map(capabilityRows.map((capability, index) => [capability.id, index]));
        const byMapOrder = <T extends { capabilityId: string }>(entries: T[]) =>
          entries.sort((a, b) => (order.get(a.capabilityId) ?? 0) - (order.get(b.capabilityId) ?? 0));
        const panel = await tx
          .select({ personId: enrollments.personId, name: persons.name, role: panelAssignments.role })
          .from(panelAssignments)
          .innerJoin(enrollments, eq(enrollments.id, panelAssignments.memberEnrollmentId))
          .innerJoin(persons, eq(persons.id, enrollments.personId))
          .where(eq(panelAssignments.participantEnrollmentId, row.enrollmentId))
          .orderBy(asc(panelAssignments.role), asc(persons.name));
        const calibration = await readCalibration(tx, row.id, byMapOrder);
        const cycle = await readOpenCycle(tx, row.id, program!.maxFocuses, byMapOrder);
        const history = await readEvidenceAndDecisions(tx, row.id, program!.mapId);
        const topMultiplier = Math.max(0, ...scale.map((level) => Number(level.multiplier)));
        const progress =
          row.baselineSetAt === null
            ? { score: null, evolution: [], recalibrations: [] }
            : await readProgress(tx, row.id, row.baselineSetAt, topMultiplier);
        const baseline =
          row.baselineSetAt === null
            ? null
            : {
                setAt: row.baselineSetAt,
                entries: (
                  await tx
                    .select({
                      capabilityId: baselineEntries.capabilityId,
                      levelId: baselineEntries.levelId,
                      origin: baselineEntries.origin,
                      setAt: baselineEntries.setAt,
                    })
                    .from(baselineEntries)
                    .where(eq(baselineEntries.boardId, row.id))
                ).sort(
                  (a, b) =>
                    a.setAt.getTime() - b.setAt.getTime() || (order.get(a.capabilityId) ?? 0) - (order.get(b.capabilityId) ?? 0),
                ),
              };
        const selfAssessment = !canSeeSelfAssessment(personId, access, submitted)
          ? null
          : {
              submittedAt: assessment?.row.submittedAt ?? null,
              levels: (assessment?.levels ?? []).sort(
                (a, b) => (order.get(a.capabilityId) ?? 0) - (order.get(b.capabilityId) ?? 0),
              ),
            };

        return {
          body: {
            id: row.id,
            organizationId: row.organizationId,
            program: { id: program!.id, name: program!.name, mandatoryPanelRoles: program!.mandatoryPanelRoles },
            ownerName: owner?.name ?? '',
            owner: { personId: row.ownerPersonId, name: owner?.name ?? '' },
            panel,
            status: row.status,
            hasBaseline: access.hasBaseline,
            viewer: readOnlyWhenClosed(row.status, {
              isOwner: personId === access.ownerPersonId,
              panelRoles: access.panel.filter((member) => member.personId === personId).map((member) => member.role).sort(),
              canAdd: canAdjustSelection(personId, access, 'add'),
              canRemove: canAdjustSelection(personId, access, 'remove'),
              canSelfAssess: canWriteSelfAssessment(personId, access, submitted) && row.status === 'not_started',
              canCalibrate: canCalibrate(personId, access, row.status),
              canRecordInitialLevel: canRecordInitialLevel(personId, access),
              canPlanCycle: canPlanCycle(personId, access),
              canStartCycle: canStartCycle(personId, access),
              canReviewExperiments: canReviewExperiment(personId, access),
              canRecordEvidence: canRecordEvidence(personId, access),
              canProposeChanges: canProposeChange(personId, access),
              canDecideProposals: canDecideProposal(personId, access),
              canRecordMentoring: canRecordMentoring(personId, access),
              canCloseCycle: cycle !== null && canCloseCycle(personId, access, cycle.state),
              canRecalibrate: canRecalibrate(personId, access, row.status),
              canCloseBoard: canCloseBoard(personId, access, row.status) && (cycle === null || cycle.state === 'closed'),
            }),
            levels: scale.map((level) => ({ ...level, multiplier: Number(level.multiplier) })),
            dimensions: dimensionRows,
            capabilities: capabilityRows,
            placements: placed,
            // A proposal of the owner, never the baseline and never a score (invariant 2).
            selfAssessment,
            // What the panel and the participant agreed, beside what was self-assessed.
            calibration,
            // Invariant 3: the agreed snapshot; its entries never change, later ones are added.
            baseline,
            // The cycle that is not closed yet, with its focuses and experiments; null if none.
            cycle,
            // Facts of the board and what was proposed and decided with them (invariants 4 to 7).
            ...history,
            // The maturity score of this board only: no list or program view carries it (invariant 9).
            ...progress,
          },
        };
      }),
    );
  });

  api.post('/boards/:boardId/capabilities', async (request, reply) => {
    const params = boardParams.safeParse(request.params);
    const body = addInput.safeParse(request.body);
    if (!params.success || !body.success) return reply.code(400).send({ error: 'invalid_request' });
    return answer(reply, () =>
      openBoard(request, reply, params.data.boardId, async (tx, { access, personId, row }) => {
        if (!canAdjustSelection(personId, access, 'add')) throw new Refusal(403, { error: 'forbidden' });
        try {
          await tx
            .insert(placements)
            .values({ organizationId: row.organizationId, boardId: row.id, capabilityId: body.data.capabilityId, addedBy: personId });
        } catch (error) {
          if (postgresConstraint(error) === 'placements_one_per_capability') {
            throw new Refusal(409, { error: 'already_on_board' });
          }
          if (['PM001', '23503'].includes(postgresCode(error) ?? '')) {
            throw new Refusal(400, { error: 'unknown_reference' });
          }
          throw error;
        }
        return { status: 201, body: { capabilityId: body.data.capabilityId } };
      }),
    );
  });

  api.delete('/boards/:boardId/capabilities/:capabilityId', async (request, reply) => {
    const params = capabilityParams.safeParse(request.params);
    if (!params.success) return reply.code(400).send({ error: 'invalid_request' });
    return answer(reply, () =>
      openBoard(request, reply, params.data.boardId, async (tx, { access, personId, row }) => {
        if (!canAdjustSelection(personId, access, 'add')) throw new Refusal(403, { error: 'forbidden' });
        if (!canAdjustSelection(personId, access, 'remove')) throw new Refusal(409, { error: 'baseline_set' });
        let removed;
        try {
          removed = await tx
            .delete(placements)
            .where(and(eq(placements.boardId, row.id), eq(placements.capabilityId, params.data.capabilityId)))
            .returning({ id: placements.id });
        } catch (error) {
          if (postgresCode(error) === 'PM001') throw new Refusal(409, { error: 'baseline_set' });
          throw error;
        }
        if (removed.length === 0) throw new Refusal(404, NOT_FOUND);
        return { status: 204 };
      }),
    );
  });

  api.put('/boards/:boardId/self-assessment', async (request, reply) => {
    const params = boardParams.safeParse(request.params);
    const body = selfAssessmentInput.safeParse(request.body);
    if (!params.success || !body.success) return reply.code(400).send({ error: 'invalid_request' });
    return answer(reply, () =>
      openBoard(request, reply, params.data.boardId, async (tx, { access, personId, row }) => {
        if (personId !== access.ownerPersonId) throw new Refusal(403, { error: 'forbidden' });
        await lockSelfAssessment(tx, row.id);
        let assessment = (await readSelfAssessment(tx, row.id))?.row;
        requireOpenDraft(personId, access, row.status, assessment?.submittedAt != null);
        if (assessment === undefined) {
          [assessment] = await tx
            .insert(selfAssessments)
            .values({ organizationId: row.organizationId, boardId: row.id })
            .returning();
        }
        const selfAssessmentId = assessment!.id;
        await tx.delete(selfAssessmentLevels).where(eq(selfAssessmentLevels.selfAssessmentId, selfAssessmentId));
        if (body.data.levels.length > 0) {
          try {
            await tx.insert(selfAssessmentLevels).values(
              body.data.levels.map((level) => ({ organizationId: row.organizationId, selfAssessmentId, ...level })),
            );
          } catch (error) {
            if (['PM002', '23503'].includes(postgresCode(error) ?? '')) {
              throw new Refusal(400, { error: 'unknown_reference' });
            }
            throw error;
          }
        }
        return { body: { levels: body.data.levels } };
      }),
    );
  });

  api.post('/boards/:boardId/self-assessment/submit', async (request, reply) => {
    const params = boardParams.safeParse(request.params);
    if (!params.success) return reply.code(400).send({ error: 'invalid_request' });
    return answer(reply, () =>
      openBoard(request, reply, params.data.boardId, async (tx, { access, personId, row }) => {
        if (personId !== access.ownerPersonId) throw new Refusal(403, { error: 'forbidden' });
        await lockSelfAssessment(tx, row.id);
        const assessment = await readSelfAssessment(tx, row.id);
        requireOpenDraft(personId, access, row.status, assessment?.row.submittedAt != null);
        const onBoard = await capabilitiesOnBoard(tx, row.id);
        // A board without capabilities has nothing to self-assess; submitting it would only move its state.
        if (onBoard.length === 0) throw new Refusal(422, { error: 'empty_board' });
        const missing = missingFromSelfAssessment(onBoard, assessment?.levels ?? []);
        if (missing.length > 0) throw new Refusal(422, { error: 'incomplete', missing });
        const submitted = await tx.execute<{ submitted_at: string }>(
          sql`select app_submit_self_assessment(${row.id}::uuid) as submitted_at`,
        );
        return { body: { submittedAt: submitted.rows[0]!.submitted_at } };
      }),
    );
  });

  api.post('/boards/:boardId/calibration', async (request, reply) => {
    const params = boardParams.safeParse(request.params);
    const body = calibrationInput.safeParse(request.body);
    if (!params.success || !body.success) return reply.code(400).send({ error: 'invalid_request' });
    return answer(reply, () =>
      openBoard(request, reply, params.data.boardId, async (tx, { access, personId, row }) => {
        if (!isOnPanel(personId, access)) throw new Refusal(403, { error: 'forbidden' });
        if (access.hasBaseline) throw new Refusal(409, { error: 'baseline_set' });
        if (row.status !== 'self_assessed') throw new Refusal(409, { error: 'not_self_assessed' });
        const { attendees, levels: agreed } = body.data;
        const onBoard = new Set([access.ownerPersonId, ...access.panel.map((member) => member.personId)]);
        if (attendees.some((attendee) => !onBoard.has(attendee))) throw new Refusal(400, { error: 'unknown_reference' });
        const [program] = await tx
          .select({ mandatoryPanelRoles: programs.mandatoryPanelRoles })
          .from(programs)
          .where(eq(programs.id, row.programId));
        const absent = missingAttendance(attendees, access, program!.mandatoryPanelRoles);
        if (absent.participant || absent.roles.length > 0) {
          throw new Refusal(422, { error: 'attendance', participantMissing: absent.participant, missingRoles: absent.roles });
        }
        const missing = missingFromCalibration(await capabilitiesOnBoard(tx, row.id), agreed);
        if (missing.length > 0) throw new Refusal(422, { error: 'incomplete', missing });
        try {
          // Ids are validated UUIDs, so the array literal holds nothing but them.
          const recorded = await tx.execute<{ id: string }>(
            sql`select app_calibrate_board(${row.id}::uuid, ${body.data.heldOn}::date, ${body.data.notes},
                  ${`{${attendees.join(',')}}`}::uuid[], ${JSON.stringify(agreed)}::jsonb) as id`,
          );
          return { status: 201, body: { calibrationId: recorded.rows[0]!.id } };
        } catch (error) {
          if (postgresCode(error) === '23514') throw new Refusal(400, { error: 'unknown_reference' });
          // The database repeats the checks above under a lock; a refusal here means the board
          // or its panel changed in between.
          if (postgresCode(error) === 'PM003') throw new Refusal(409, { error: 'baseline_set' });
          if (postgresCode(error) === 'PM032') throw new Refusal(409, { error: 'not_self_assessed' });
          // The attendance passed above, so the panel changed meanwhile: what is missing is unknown here.
          if (postgresCode(error) === 'PM031') throw new Refusal(409, { error: 'panel_changed' });
          throw error;
        }
      }),
    );
  });

  api.post('/boards/:boardId/initial-levels', async (request, reply) => {
    const params = boardParams.safeParse(request.params);
    const body = initialLevelInput.safeParse(request.body);
    if (!params.success || !body.success) return reply.code(400).send({ error: 'invalid_request' });
    return answer(reply, () =>
      openBoard(request, reply, params.data.boardId, async (tx, { access, personId, row }) => {
        if (!isOnPanel(personId, access)) throw new Refusal(403, { error: 'forbidden' });
        if (!canRecordInitialLevel(personId, access)) throw new Refusal(409, { error: 'no_baseline' });
        if (!(await capabilitiesOnBoard(tx, row.id)).includes(body.data.capabilityId)) throw new Refusal(404, NOT_FOUND);
        try {
          const recorded = await tx.execute<{ id: string }>(
            sql`select app_record_initial_level(${row.id}::uuid, ${body.data.capabilityId}::uuid, ${body.data.levelId}::uuid) as id`,
          );
          return { status: 201, body: { levelChangeId: recorded.rows[0]!.id } };
        } catch (error) {
          if (postgresCode(error) === 'PM003') throw new Refusal(409, { error: 'already_leveled' });
          if (postgresCode(error) === '23514') throw new Refusal(400, { error: 'unknown_reference' });
          throw error;
        }
      }),
    );
  });

  const programOf = async (tx: ScopedTransaction, programId: string) =>
    (await tx.select({ maxFocuses: programs.maxFocuses, mapId: programs.mapId }).from(programs).where(eq(programs.id, programId)))[0]!;

  api.post('/boards/:boardId/cycles', async (request, reply) => {
    const params = boardParams.safeParse(request.params);
    const body = cycleInput.safeParse(request.body);
    if (!params.success || !body.success) return reply.code(400).send({ error: 'invalid_request' });
    return answer(reply, () =>
      openBoard(request, reply, params.data.boardId, async (tx, { access, personId, row }) => {
        if (!access.hasBaseline) throw new Refusal(409, { error: 'no_baseline' });
        if (!canPlanCycle(personId, access)) throw new Refusal(403, { error: 'forbidden' });
        try {
          const [created] = await tx
            .insert(cycles)
            .values({ organizationId: row.organizationId, boardId: row.id, ...body.data, createdBy: personId })
            .returning({ id: cycles.id });
          return { status: 201, body: { cycleId: created!.id } };
        } catch (error) {
          if (postgresConstraint(error) === 'cycles_one_open_per_board') throw new Refusal(409, { error: 'cycle_open' });
          if (postgresCode(error) === 'PM050') throw new Refusal(409, { error: 'board_closed' });
          throw error;
        }
      }),
    );
  });

  api.post('/boards/:boardId/cycles/:cycleId/focuses', async (request, reply) => {
    const params = cycleParams.safeParse(request.params);
    const body = focusInput.safeParse(request.body);
    if (!params.success || !body.success) return reply.code(400).send({ error: 'invalid_request' });
    return answer(reply, () =>
      openBoard(request, reply, params.data.boardId, async (tx, { access, personId, row }) => {
        if (!canPlanCycle(personId, access)) throw new Refusal(403, { error: 'forbidden' });
        const cycle = await cycleOfBoard(tx, row.id, params.data.cycleId);
        if (cycle.state !== 'planned') throw new Refusal(409, { error: 'cycle_not_planned' });
        const program = await programOf(tx, row.programId);
        const [current] = await tx
          .select({ position: levels.position })
          .from(placements)
          .leftJoin(levels, eq(levels.id, placements.levelId))
          .where(and(eq(placements.boardId, row.id), eq(placements.capabilityId, body.data.capabilityId)));
        const [target] = await tx
          .select({ position: levels.position })
          .from(levels)
          .where(and(eq(levels.id, body.data.targetLevelId), eq(levels.mapId, program.mapId)));
        if (current === undefined || target === undefined || !isValidTarget(current.position, target.position)) {
          throw new Refusal(422, { error: 'invalid_target' });
        }
        // Checked before the maximum, so a repeated focus on a full cycle is named as such.
        const [repeated] = await tx
          .select({ id: focuses.id })
          .from(focuses)
          .where(and(eq(focuses.cycleId, cycle.id), eq(focuses.capabilityId, body.data.capabilityId)));
        if (repeated !== undefined) throw new Refusal(409, { error: 'already_focus' });
        try {
          const [created] = await tx
            .insert(focuses)
            .values({ organizationId: row.organizationId, cycleId: cycle.id, ...body.data, createdBy: personId })
            .returning({ id: focuses.id });
          return { status: 201, body: { focusId: created!.id } };
        } catch (error) {
          if (postgresConstraint(error) === 'focuses_one_per_capability') throw new Refusal(409, { error: 'already_focus' });
          if (postgresCode(error) === 'PM008') throw new Refusal(422, { error: 'too_many_focuses', maxFocuses: program.maxFocuses });
          if (postgresCode(error) === 'PM050') throw new Refusal(409, { error: 'cycle_not_planned' });
          if (postgresCode(error) === '23514') throw new Refusal(422, { error: 'invalid_target' });
          throw error;
        }
      }),
    );
  });

  api.delete('/boards/:boardId/cycles/:cycleId/focuses/:focusId', async (request, reply) => {
    const params = focusParams.safeParse(request.params);
    if (!params.success) return reply.code(400).send({ error: 'invalid_request' });
    return answer(reply, () =>
      openBoard(request, reply, params.data.boardId, async (tx, { access, personId, row }) => {
        if (!canPlanCycle(personId, access)) throw new Refusal(403, { error: 'forbidden' });
        const cycle = await cycleOfBoard(tx, row.id, params.data.cycleId);
        if (cycle.state !== 'planned') throw new Refusal(409, { error: 'cycle_not_planned' });
        let removed;
        try {
          removed = await tx
            .delete(focuses)
            .where(and(eq(focuses.id, params.data.focusId), eq(focuses.cycleId, cycle.id)))
            .returning({ id: focuses.id });
        } catch (error) {
          if (postgresCode(error) === 'PM050') throw new Refusal(409, { error: 'cycle_not_planned' });
          throw error;
        }
        if (removed.length === 0) throw new Refusal(404, NOT_FOUND);
        return { status: 204 };
      }),
    );
  });

  api.post('/boards/:boardId/cycles/:cycleId/focuses/:focusId/experiments', async (request, reply) => {
    const params = focusParams.safeParse(request.params);
    const body = experimentInput.safeParse(request.body);
    if (!params.success || !body.success) return reply.code(400).send({ error: 'invalid_request' });
    return answer(reply, () =>
      openBoard(request, reply, params.data.boardId, async (tx, { access, personId, row }) => {
        if (!canPlanCycle(personId, access)) throw new Refusal(403, { error: 'forbidden' });
        const cycle = await cycleOfBoard(tx, row.id, params.data.cycleId);
        const [focus] = await tx
          .select({ id: focuses.id })
          .from(focuses)
          .where(and(eq(focuses.id, params.data.focusId), eq(focuses.cycleId, cycle.id)));
        if (focus === undefined) throw new Refusal(404, NOT_FOUND);
        if (cycle.state === 'closed') throw new Refusal(409, { error: 'cycle_closed' });
        try {
          const [created] = await tx
            .insert(experiments)
            .values({ organizationId: row.organizationId, focusId: focus.id, ...body.data, createdBy: personId })
            .returning({ id: experiments.id });
          return { status: 201, body: { experimentId: created!.id } };
        } catch (error) {
          if (postgresCode(error) === 'PM050') throw new Refusal(409, { error: 'cycle_closed' });
          throw error;
        }
      }),
    );
  });

  api.post('/boards/:boardId/cycles/:cycleId/start', async (request, reply) => {
    const params = cycleParams.safeParse(request.params);
    if (!params.success) return reply.code(400).send({ error: 'invalid_request' });
    return answer(reply, () =>
      openBoard(request, reply, params.data.boardId, async (tx, { access, personId, row }) => {
        if (!canStartCycle(personId, access)) throw new Refusal(403, { error: 'forbidden' });
        const cycle = await cycleOfBoard(tx, row.id, params.data.cycleId);
        if (cycle.state !== 'planned') throw new Refusal(409, { error: 'cycle_not_planned' });
        if (row.status !== 'calibrated' && row.status !== 'between_cycles') throw new Refusal(409, { error: 'board_not_ready' });
        const { maxFocuses } = await programOf(tx, row.programId);
        const blockers = await blockersOf(tx, cycle.id, maxFocuses);
        if (blockers.noFocus || blockers.tooMany || blockers.withoutExperiment.length > 0) {
          throw new Refusal(422, { error: 'cannot_start', ...blockers });
        }
        try {
          const started = await tx.execute<{ started_at: string }>(sql`select app_start_cycle(${cycle.id}::uuid) as started_at`);
          return { body: { startedAt: started.rows[0]!.started_at } };
        } catch (error) {
          // The database repeats the checks under a lock: the cycle changed in between.
          if (postgresCode(error) === 'PM008') throw new Refusal(409, { error: 'cycle_changed' });
          if (postgresCode(error) === 'PM050') throw new Refusal(409, { error: 'cycle_not_planned' });
          throw error;
        }
      }),
    );
  });

  api.patch('/boards/:boardId/experiments/:experimentId', async (request, reply) => {
    const params = experimentParams.safeParse(request.params);
    const body = experimentMove.safeParse(request.body);
    if (!params.success || !body.success) return reply.code(400).send({ error: 'invalid_request' });
    return answer(reply, () =>
      openBoard(request, reply, params.data.boardId, async (tx, { access, personId, row }) => {
        const [found] = await tx
          .select({ id: experiments.id, state: experiments.state, cycleState: cycles.state })
          .from(experiments)
          .innerJoin(focuses, eq(focuses.id, experiments.focusId))
          .innerJoin(cycles, eq(cycles.id, focuses.cycleId))
          .where(and(eq(experiments.id, params.data.experimentId), eq(cycles.boardId, row.id)));
        if (found === undefined) throw new Refusal(404, NOT_FOUND);
        const move = body.data;
        const allowed = move.state === 'reviewed' ? canReviewExperiment(personId, access) : canPlanCycle(personId, access);
        if (!allowed) throw new Refusal(403, { error: 'forbidden' });
        const result = move.state === 'reviewed' ? move.result : undefined;
        if (!canMoveExperiment(found.state, move.state, found.cycleState, result)) {
          throw new Refusal(409, { error: 'invalid_transition' });
        }
        try {
          await tx
            .update(experiments)
            .set(move.state === 'reviewed' ? { state: 'reviewed', result: move.result, learnings: move.learnings } : { state: 'in_progress' })
            .where(eq(experiments.id, found.id));
        } catch (error) {
          if (postgresCode(error) === 'PM050') throw new Refusal(409, { error: 'invalid_transition' });
          if (postgresCode(error) === '42501') throw new Refusal(403, { error: 'forbidden' });
          throw error;
        }
        return { body: { state: move.state } };
      }),
    );
  });

  api.post('/boards/:boardId/evidence', async (request, reply) => {
    const params = boardParams.safeParse(request.params);
    const body = evidenceInput.safeParse(request.body);
    if (!params.success || !body.success) return reply.code(400).send({ error: 'invalid_request' });
    return answer(reply, () =>
      openBoard(request, reply, params.data.boardId, async (tx, { access, personId, row }) => {
        if (!access.hasBaseline) throw new Refusal(409, { error: 'no_baseline' });
        if (!canRecordEvidence(personId, access)) throw new Refusal(403, { error: 'forbidden' });
        try {
          const [created] = await tx
            .insert(evidence)
            .values({ organizationId: row.organizationId, boardId: row.id, ...body.data, author: personId })
            .returning({ id: evidence.id });
          return { status: 201, body: { evidenceId: created!.id } };
        } catch (error) {
          if (['23514', '23503'].includes(postgresCode(error) ?? '')) throw new Refusal(400, { error: 'unknown_reference' });
          throw error;
        }
      }),
    );
  });

  api.delete('/boards/:boardId/evidence/:evidenceId', async (request, reply) => {
    const params = evidenceParams.safeParse(request.params);
    if (!params.success) return reply.code(400).send({ error: 'invalid_request' });
    return answer(reply, () =>
      openBoard(request, reply, params.data.boardId, async (tx, { personId, row }) => {
        const [found] = await tx
          .select({ author: evidence.author })
          .from(evidence)
          .where(and(eq(evidence.id, params.data.evidenceId), eq(evidence.boardId, row.id)));
        if (found === undefined) throw new Refusal(404, NOT_FOUND);
        if (found.author !== personId) throw new Refusal(403, { error: 'forbidden' });
        try {
          await tx.delete(evidence).where(eq(evidence.id, params.data.evidenceId));
        } catch (error) {
          if (postgresCode(error) === '23503') throw new Refusal(409, { error: 'evidence_cited' });
          throw error;
        }
        return { status: 204 };
      }),
    );
  });

  api.post('/boards/:boardId/level-proposals', async (request, reply) => {
    const params = boardParams.safeParse(request.params);
    const body = proposalInput.safeParse(request.body);
    if (!params.success || !body.success) return reply.code(400).send({ error: 'invalid_request' });
    return answer(reply, () =>
      openBoard(request, reply, params.data.boardId, async (tx, { access, personId, row }) => {
        if (!canProposeChange(personId, access)) throw new Refusal(access.hasBaseline ? 403 : 409, access.hasBaseline ? { error: 'forbidden' } : { error: 'no_baseline' });
        const program = await programOf(tx, row.programId);
        const [current] = await tx
          .select({ position: levels.position })
          .from(placements)
          .leftJoin(levels, eq(levels.id, placements.levelId))
          .where(and(eq(placements.boardId, row.id), eq(placements.capabilityId, body.data.capabilityId)));
        const [target] = await tx
          .select({ position: levels.position, requiresTransfer: levels.requiresTransfer })
          .from(levels)
          .where(and(eq(levels.id, body.data.levelId), eq(levels.mapId, program.mapId)));
        if (current === undefined || target === undefined) throw new Refusal(400, { error: 'unknown_reference' });
        const cited = await boardEvidence(tx, row.id, body.data.evidenceIds);
        const problems = proposalProblems({
          current: current.position,
          target: target.position,
          targetRequiresTransfer: target.requiresTransfer,
          evidence: cited,
        });
        if (problems.length > 0) throw new Refusal(422, { error: 'invalid_proposal', problems });
        try {
          const created = await tx.execute<{ id: string }>(
            sql`select app_propose_level_change(${row.id}::uuid, ${body.data.capabilityId}::uuid, ${body.data.levelId}::uuid,
                  ${`{${[...new Set(body.data.evidenceIds)].join(',')}}`}::uuid[]) as id`,
          );
          return { status: 201, body: { proposalId: created.rows[0]!.id } };
        } catch (error) {
          if (postgresConstraint(error) === 'level_change_proposals_one_open') throw new Refusal(409, { error: 'proposal_open' });
          if (postgresCode(error) === '23514') throw new Refusal(400, { error: 'unknown_reference' });
          // The database repeats the checks: the level or the evidence changed in between.
          if (['PM004', 'PM006'].includes(postgresCode(error) ?? '')) throw new Refusal(409, { error: 'board_changed' });
          throw error;
        }
      }),
    );
  });

  /** Approves or rejects a proposal or a bonus through its decision function. */
  const decision = (route: string, params: typeof proposalParams | typeof bonusParams, run: (id: string, approve: boolean, note: string) => ReturnType<typeof sql>) =>
    api.post(route, async (request, reply) => {
      const parsed = params.safeParse(request.params);
      const body = decisionInput.safeParse(request.body);
      if (!parsed.success || !body.success) return reply.code(400).send({ error: 'invalid_request' });
      const targetId = 'proposalId' in parsed.data ? parsed.data.proposalId : parsed.data.bonusId;
      return answer(reply, () =>
        openBoard(request, reply, parsed.data.boardId, async (tx, { access, personId, row }) => {
          if (!canDecideProposal(personId, access)) throw new Refusal(403, { error: 'forbidden' });
          const table = 'proposalId' in parsed.data ? levelChangeProposals : bonusAwards;
          const [found] = await tx
            .select({ id: table.id })
            .from(table)
            .where(and(eq(table.id, targetId), eq(table.boardId, row.id)));
          if (found === undefined) throw new Refusal(404, NOT_FOUND);
          try {
            await tx.execute(run(targetId, body.data.approve, body.data.note));
          } catch (error) {
            if (postgresCode(error) === 'PM050') throw new Refusal(409, { error: 'already_decided' });
            if (postgresCode(error) === 'PM004') throw new Refusal(409, { error: 'no_longer_above' });
            throw error;
          }
          return { body: { state: body.data.approve ? 'approved' : 'rejected' } };
        }),
      );
    });
  decision('/boards/:boardId/level-proposals/:proposalId/decision', proposalParams, (target, approve, note) =>
    sql`select app_decide_level_change(${target}::uuid, ${approve}, ${note})`,
  );
  decision('/boards/:boardId/bonuses/:bonusId/decision', bonusParams, (target, approve, note) =>
    sql`select app_decide_bonus(${target}::uuid, ${approve}, ${note})`,
  );

  api.post('/boards/:boardId/bonuses', async (request, reply) => {
    const params = boardParams.safeParse(request.params);
    const body = bonusInput.safeParse(request.body);
    if (!params.success || !body.success) return reply.code(400).send({ error: 'invalid_request' });
    return answer(reply, () =>
      openBoard(request, reply, params.data.boardId, async (tx, { access, personId, row }) => {
        if (!canProposeChange(personId, access)) throw new Refusal(access.hasBaseline ? 403 : 409, access.hasBaseline ? { error: 'forbidden' } : { error: 'no_baseline' });
        const cited = await boardEvidence(tx, row.id, body.data.evidenceIds);
        const problems = bonusProblems({ evidenceCount: cited.length, alreadyAwarded: false });
        if (problems.length > 0) throw new Refusal(422, { error: 'invalid_bonus', problems });
        try {
          const created = await tx.execute<{ id: string }>(
            sql`select app_propose_bonus(${row.id}::uuid, ${body.data.capabilityId}::uuid, ${body.data.bonusRuleId}::uuid,
                  ${`{${[...new Set(body.data.evidenceIds)].join(',')}}`}::uuid[]) as id`,
          );
          return { status: 201, body: { bonusId: created.rows[0]!.id } };
        } catch (error) {
          if (postgresConstraint(error) === 'bonus_awards_one_per_rule') throw new Refusal(409, { error: 'already_awarded' });
          if (postgresCode(error) === '23514') throw new Refusal(400, { error: 'unknown_reference' });
          throw error;
        }
      }),
    );
  });

  api.post('/boards/:boardId/mentoring-sessions', async (request, reply) => {
    const params = boardParams.safeParse(request.params);
    const body = mentoringInput.safeParse(request.body);
    if (!params.success || !body.success) return reply.code(400).send({ error: 'invalid_request' });
    return answer(reply, () =>
      openBoard(request, reply, params.data.boardId, async (tx, { access, personId, row }) => {
        if (!canRecordMentoring(personId, access)) throw new Refusal(access.hasBaseline ? 403 : 409, access.hasBaseline ? { error: 'forbidden' } : { error: 'no_baseline' });
        try {
          const created = await tx.execute<{ id: string }>(
            sql`select app_record_mentoring(${row.id}::uuid, ${body.data.heldOn}::date, ${body.data.notes},
                  ${`{${[...new Set(body.data.experimentIds)].join(',')}}`}::uuid[]) as id`,
          );
          return { status: 201, body: { mentoringSessionId: created.rows[0]!.id } };
        } catch (error) {
          if (postgresCode(error) === '23514') throw new Refusal(400, { error: 'unknown_reference' });
          throw error;
        }
      }),
    );
  });

  api.post('/boards/:boardId/cycles/:cycleId/close', async (request, reply) => {
    const params = cycleParams.safeParse(request.params);
    if (!params.success) return reply.code(400).send({ error: 'invalid_request' });
    return answer(reply, () =>
      openBoard(request, reply, params.data.boardId, async (tx, { access, personId, row }) => {
        const cycle = await cycleOfBoard(tx, row.id, params.data.cycleId);
        if (!canCloseCycle(personId, access, 'active')) throw new Refusal(403, { error: 'forbidden' });
        if (cycle.state !== 'active') throw new Refusal(409, { error: 'cycle_not_active' });
        try {
          const snapshot = await tx.execute<{ id: string }>(sql`select app_close_cycle(${cycle.id}::uuid) as id`);
          return { body: { snapshotId: snapshot.rows[0]!.id } };
        } catch (error) {
          if (postgresCode(error) === 'PM050') throw new Refusal(409, { error: 'cycle_not_active' });
          throw error;
        }
      }),
    );
  });

  api.post('/boards/:boardId/recalibration', async (request, reply) => {
    const params = boardParams.safeParse(request.params);
    const body = recalibrationInput.safeParse(request.body);
    if (!params.success || !body.success) return reply.code(400).send({ error: 'invalid_request' });
    return answer(reply, () =>
      openBoard(request, reply, params.data.boardId, async (tx, { access, personId, row }) => {
        if (!isOnPanel(personId, access)) throw new Refusal(403, { error: 'forbidden' });
        if (!canRecalibrate(personId, access, row.status)) throw new Refusal(409, { error: 'not_between_cycles' });
        const { attendees, levels: agreed } = body.data;
        const onBoard = new Set([access.ownerPersonId, ...access.panel.map((member) => member.personId)]);
        if (attendees.some((attendee) => !onBoard.has(attendee))) throw new Refusal(400, { error: 'unknown_reference' });
        const [program] = await tx
          .select({ mandatoryPanelRoles: programs.mandatoryPanelRoles })
          .from(programs)
          .where(eq(programs.id, row.programId));
        const absent = missingAttendance(attendees, access, program!.mandatoryPanelRoles);
        if (absent.participant || absent.roles.length > 0) {
          throw new Refusal(422, { error: 'attendance', participantMissing: absent.participant, missingRoles: absent.roles });
        }
        const missing = missingFromCalibration(await capabilitiesOnBoard(tx, row.id), agreed);
        if (missing.length > 0) throw new Refusal(422, { error: 'incomplete', missing });
        try {
          const recorded = await tx.execute<{ id: string }>(
            sql`select app_recalibrate_board(${row.id}::uuid, ${body.data.heldOn}::date, ${body.data.notes},
                  ${`{${attendees.join(',')}}`}::uuid[], ${JSON.stringify(agreed)}::jsonb) as id`,
          );
          return { status: 201, body: { recalibrationId: recorded.rows[0]!.id } };
        } catch (error) {
          if (postgresCode(error) === '23514') throw new Refusal(400, { error: 'unknown_reference' });
          if (postgresCode(error) === 'PM031') throw new Refusal(409, { error: 'panel_changed' });
          if (postgresCode(error) === 'PM050' || postgresConstraint(error) === 'recalibration_sessions_one_per_gap') {
            throw new Refusal(409, { error: 'already_recalibrated' });
          }
          throw error;
        }
      }),
    );
  });

  api.post('/boards/:boardId/close', async (request, reply) => {
    const params = boardParams.safeParse(request.params);
    if (!params.success) return reply.code(400).send({ error: 'invalid_request' });
    return answer(reply, () =>
      openBoard(request, reply, params.data.boardId, async (tx, { access, personId, row }) => {
        if (!isOnPanel(personId, access)) throw new Refusal(403, { error: 'forbidden' });
        if (!canCloseBoard(personId, access, row.status)) throw new Refusal(409, { error: 'cycle_open' });
        try {
          await tx.execute(sql`select app_close_board(${row.id}::uuid)`);
        } catch (error) {
          if (postgresCode(error) === 'PM050') throw new Refusal(409, { error: 'cycle_open' });
          throw error;
        }
        return { body: { status: 'closed' } };
      }),
    );
  });
}

/** Every permission of a closed board is off: it no longer changes (migration 0009). */
function readOnlyWhenClosed<T extends Record<string, unknown>>(status: string, viewer: T): T {
  if (status !== 'closed') return viewer;
  return Object.fromEntries(
    Object.entries(viewer).map(([key, value]) => [key, key.startsWith('can') ? false : value]),
  ) as T;
}
