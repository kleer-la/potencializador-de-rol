import { canAdministerOrganization, canDesignMaps, canReadOrganization } from '@potencializador/domain';
import { and, eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { createOrganizationAccess } from '../access/organization-access.ts';
import { postgresCode, UNIQUE_VIOLATION } from '../infrastructure/postgres-errors.ts';
import { roles, strategicObjectives, tools } from '../infrastructure/schema.ts';
import { withScope, type Database, type ScopedTransaction } from '../infrastructure/scoped-transaction.ts';

const name = z.string().trim().min(1).max(160);
const description = z.string().trim().max(2000);
const link = z
  .url({ protocol: /^https?$/ })
  .max(2000)
  .nullable();

const roleInput = z.object({ name, description: description.default('') });
const toolInput = z.object({ name, description: description.default(''), link: link.default(null) });
const objectiveInput = z.object({ name, description: description.default('') });
const entryParams = z.object({ entryId: z.uuid().toLowerCase() });

const nameTaken = { error: 'name_taken' } as const;

/** A change names at least one field; an empty one is a malformed request. */
const nonEmpty = (value: Record<string, unknown>) => Object.keys(value).length > 0;

/**
 * What an organization defines outside its maps: roles, the tool catalog and the strategic
 * objectives. Must be registered after `registerIdentity`.
 */
export async function registerCatalog(api: FastifyInstance, options: { database: Database }): Promise<void> {
  const db = options.database;
  const { requireOrganization } = createOrganizationAccess(db);

  // Roles: an administrator creates them (document §7); every member reads them.

  api.get('/organizations/:organizationId/roles', async (request, reply) => {
    const access = await requireOrganization(request, reply, canReadOrganization);
    if (access === null) return reply;
    const rows = await withScope(db, access.scope, (tx) =>
      tx
        .select({ id: roles.id, name: roles.name, description: roles.description })
        .from(roles)
        .where(eq(roles.organizationId, access.organizationId))
        .orderBy(roles.name),
    );
    return { roles: rows };
  });

  api.post('/organizations/:organizationId/roles', async (request, reply) => {
    const access = await requireOrganization(request, reply, canAdministerOrganization);
    if (access === null) return reply;
    const input = roleInput.safeParse(request.body);
    if (!input.success) return reply.code(400).send({ error: 'invalid_request' });
    try {
      const [created] = await withScope(db, access.scope, (tx) =>
        tx
          .insert(roles)
          .values({ organizationId: access.organizationId, ...input.data })
          .returning({ id: roles.id, name: roles.name, description: roles.description }),
      );
      return reply.code(201).send(created);
    } catch (error) {
      if (postgresCode(error) === UNIQUE_VIOLATION) return reply.code(409).send(nameTaken);
      throw error;
    }
  });

  // Catalogs: a map designer maintains them; every member reads them. Entries are
  // shared by all the maps of the organization and stay editable after publishing.

  /** Database work of one catalog; the routes around it are the same for every catalog. */
  type CatalogStore<Entry> = {
    create: z.ZodType<Record<string, unknown>>;
    /** Without defaults, so a change touches only the fields it names. */
    change: z.ZodType<Record<string, unknown>>;
    list: (tx: ScopedTransaction, organizationId: string) => Promise<Entry[]>;
    insert: (tx: ScopedTransaction, organizationId: string, values: Record<string, unknown>) => Promise<Entry>;
    update: (
      tx: ScopedTransaction,
      organizationId: string,
      id: string,
      values: Record<string, unknown>,
    ) => Promise<Entry | undefined>;
  };

  const registerEntries = <Entry>(path: string, store: CatalogStore<Entry>) => {
    api.get(`/organizations/:organizationId/${path}`, async (request, reply) => {
      const access = await requireOrganization(request, reply, canReadOrganization);
      if (access === null) return reply;
      const items = await withScope(db, access.scope, (tx) => store.list(tx, access.organizationId));
      return { items };
    });

    api.post(`/organizations/:organizationId/${path}`, async (request, reply) => {
      const access = await requireOrganization(request, reply, canDesignMaps);
      if (access === null) return reply;
      const input = store.create.safeParse(request.body);
      if (!input.success) return reply.code(400).send({ error: 'invalid_request' });
      try {
        const created = await withScope(db, access.scope, (tx) =>
          store.insert(tx, access.organizationId, input.data),
        );
        return reply.code(201).send(created);
      } catch (error) {
        if (postgresCode(error) === UNIQUE_VIOLATION) return reply.code(409).send(nameTaken);
        throw error;
      }
    });

    api.patch(`/organizations/:organizationId/${path}/:entryId`, async (request, reply) => {
      const access = await requireOrganization(request, reply, canDesignMaps);
      if (access === null) return reply;
      const params = entryParams.safeParse(request.params);
      const input = store.change.safeParse(request.body);
      if (!params.success || !input.success) return reply.code(400).send({ error: 'invalid_request' });
      try {
        const changed = await withScope(db, access.scope, (tx) =>
          store.update(tx, access.organizationId, params.data.entryId, input.data),
        );
        if (changed === undefined) return reply.code(404).send({ error: 'not_found' });
        return changed;
      } catch (error) {
        if (postgresCode(error) === UNIQUE_VIOLATION) return reply.code(409).send(nameTaken);
        throw error;
      }
    });
  };

  const toolColumns = { id: tools.id, name: tools.name, description: tools.description, link: tools.link };
  registerEntries('tools', {
    create: toolInput,
    change: z.object({ name, description, link }).partial().strict().refine(nonEmpty),
    list: (tx, organizationId) =>
      tx.select(toolColumns).from(tools).where(eq(tools.organizationId, organizationId)).orderBy(tools.name),
    insert: async (tx, organizationId, values) =>
      (await tx
        .insert(tools)
        .values({ organizationId, ...(values as z.infer<typeof toolInput>) })
        .returning(toolColumns))[0]!,
    update: async (tx, organizationId, id, values) =>
      (
        await tx
          .update(tools)
          .set(values)
          .where(and(eq(tools.id, id), eq(tools.organizationId, organizationId)))
          .returning(toolColumns)
      )[0],
  });

  const objectiveColumns = {
    id: strategicObjectives.id,
    name: strategicObjectives.name,
    description: strategicObjectives.description,
  };
  registerEntries('strategic-objectives', {
    create: objectiveInput,
    change: z.object({ name, description }).partial().strict().refine(nonEmpty),
    list: (tx, organizationId) =>
      tx
        .select(objectiveColumns)
        .from(strategicObjectives)
        .where(eq(strategicObjectives.organizationId, organizationId))
        .orderBy(strategicObjectives.name),
    insert: async (tx, organizationId, values) =>
      (await tx
        .insert(strategicObjectives)
        .values({ organizationId, ...(values as z.infer<typeof objectiveInput>) })
        .returning(objectiveColumns))[0]!,
    update: async (tx, organizationId, id, values) =>
      (
        await tx
          .update(strategicObjectives)
          .set(values)
          .where(and(eq(strategicObjectives.id, id), eq(strategicObjectives.organizationId, organizationId)))
          .returning(objectiveColumns)
      )[0],
  });
}
