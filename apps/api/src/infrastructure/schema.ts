import { pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

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
