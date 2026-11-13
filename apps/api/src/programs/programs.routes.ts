import {
  ENROLLMENT_ROLES,
  PANEL_ROLES,
  canAdministerOrganization,
  canDesignMaps,
  canEnrollAs,
  canReadOrganization,
  missingPanelRoles,
  type Actor,
  type PanelRole,
} from '@potencializador/domain';
import { and, asc, eq, sql } from 'drizzle-orm';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { createOrganizationAccess, type OrganizationPolicy } from '../access/organization-access.ts';
import { Refusal } from '../maps/map-store.ts';
import { postgresCode } from '../infrastructure/postgres-errors.ts';
import {
  boards,
  capabilityMaps,
  enrollments,
  panelAssignments,
  persons,
  programCapabilities,
  programs,
} from '../infrastructure/schema.ts';
import { withScope, type Database, type ScopedTransaction } from '../infrastructure/scoped-transaction.ts';

const id = z.uuid().toLowerCase();
const day = z.iso.date();
const CHECK_VIOLATION = '23514';
const FOREIGN_KEY_VIOLATION = '23503';

const programInput = z
  .object({
    mapId: id,
    name: z.string().trim().min(1).max(160),
    startsOn: day,
    endsOn: day,
    maxFocuses: z.number().int().min(1).max(20).default(3),
    mandatoryPanelRoles: z.array(z.enum(PANEL_ROLES)).max(3).default([...PANEL_ROLES]),
  })
  .refine((value) => value.endsOn >= value.startsOn);
const selectionInput = z.object({ capabilityIds: z.array(id).max(500) });
const enrollmentInput = z.object({
  email: z.string().trim().toLowerCase().pipe(z.email().max(254)),
  roles: z
    .array(z.enum(ENROLLMENT_ROLES))
    .min(1)
    .max(4)
    .refine((roles) => new Set(roles).size === roles.length),
});
const panelInput = z.object({ participantEnrollmentId: id, memberEnrollmentId: id, role: z.enum(PANEL_ROLES) });
const programParams = z.object({ programId: id });
const enrollmentParams = z.object({ programId: id, enrollmentId: id });
const panelParams = z.object({
  programId: id,
  participantEnrollmentId: id,
  memberEnrollmentId: id,
  role: z.enum(PANEL_ROLES),
});

const administersOrDesigns: OrganizationPolicy = (actor: Actor, organizationId: string) =>
  canAdministerOrganization(actor, organizationId) || canDesignMaps(actor, organizationId);

const programColumns = {
  id: programs.id,
  mapId: programs.mapId,
  roleId: capabilityMaps.roleId,
  name: programs.name,
  startsOn: programs.startsOn,
  endsOn: programs.endsOn,
  maxFocuses: programs.maxFocuses,
  mandatoryPanelRoles: programs.mandatoryPanelRoles,
};

/**
 * Programs of an organization: their base selection, enrollments and panels. Board
 * content never appears here (invariant 9): only each board's existence and state.
 */
