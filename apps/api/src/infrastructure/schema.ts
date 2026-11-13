import { boolean, date, integer, numeric, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

// Typed view of the tables for queries. The SQL files in ../../migrations are the
// source of truth for structure, constraints and Row Level Security policies.

export const organizations = pgTable('organizations', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const persons = pgTable('persons', {
  id: uuid('id').primaryKey().defaultRandom(),
  /** `null`: person of the mentoring firm, a super administrator. */
  organizationId: uuid('organization_id'),
  email: text('email').notNull(),
  name: text('name').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const organizationMemberships = pgTable('organization_memberships', {
  id: uuid('id').primaryKey().defaultRandom(),
  organizationId: uuid('organization_id').notNull(),
  personId: uuid('person_id').notNull(),
  role: text('role', { enum: ['administrator', 'map_designer'] }).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const roles = pgTable('roles', {
  id: uuid('id').primaryKey().defaultRandom(),
  organizationId: uuid('organization_id').notNull(),
  name: text('name').notNull(),
  description: text('description').notNull().default(''),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const tools = pgTable('tools', {
  id: uuid('id').primaryKey().defaultRandom(),
  organizationId: uuid('organization_id').notNull(),
  name: text('name').notNull(),
  description: text('description').notNull().default(''),
  link: text('link'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const strategicObjectives = pgTable('strategic_objectives', {
  id: uuid('id').primaryKey().defaultRandom(),
  organizationId: uuid('organization_id').notNull(),
  name: text('name').notNull(),
  description: text('description').notNull().default(''),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const capabilityMaps = pgTable('capability_maps', {
  id: uuid('id').primaryKey().defaultRandom(),
  organizationId: uuid('organization_id').notNull(),
  roleId: uuid('role_id').notNull(),
  version: integer('version').notNull(),
  status: text('status', { enum: ['draft', 'published', 'archived'] }).notNull().default('draft'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  publishedAt: timestamp('published_at', { withTimezone: true }),
  archivedAt: timestamp('archived_at', { withTimezone: true }),
});

export const levels = pgTable('levels', {
  id: uuid('id').primaryKey().defaultRandom(),
  organizationId: uuid('organization_id').notNull(),
  mapId: uuid('map_id').notNull(),
  position: integer('position').notNull(),
  name: text('name').notNull(),
  description: text('description').notNull().default(''),
  /** Exact decimal; comes back from the driver as a string. */
  multiplier: numeric('multiplier', { precision: 8, scale: 2 }).notNull(),
  requiresTransfer: boolean('requires_transfer').notNull().default(false),
});

export const dimensions = pgTable('dimensions', {
  id: uuid('id').primaryKey().defaultRandom(),
  organizationId: uuid('organization_id').notNull(),
  mapId: uuid('map_id').notNull(),
  position: integer('position').notNull(),
  name: text('name').notNull(),
  description: text('description').notNull().default(''),
  kind: text('kind', { enum: ['work_cycle', 'transversal'] }).notNull(),
});

export const capabilities = pgTable('capabilities', {
  id: uuid('id').primaryKey().defaultRandom(),
  organizationId: uuid('organization_id').notNull(),
  dimensionId: uuid('dimension_id').notNull(),
  position: integer('position').notNull(),
  statement: text('statement').notNull(),
  difficulty: text('difficulty', { enum: ['low', 'medium', 'high'] }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const capabilityTools = pgTable('capability_tools', {
  organizationId: uuid('organization_id').notNull(),
  capabilityId: uuid('capability_id').notNull(),
  toolId: uuid('tool_id').notNull(),
});

export const capabilityObjectives = pgTable('capability_objectives', {
  organizationId: uuid('organization_id').notNull(),
  capabilityId: uuid('capability_id').notNull(),
  objectiveId: uuid('objective_id').notNull(),
});

export const bonusRules = pgTable('bonus_rules', {
  id: uuid('id').primaryKey().defaultRandom(),
  organizationId: uuid('organization_id').notNull(),
  mapId: uuid('map_id').notNull(),
  name: text('name').notNull(),
  extraPoints: numeric('extra_points', { precision: 8, scale: 2 }).notNull(),
  condition: text('condition').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const programs = pgTable('programs', {
  id: uuid('id').primaryKey().defaultRandom(),
  organizationId: uuid('organization_id').notNull(),
  mapId: uuid('map_id').notNull(),
  name: text('name').notNull(),
  startsOn: date('starts_on').notNull(),
  endsOn: date('ends_on').notNull(),
  maxFocuses: integer('max_focuses').notNull().default(3),
  mandatoryPanelRoles: text('mandatory_panel_roles', { enum: ['leader', 'specialist', 'mentor'] })
    .array()
    .notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const programCapabilities = pgTable('program_capabilities', {
  organizationId: uuid('organization_id').notNull(),
  programId: uuid('program_id').notNull(),
  capabilityId: uuid('capability_id').notNull(),
});

export const enrollments = pgTable('enrollments', {
  id: uuid('id').primaryKey().defaultRandom(),
  organizationId: uuid('organization_id').notNull(),
  programId: uuid('program_id').notNull(),
  personId: uuid('person_id').notNull(),
  role: text('role', { enum: ['participant', 'leader', 'specialist', 'mentor'] }).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const panelAssignments = pgTable('panel_assignments', {
  organizationId: uuid('organization_id').notNull(),
  participantEnrollmentId: uuid('participant_enrollment_id').notNull(),
  memberEnrollmentId: uuid('member_enrollment_id').notNull(),
  role: text('role', { enum: ['leader', 'specialist', 'mentor'] }).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const boards = pgTable('boards', {
  id: uuid('id').primaryKey().defaultRandom(),
  organizationId: uuid('organization_id').notNull(),
  enrollmentId: uuid('enrollment_id').notNull(),
  programId: uuid('program_id').notNull(),
  ownerPersonId: uuid('owner_person_id').notNull(),
  status: text('status', {
    enum: ['not_started', 'self_assessed', 'calibrated', 'in_cycle', 'between_cycles', 'closed'],
  })
    .notNull()
    .default('not_started'),
  baselineSetAt: timestamp('baseline_set_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const placements = pgTable('placements', {
  id: uuid('id').primaryKey().defaultRandom(),
  organizationId: uuid('organization_id').notNull(),
  boardId: uuid('board_id').notNull(),
  capabilityId: uuid('capability_id').notNull(),
  levelId: uuid('level_id'),
  addedBy: uuid('added_by').notNull(),
  addedAt: timestamp('added_at', { withTimezone: true }).notNull().defaultNow(),
});

export const selfAssessments = pgTable('self_assessments', {
  id: uuid('id').primaryKey().defaultRandom(),
  organizationId: uuid('organization_id').notNull(),
  boardId: uuid('board_id').notNull(),
  submittedAt: timestamp('submitted_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const selfAssessmentLevels = pgTable('self_assessment_levels', {
  organizationId: uuid('organization_id').notNull(),
  selfAssessmentId: uuid('self_assessment_id').notNull(),
  capabilityId: uuid('capability_id').notNull(),
  levelId: uuid('level_id').notNull(),
});
