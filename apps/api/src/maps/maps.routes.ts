import {
  DIFFICULTIES,
  DIMENSION_KINDS,
  canApplyChange,
  canDesignMaps,
  canReadOrganization,
  canStartNewVersionFrom,
  canTransition,
  publishObstacles,
  type MapChange,
  type MapStatus,
} from '@potencializador/domain';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { createOrganizationAccess, type OrganizationPolicy } from '../access/organization-access.ts';
import {
  INVARIANT_10_VIOLATION,
  postgresCode,
  postgresConstraint,
  UNIQUE_VIOLATION,
} from '../infrastructure/postgres-errors.ts';
import { withScope, type Database } from '../infrastructure/scoped-transaction.ts';
import { createMapStore, Refusal, type MapHeader } from './map-store.ts';

const MAX_CAPABILITIES = 500;
/** Unique indexes on names, the only unique violations a client can cause on purpose. */
const NAME_CONSTRAINTS = new Set(['dimensions_name_unique', 'bonus_rules_name_unique']);

const id = z.uuid().toLowerCase();
const text = (maxLength: number) => z.string().trim().min(1).max(maxLength);
const description = z.string().trim().max(2000).default('');
const position = z.number().int().min(0).max(10_000);

const level = z.object({
  name: text(80),
  description,
  multiplier: z.number().min(0).max(1_000_000),
  requiresTransfer: z.boolean().default(false),
});
const bonusRule = z.object({ name: text(160), extraPoints: z.number().positive().max(1_000_000), condition: text(2000) });
const dimension = z.object({ name: text(120), description, kind: z.enum(DIMENSION_KINDS) });
const capability = z.object({
  statement: text(500),
  difficulty: z.enum(DIFFICULTIES).nullable().default(null),
  toolIds: z.array(id).max(50).default([]),
  objectiveIds: z.array(id).max(50).default([]),
});
const changed = <T extends z.ZodRawShape>(shape: T) =>
  z
    .object(shape)
    .partial()
    .strict()
    .refine((value) => Object.keys(value).length > 0);

const schemas = {
  roleParams: z.object({ roleId: id }),
  mapParams: z.object({ mapId: id }),
  dimensionParams: z.object({ mapId: id, dimensionId: id }),
  capabilityParams: z.object({ mapId: id, capabilityId: id }),
  newDraft: z.object({ copyFrom: id.optional() }).strict(),
  scale: z.object({ levels: z.array(level).max(20) }),
  bonusRules: z.object({ bonusRules: z.array(bonusRule).max(20) }),
  dimension,
  dimensionChange: changed({
    name: text(120),
    description: z.string().trim().max(2000),
    kind: z.enum(DIMENSION_KINDS),
    position,
  }),
  capability,
  capabilityChange: changed({
    statement: text(500),
    difficulty: z.enum(DIFFICULTIES).nullable(),
    toolIds: z.array(id).max(50),
    objectiveIds: z.array(id).max(50),
    position,
    dimensionId: id,
  }),
  importFile: z.object({
    format: z.literal('potencializador.capability-map/v1'),
    scale: z.array(level).max(20),
    bonusRules: z.array(bonusRule).max(20).default([]),
    dimensions: z
      .array(
        dimension.extend({
          capabilities: z
            .array(
              z.object({
                statement: text(500),
                difficulty: z.enum(DIFFICULTIES).nullable().default(null),
                tools: z.array(text(160)).max(50).default([]),
                objectives: z.array(text(160)).max(50).default([]),
                // Kept in the file for programs (next increment); not stored in the map.
                prioritized: z.boolean().optional(),
              }),
            )
            .max(200),
        }),
      )
      .max(50)
      // A map larger than this is not a map of one role; it also bounds the work of one request.
      .refine((items) => items.reduce((total, item) => total + item.capabilities.length, 0) <= MAX_CAPABILITIES),
  }),
};

type Store = ReturnType<typeof createMapStore>;

/** A role holds one draft at a time (index of migration 0003); other errors pass through. */
const asDraftExists = (error: unknown) =>
  postgresConstraint(error) === 'capability_maps_one_draft_per_role'
    ? new Refusal(409, { error: 'draft_exists' })
    : error;

/**
 * Capability maps of a role. The domain rules decide what each state accepts
 * (`canApplyChange`, `canTransition`); the database guard of migration 0003 refuses the
 * same changes again, so a mistake here cannot break invariant 10.
 */