export async function registerPrograms(api: FastifyInstance, options: { database: Database }): Promise<void> {
  const db = options.database;
  const { requireOrganization } = createOrganizationAccess(db);

  const handle =
    <P, B>(
      policy: OrganizationPolicy,
      parse: { params?: z.ZodType<P>; body?: z.ZodType<B> },
      work: (
        tx: ScopedTransaction,
        input: { organizationId: string; params: P; body: B },
      ) => Promise<{ status?: number; body?: unknown }>,
    ) =>
    async (request: FastifyRequest, reply: FastifyReply) => {
      const access = await requireOrganization(request, reply, policy);
      if (access === null) return reply;
      const params = parse.params ? parse.params.safeParse(request.params) : { success: true as const, data: undefined };
      const body = parse.body ? parse.body.safeParse(request.body ?? {}) : { success: true as const, data: undefined };
      if (!params.success || !body.success) return reply.code(400).send({ error: 'invalid_request' });
      try {
        const result = await withScope(db, access.scope, (tx) =>
          work(tx, { organizationId: access.organizationId, params: params.data as P, body: body.data as B }),
        );
        reply.code(result.status ?? 200);
        return result.body === undefined ? reply.send() : reply.send(result.body);
      } catch (error) {
        if (error instanceof Refusal) return reply.code(error.status).send(error.body);
        if (postgresCode(error) === 'PM001') return reply.code(409).send({ error: 'baseline_set' });
        throw error;
      }
    };

  /** The program, if it belongs to the organization (super administrators see all of them). */
  const requireProgram = async (tx: ScopedTransaction, organizationId: string, programId: string) => {
    const [found] = await tx
      .select(programColumns)
      .from(programs)
      .innerJoin(capabilityMaps, eq(capabilityMaps.id, programs.mapId))
      .where(and(eq(programs.id, programId), eq(programs.organizationId, organizationId)));
    if (found === undefined) throw new Refusal(404, { error: 'not_found' });
    return found;
  };

  /** Runs a write whose database guard may refuse it, turning that refusal into `refusal`. */
  const guarded = async <T>(work: () => Promise<T>, codes: string[], refusal: Refusal): Promise<T> => {
    try {
      return await work();
    } catch (error) {
      if (codes.includes(postgresCode(error) ?? '')) throw refusal;
      throw error;
    }
  };

  const base = '/organizations/:organizationId/programs';

  api.get(
    base,
    handle(canReadOrganization, {}, async (tx, { organizationId }) => ({
      body: {
        programs: await tx
          .select(programColumns)
          .from(programs)
          .innerJoin(capabilityMaps, eq(capabilityMaps.id, programs.mapId))
          .where(eq(programs.organizationId, organizationId))
          .orderBy(asc(programs.startsOn), asc(programs.name)),
      },
    })),
  );

  api.post(
    base,
    handle(canAdministerOrganization, { body: programInput }, async (tx, { organizationId, body }) => {
      const [map] = await tx
        .select({ id: capabilityMaps.id })
        .from(capabilityMaps)
        .where(and(eq(capabilityMaps.id, body.mapId), eq(capabilityMaps.organizationId, organizationId)));
      if (map === undefined) throw new Refusal(404, { error: 'not_found' });
      const [created] = await guarded(
        () =>
          tx
            .insert(programs)
            .values({ organizationId, ...body })
            .returning({ id: programs.id }),
        [CHECK_VIOLATION],
        new Refusal(409, { error: 'map_not_published' }),
      );
      return { status: 201, body: await requireProgram(tx, organizationId, created!.id) };
    }),
  );

  api.get(
    `${base}/:programId`,
    handle(administersOrDesigns, { params: programParams }, async (tx, { organizationId, params }) => {
      const program = await requireProgram(tx, organizationId, params.programId);
      const selection = await tx
        .select({ capabilityId: programCapabilities.capabilityId })
        .from(programCapabilities)
        .where(eq(programCapabilities.programId, program.id));
      const people = await tx
        .select({
          id: enrollments.id,
          personId: enrollments.personId,
          name: persons.name,
          email: persons.email,
          role: enrollments.role,
          isFirmPerson: sql<boolean>`${persons.organizationId} is null`,
        })
        .from(enrollments)
        .innerJoin(persons, eq(persons.id, enrollments.personId))
        .where(eq(enrollments.programId, program.id))
        .orderBy(asc(persons.name), asc(enrollments.role));
      const panels = await tx
        .select({
          participantEnrollmentId: panelAssignments.participantEnrollmentId,
          memberEnrollmentId: panelAssignments.memberEnrollmentId,
          role: panelAssignments.role,
        })
        .from(panelAssignments)
        .innerJoin(enrollments, eq(enrollments.id, panelAssignments.participantEnrollmentId))
        .where(eq(enrollments.programId, program.id));
      const boardRows = await tx
        .select({ id: boards.id, enrollmentId: boards.enrollmentId, status: boards.status })
        .from(boards)
        .where(eq(boards.programId, program.id));

      const missing: Record<string, PanelRole[]> = {};
      for (const participant of people.filter((person) => person.role === 'participant')) {
        missing[participant.id] = missingPanelRoles(
          program.mandatoryPanelRoles,
          panels.filter((panel) => panel.participantEnrollmentId === participant.id),
        );
      }
      return {
        body: {
          program,
          selection: selection.map((row) => row.capabilityId),
          enrollments: people,
          panels,
          boards: boardRows,
          missingPanelRoles: missing,
        },
      };
    }),
  );

  api.put(
    `${base}/:programId/selection`,
    handle(canDesignMaps, { params: programParams, body: selectionInput }, async (tx, { organizationId, params, body }) => {
      const program = await requireProgram(tx, organizationId, params.programId);
      await tx.delete(programCapabilities).where(eq(programCapabilities.programId, program.id));
      const unique = [...new Set(body.capabilityIds)];
      if (unique.length > 0) {
        await guarded(
          () =>
            tx
              .insert(programCapabilities)
              .values(unique.map((capabilityId) => ({ organizationId, programId: program.id, capabilityId }))),
          [CHECK_VIOLATION, FOREIGN_KEY_VIOLATION],
          new Refusal(400, { error: 'unknown_reference' }),
        );
      }
      return { body: { selection: unique } };
    }),
  );

  api.post(
    `${base}/:programId/enrollments`,
    handle(
      canAdministerOrganization,
      { params: programParams, body: enrollmentInput },
      async (tx, { organizationId, params, body }) => {
        const program = await requireProgram(tx, organizationId, params.programId);
        const found = await tx.execute<{ id: string; is_firm_person: boolean }>(
          sql`select id, is_firm_person from app_find_enrollable_person(${body.email})`,
        );
        const person = found.rows[0];
        // Unknown and another organization's person answer alike.
        if (person === undefined) throw new Refusal(404, { error: 'person_not_found' });
        if (body.roles.some((role) => !canEnrollAs({ isFirmPerson: person.is_firm_person }, role))) {
          throw new Refusal(400, { error: 'firm_person_cannot_participate' });
        }

        const created: { id: string; role: string }[] = [];
        for (const role of body.roles) {
          await tx
            .insert(enrollments)
            .values({ organizationId, programId: program.id, personId: person.id, role })
            .onConflictDoNothing();
          const [enrollment] = await tx
            .select({ id: enrollments.id, role: enrollments.role })
            .from(enrollments)
            .where(and(eq(enrollments.programId, program.id), eq(enrollments.personId, person.id), eq(enrollments.role, role)));
          created.push(enrollment!);
        }

        let boardId: string | null = null;
        const participant = created.find((enrollment) => enrollment.role === 'participant');
        if (participant !== undefined) {
          const [existing] = await tx.select({ id: boards.id }).from(boards).where(eq(boards.enrollmentId, participant.id));
          boardId =
            existing?.id ??
            (await tx.execute<{ id: string }>(sql`select app_create_board(${participant.id}::uuid) as id`)).rows[0]!.id;
        }
        return { status: 201, body: { enrollments: created, boardId } };
      },
    ),
  );

  api.delete(
    `${base}/:programId/enrollments/:enrollmentId`,
    handle(canAdministerOrganization, { params: enrollmentParams }, async (tx, { organizationId, params }) => {
      const program = await requireProgram(tx, organizationId, params.programId);
      const removed = await tx
        .delete(enrollments)
        .where(and(eq(enrollments.id, params.enrollmentId), eq(enrollments.programId, program.id)))
        .returning({ id: enrollments.id });
      if (removed.length === 0) throw new Refusal(404, { error: 'not_found' });
      return { status: 204 };
    }),
  );

  api.post(
    `${base}/:programId/panel`,
    handle(canAdministerOrganization, { params: programParams, body: panelInput }, async (tx, { organizationId, params, body }) => {
      const program = await requireProgram(tx, organizationId, params.programId);
      const [participant] = await tx
        .select({ id: enrollments.id })
        .from(enrollments)
        .where(and(eq(enrollments.id, body.participantEnrollmentId), eq(enrollments.programId, program.id)));
      if (participant === undefined) throw new Refusal(404, { error: 'not_found' });
      await guarded(
        () =>
          tx
            .insert(panelAssignments)
            .values({ organizationId, ...body })
            .onConflictDoNothing(),
        [CHECK_VIOLATION, FOREIGN_KEY_VIOLATION],
        new Refusal(400, { error: 'invalid_panel' }),
      );
      return { status: 201, body };
    }),
  );

  api.delete(
    `${base}/:programId/panel/:participantEnrollmentId/:memberEnrollmentId/:role`,
    handle(canAdministerOrganization, { params: panelParams }, async (tx, { organizationId, params }) => {
      const program = await requireProgram(tx, organizationId, params.programId);
      const removed = await tx
        .delete(panelAssignments)
        .where(
          and(
            eq(panelAssignments.participantEnrollmentId, params.participantEnrollmentId),
            eq(panelAssignments.memberEnrollmentId, params.memberEnrollmentId),
            eq(panelAssignments.role, params.role),
            sql`exists (select 1 from enrollments e where e.id = ${panelAssignments.participantEnrollmentId} and e.program_id = ${program.id})`,
          ),
        )
        .returning({ role: panelAssignments.role });
      if (removed.length === 0) throw new Refusal(404, { error: 'not_found' });
      return { status: 204 };
    }),
  );
}