export async function registerMaps(api: FastifyInstance, options: { database: Database }): Promise<void> {
  const db = options.database;
  const { requireOrganization } = createOrganizationAccess(db);

  /**
   * Authorizes, parses, and runs `work` in one transaction scoped to the organization.
   * Refusals become answers; a refusal from the invariant 10 guard becomes `map_frozen`.
   */
  const handle =
    <P, B>(
      policy: OrganizationPolicy,
      parse: { params?: z.ZodType<P>; body?: z.ZodType<B> },
      work: (store: Store, input: { params: P; body: B }) => Promise<{ status?: number; body?: unknown }>,
    ) =>
    async (request: FastifyRequest, reply: FastifyReply) => {
      const access = await requireOrganization(request, reply, policy);
      if (access === null) return reply;
      const params = parse.params ? parse.params.safeParse(request.params) : { success: true as const, data: undefined };
      const body = parse.body ? parse.body.safeParse(request.body ?? {}) : { success: true as const, data: undefined };
      if (!params.success || !body.success) return reply.code(400).send({ error: 'invalid_request' });
      try {
        const result = await withScope(db, access.scope, (tx) =>
          work(createMapStore(tx, access.organizationId), { params: params.data as P, body: body.data as B }),
        );
        reply.code(result.status ?? 200);
        return result.body === undefined ? reply.send() : reply.send(result.body);
      } catch (error) {
        if (error instanceof Refusal) return reply.code(error.status).send(error.body);
        const code = postgresCode(error);
        if (code === INVARIANT_10_VIOLATION) return reply.code(409).send({ error: 'map_frozen' });
        if (code === UNIQUE_VIOLATION && NAME_CONSTRAINTS.has(postgresConstraint(error) ?? '')) {
          return reply.code(409).send({ error: 'name_taken' });
        }
        throw error;
      }
    };

  /** The map, if its state accepts `change` (invariant 10). */
  const editable = async (store: Store, mapId: string, change: MapChange): Promise<MapHeader> => {
    const header = await store.header(mapId);
    if (!canApplyChange(header.status, change)) throw new Refusal(409, { error: 'map_frozen' });
    return header;
  };

  const transition = async (store: Store, mapId: string, to: MapStatus) => {
    const header = await store.header(mapId);
    if (!canTransition(header.status, to)) throw new Refusal(409, { error: 'invalid_transition' });
    if (to === 'published') {
      const obstacles = publishObstacles(await store.outline(mapId));
      if (obstacles.length) throw new Refusal(422, { error: 'cannot_publish', obstacles });
    }
    await store.setStatus(mapId, to);
    return { body: await store.read(await store.header(mapId)) };
  };

  const base = '/organizations/:organizationId';

  api.get(
    `${base}/roles/:roleId/maps`,
    handle(canReadOrganization, { params: schemas.roleParams }, async (store, { params }) => ({
      body: { maps: await store.listVersions(params.roleId) },
    })),
  );

  api.post(
    `${base}/roles/:roleId/maps`,
    handle(canDesignMaps, { params: schemas.roleParams, body: schemas.newDraft }, async (store, { params, body }) => {
      let source: MapHeader | undefined;
      if (body.copyFrom !== undefined) {
        source = await store.header(body.copyFrom);
        if (source.roleId !== params.roleId || !canStartNewVersionFrom(source.status)) {
          throw new Refusal(409, { error: 'invalid_source' });
        }
      }
      try {
        return { status: 201, body: await store.createDraft(params.roleId, source) };
      } catch (error) {
        throw asDraftExists(error);
      }
    }),
  );

  api.post(
    `${base}/roles/:roleId/maps/import`,
    handle(canDesignMaps, { params: schemas.roleParams, body: schemas.importFile }, async (store, { params, body }) => {
      let draft: MapHeader;
      try {
        draft = await store.createDraft(params.roleId);
      } catch (error) {
        throw asDraftExists(error);
      }
      const all = body.dimensions.flatMap((item) => item.capabilities);
      const toolIds = await store.catalogIds('tools', all.flatMap((item) => item.tools));
      const objectiveIds = await store.catalogIds('objectives', all.flatMap((item) => item.objectives));
      await store.replaceScale(draft.id, body.scale);
      await store.replaceBonusRules(draft.id, body.bonusRules);
      for (const { capabilities, ...fields } of body.dimensions) {
        const dimensionId = await store.addDimension(draft.id, fields);
        for (const item of capabilities) {
          await store.addCapability(dimensionId, {
            statement: item.statement,
            difficulty: item.difficulty,
            toolIds: item.tools.map((name) => toolIds.get(name)!),
            objectiveIds: item.objectives.map((name) => objectiveIds.get(name)!),
          });
        }
      }
      return { status: 201, body: draft };
    }),
  );

  api.get(
    `${base}/maps/:mapId`,
    handle(canReadOrganization, { params: schemas.mapParams }, async (store, { params }) => ({
      body: await store.read(await store.header(params.mapId)),
    })),
  );

  api.delete(
    `${base}/maps/:mapId`,
    handle(canDesignMaps, { params: schemas.mapParams }, async (store, { params }) => {
      const header = await store.header(params.mapId);
      // Only a draft can be discarded; anything else is frozen.
      if (header.status !== 'draft') throw new Refusal(409, { error: 'map_frozen' });
      await store.discard(params.mapId);
      return { status: 204 };
    }),
  );

  api.post(
    `${base}/maps/:mapId/publish`,
    handle(canDesignMaps, { params: schemas.mapParams }, (store, { params }) =>
      transition(store, params.mapId, 'published'),
    ),
  );

  api.post(
    `${base}/maps/:mapId/archive`,
    handle(canDesignMaps, { params: schemas.mapParams }, (store, { params }) =>
      transition(store, params.mapId, 'archived'),
    ),
  );

  api.put(
    `${base}/maps/:mapId/scale`,
    handle(canDesignMaps, { params: schemas.mapParams, body: schemas.scale }, async (store, { params, body }) => {
      await editable(store, params.mapId, 'change_scale');
      await store.replaceScale(params.mapId, body.levels);
      return { body: (await store.read(await store.header(params.mapId))).levels };
    }),
  );

  api.put(
    `${base}/maps/:mapId/bonus-rules`,
    handle(canDesignMaps, { params: schemas.mapParams, body: schemas.bonusRules }, async (store, { params, body }) => {
      await editable(store, params.mapId, 'change_bonus_rules');
      await store.replaceBonusRules(params.mapId, body.bonusRules);
      return { body: (await store.read(await store.header(params.mapId))).bonusRules };
    }),
  );

  api.post(
    `${base}/maps/:mapId/dimensions`,
    handle(canDesignMaps, { params: schemas.mapParams, body: schemas.dimension }, async (store, { params, body }) => {
      await editable(store, params.mapId, 'add_dimension');
      const dimensionId = await store.addDimension(params.mapId, body);
      return { status: 201, body: { id: dimensionId } };
    }),
  );

  api.patch(
    `${base}/maps/:mapId/dimensions/:dimensionId`,
    handle(
      canDesignMaps,
      { params: schemas.dimensionParams, body: schemas.dimensionChange },
      async (store, { params, body }) => {
        await editable(store, params.mapId, 'change_dimension');
        await store.changeDimension(params.mapId, params.dimensionId, body);
        return { body: { id: params.dimensionId } };
      },
    ),
  );

  api.delete(
    `${base}/maps/:mapId/dimensions/:dimensionId`,
    handle(canDesignMaps, { params: schemas.dimensionParams }, async (store, { params }) => {
      await editable(store, params.mapId, 'remove_dimension');
      await store.removeDimension(params.mapId, params.dimensionId);
      return { status: 204 };
    }),
  );

  api.post(
    `${base}/maps/:mapId/dimensions/:dimensionId/capabilities`,
    handle(canDesignMaps, { params: schemas.dimensionParams, body: schemas.capability }, async (store, { params, body }) => {
      await editable(store, params.mapId, 'add_capability');
      const capabilityId = await store.addCapabilityToMap(params.mapId, params.dimensionId, body);
      return { status: 201, body: { id: capabilityId } };
    }),
  );

  api.patch(
    `${base}/maps/:mapId/capabilities/:capabilityId`,
    handle(
      canDesignMaps,
      { params: schemas.capabilityParams, body: schemas.capabilityChange },
      async (store, { params, body }) => {
        await editable(store, params.mapId, 'change_capability');
        await store.changeCapability(params.mapId, params.capabilityId, body);
        return { body: { id: params.capabilityId } };
      },
    ),
  );

  api.delete(
    `${base}/maps/:mapId/capabilities/:capabilityId`,
    handle(canDesignMaps, { params: schemas.capabilityParams }, async (store, { params }) => {
      await editable(store, params.mapId, 'remove_capability');
      await store.removeCapability(params.mapId, params.capabilityId);
      return { status: 204 };
    }),
  );
}
