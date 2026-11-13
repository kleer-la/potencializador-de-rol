import type { Difficulty, DimensionKind, MapStatus } from '@potencializador/domain';
import { and, asc, count, eq, inArray, max, sql } from 'drizzle-orm';
import {
  bonusRules,
  capabilities,
  capabilityMaps,
  capabilityObjectives,
  capabilityTools,
  dimensions,
  levels,
  roles,
  strategicObjectives,
  tools,
} from '../infrastructure/schema.ts';
import type { ScopedTransaction } from '../infrastructure/scoped-transaction.ts';

/** A refusal decided while working; the route turns it into the answer. */
export class Refusal extends Error {
  readonly status: number;
  readonly body: Record<string, unknown>;

  constructor(status: number, body: Record<string, unknown>) {
    super(String(body.error));
    this.status = status;
    this.body = body;
  }
}

export type LevelInput = { name: string; description: string; multiplier: number; requiresTransfer: boolean };
export type BonusRuleInput = { name: string; extraPoints: number; condition: string };
export type DimensionInput = { name: string; description: string; kind: DimensionKind };
export type CapabilityInput = {
  statement: string;
  difficulty: Difficulty | null;
  toolIds: string[];
  objectiveIds: string[];
};

export type MapHeader = {
  id: string;
  roleId: string;
  version: number;
  status: MapStatus;
  createdAt: Date;
  publishedAt: Date | null;
  archivedAt: Date | null;
};

const headerColumns = {
  id: capabilityMaps.id,
  roleId: capabilityMaps.roleId,
  version: capabilityMaps.version,
  status: capabilityMaps.status,
  createdAt: capabilityMaps.createdAt,
  publishedAt: capabilityMaps.publishedAt,
  archivedAt: capabilityMaps.archivedAt,
};

/**
 * Data access of capability maps. Every lookup filters by organization explicitly: Row
 * Level Security lets a super administrator see every organization, and a map must only
 * be reachable through the organization that owns it.
 */
export function createMapStore(tx: ScopedTransaction, organizationId: string) {
  const inOrganization = <T extends { organizationId: never }>(table: T) =>
    eq((table as unknown as typeof roles).organizationId, organizationId);

  /** The role, locked: versions of one role are created one at a time. */
  const requireRole = async (roleId: string) => {
    const [role] = await tx
      .select({ id: roles.id })
      .from(roles)
      .where(and(eq(roles.id, roleId), inOrganization(roles as never)))
      .for('update');
    if (role === undefined) throw new Refusal(404, { error: 'not_found' });
  };

  const header = async (mapId: string): Promise<MapHeader> => {
    const [found] = await tx
      .select(headerColumns)
      .from(capabilityMaps)
      .where(and(eq(capabilityMaps.id, mapId), inOrganization(capabilityMaps as never)))
      // Serializes concurrent changes to one map, such as publishing while editing.
      .for('update');
    if (found === undefined) throw new Refusal(404, { error: 'not_found' });
    return found;
  };

  /** The ids that exist in the organization's catalog, or a refusal naming none of them. */
  const requireReferences = async (toolIds: string[], objectiveIds: string[]) => {
    const unique = (ids: string[]) => [...new Set(ids)];
    const [foundTools] = toolIds.length
      ? await tx
          .select({ total: count() })
          .from(tools)
          .where(and(inArray(tools.id, unique(toolIds)), inOrganization(tools as never)))
      : [{ total: 0 }];
    const [foundObjectives] = objectiveIds.length
      ? await tx
          .select({ total: count() })
          .from(strategicObjectives)
          .where(and(inArray(strategicObjectives.id, unique(objectiveIds)), inOrganization(strategicObjectives as never)))
      : [{ total: 0 }];
    if (foundTools!.total !== unique(toolIds).length || foundObjectives!.total !== unique(objectiveIds).length) {
      throw new Refusal(400, { error: 'unknown_reference' });
    }
  };

  const link = async (capabilityId: string, toolIds: string[], objectiveIds: string[]) => {
    const toolRows = [...new Set(toolIds)].map((toolId) => ({ organizationId, capabilityId, toolId }));
    const objectiveRows = [...new Set(objectiveIds)].map((objectiveId) => ({ organizationId, capabilityId, objectiveId }));
    if (toolRows.length) await tx.insert(capabilityTools).values(toolRows);
    if (objectiveRows.length) await tx.insert(capabilityObjectives).values(objectiveRows);
  };

  const dimensionOf = async (mapId: string, dimensionId: string) => {
    const [found] = await tx
      .select({ id: dimensions.id })
      .from(dimensions)
      .where(and(eq(dimensions.id, dimensionId), eq(dimensions.mapId, mapId)));
    if (found === undefined) throw new Refusal(404, { error: 'not_found' });
    return found.id;
  };

  const capabilityOf = async (mapId: string, capabilityId: string) => {
    const [found] = await tx
      .select({ id: capabilities.id, dimensionId: capabilities.dimensionId })
      .from(capabilities)
      .innerJoin(dimensions, eq(dimensions.id, capabilities.dimensionId))
      .where(and(eq(capabilities.id, capabilityId), eq(dimensions.mapId, mapId)));
    if (found === undefined) throw new Refusal(404, { error: 'not_found' });
    return found;
  };

  /** Rewrites positions 0..n-1 in the given order. Positions are deferred unique constraints. */
  const renumber = async (table: typeof dimensions | typeof capabilities, orderedIds: string[]) => {
    for (const [position, id] of orderedIds.entries()) {
      await tx.update(table).set({ position }).where(eq(table.id, id));
    }
  };

  const dimensionIds = async (mapId: string) =>
    (
      await tx
        .select({ id: dimensions.id })
        .from(dimensions)
        .where(eq(dimensions.mapId, mapId))
        .orderBy(asc(dimensions.position))
    ).map((row) => row.id);

  const capabilityIds = async (dimensionId: string) =>
    (
      await tx
        .select({ id: capabilities.id })
        .from(capabilities)
        .where(eq(capabilities.dimensionId, dimensionId))
        .orderBy(asc(capabilities.position))
    ).map((row) => row.id);

  /** `ids` with `id` moved to `position`, clamped to the list. */
  const moved = (ids: string[], id: string, position: number) => {
    const rest = ids.filter((candidate) => candidate !== id);
    rest.splice(Math.min(Math.max(position, 0), rest.length), 0, id);
    return rest;
  };

  const store = {
    requireRole,
    header,

    async listVersions(roleId: string) {
      await requireRole(roleId);
      return tx
        .select(headerColumns)
        .from(capabilityMaps)
        .where(and(eq(capabilityMaps.roleId, roleId), inOrganization(capabilityMaps as never)))
        .orderBy(asc(capabilityMaps.version));
    },

    /** A new draft: empty, or a copy of `copyFrom`. One draft per role is a database rule. */
    async createDraft(roleId: string, copyFrom?: MapHeader): Promise<MapHeader> {
      await requireRole(roleId);
      const [latest] = await tx
        .select({ version: max(capabilityMaps.version) })
        .from(capabilityMaps)
        .where(eq(capabilityMaps.roleId, roleId));
      const [created] = await tx
        .insert(capabilityMaps)
        .values({ organizationId, roleId, version: (latest?.version ?? 0) + 1 })
        .returning(headerColumns);
      if (copyFrom !== undefined) await store.copyContent(copyFrom.id, created!.id);
      return created!;
    },

    async copyContent(fromMapId: string, toMapId: string) {
      const source = await store.read(await store.header(fromMapId));
      await store.replaceScale(toMapId, source.levels);
      await store.replaceBonusRules(toMapId, source.bonusRules);
      for (const dimension of source.dimensions) {
        const dimensionId = await store.addDimension(toMapId, dimension);
        for (const capability of dimension.capabilities) {
          await store.addCapability(dimensionId, capability);
        }
      }
    },

    async read(mapHeader: MapHeader) {
      const mapId = mapHeader.id;
      const levelRows = await tx
        .select()
        .from(levels)
        .where(eq(levels.mapId, mapId))
        .orderBy(asc(levels.position));
      const ruleRows = await tx
        .select()
        .from(bonusRules)
        .where(eq(bonusRules.mapId, mapId))
        .orderBy(asc(bonusRules.createdAt), asc(bonusRules.name));
      const dimensionRows = await tx
        .select()
        .from(dimensions)
        .where(eq(dimensions.mapId, mapId))
        .orderBy(asc(dimensions.position));
      const capabilityRows = await tx
        .select({
          id: capabilities.id,
          dimensionId: capabilities.dimensionId,
          position: capabilities.position,
          statement: capabilities.statement,
          difficulty: capabilities.difficulty,
        })
        .from(capabilities)
        .innerJoin(dimensions, eq(dimensions.id, capabilities.dimensionId))
        .where(eq(dimensions.mapId, mapId))
        .orderBy(asc(capabilities.position));
      const ids = capabilityRows.map((row) => row.id);
      const toolLinks = ids.length
        ? await tx
            .select({ capabilityId: capabilityTools.capabilityId, toolId: capabilityTools.toolId })
            .from(capabilityTools)
            .innerJoin(tools, eq(tools.id, capabilityTools.toolId))
            .where(inArray(capabilityTools.capabilityId, ids))
            .orderBy(asc(tools.name))
        : [];
      const objectiveLinks = ids.length
        ? await tx
            .select({ capabilityId: capabilityObjectives.capabilityId, objectiveId: capabilityObjectives.objectiveId })
            .from(capabilityObjectives)
            .innerJoin(strategicObjectives, eq(strategicObjectives.id, capabilityObjectives.objectiveId))
            .where(inArray(capabilityObjectives.capabilityId, ids))
            .orderBy(asc(strategicObjectives.name))
        : [];

      return {
        ...mapHeader,
        levels: levelRows.map((level) => ({
          id: level.id,
          position: level.position,
          name: level.name,
          description: level.description,
          multiplier: Number(level.multiplier),
          requiresTransfer: level.requiresTransfer,
        })),
        bonusRules: ruleRows.map((rule) => ({
          id: rule.id,
          name: rule.name,
          extraPoints: Number(rule.extraPoints),
          condition: rule.condition,
        })),
        dimensions: dimensionRows.map((dimension) => ({
          id: dimension.id,
          position: dimension.position,
          name: dimension.name,
          description: dimension.description,
          kind: dimension.kind,
          capabilities: capabilityRows
            .filter((capability) => capability.dimensionId === dimension.id)
            .map((capability) => ({
              id: capability.id,
              position: capability.position,
              statement: capability.statement,
              difficulty: capability.difficulty,
              toolIds: toolLinks.filter((row) => row.capabilityId === capability.id).map((row) => row.toolId),
              objectiveIds: objectiveLinks
                .filter((row) => row.capabilityId === capability.id)
                .map((row) => row.objectiveId),
            })),
        })),
      };
    },

    /** Counts that decide whether a draft can be published. */
    async outline(mapId: string) {
      const [levelCount] = await tx.select({ total: count() }).from(levels).where(eq(levels.mapId, mapId));
      const rows = await tx
        .select({ name: dimensions.name, capabilityCount: count(capabilities.id) })
        .from(dimensions)
        .leftJoin(capabilities, eq(capabilities.dimensionId, dimensions.id))
        .where(eq(dimensions.mapId, mapId))
        .groupBy(dimensions.id, dimensions.name, dimensions.position)
        .orderBy(asc(dimensions.position));
      return { levelCount: levelCount!.total, dimensions: rows };
    },

    async setStatus(mapId: string, status: MapStatus) {
      await tx.update(capabilityMaps).set({ status }).where(eq(capabilityMaps.id, mapId));
    },

    async discard(mapId: string) {
      await tx.delete(capabilityMaps).where(eq(capabilityMaps.id, mapId));
    },

    async replaceScale(mapId: string, input: LevelInput[]) {
      await tx.delete(levels).where(eq(levels.mapId, mapId));
      if (input.length === 0) return;
      await tx.insert(levels).values(
        input.map((level, position) => ({
          organizationId,
          mapId,
          position,
          name: level.name,
          description: level.description,
          multiplier: String(level.multiplier),
          requiresTransfer: level.requiresTransfer,
        })),
      );
    },

    async replaceBonusRules(mapId: string, input: BonusRuleInput[]) {
      await tx.delete(bonusRules).where(eq(bonusRules.mapId, mapId));
      // One by one, so creation order keeps the order of the input.
      for (const rule of input) {
        await tx.insert(bonusRules).values({
          organizationId,
          mapId,
          name: rule.name,
          extraPoints: String(rule.extraPoints),
          condition: rule.condition,
          createdAt: sql`clock_timestamp()`,
        });
      }
    },

    async addDimension(mapId: string, input: DimensionInput): Promise<string> {
      const position = (await dimensionIds(mapId)).length;
      const [created] = await tx
        .insert(dimensions)
        .values({ organizationId, mapId, position, name: input.name, description: input.description, kind: input.kind })
        .returning({ id: dimensions.id });
      return created!.id;
    },

    async changeDimension(mapId: string, dimensionId: string, input: Partial<DimensionInput> & { position?: number }) {
      await dimensionOf(mapId, dimensionId);
      const { position, ...fields } = input;
      if (Object.keys(fields).length) {
        await tx.update(dimensions).set(fields).where(eq(dimensions.id, dimensionId));
      }
      if (position !== undefined) await renumber(dimensions, moved(await dimensionIds(mapId), dimensionId, position));
    },

    async removeDimension(mapId: string, dimensionId: string) {
      await dimensionOf(mapId, dimensionId);
      await tx.delete(dimensions).where(eq(dimensions.id, dimensionId));
      await renumber(dimensions, await dimensionIds(mapId));
    },

    async addCapabilityToMap(mapId: string, dimensionId: string, input: CapabilityInput): Promise<string> {
      await dimensionOf(mapId, dimensionId);
      return store.addCapability(dimensionId, input);
    },

    async addCapability(dimensionId: string, input: CapabilityInput): Promise<string> {
      await requireReferences(input.toolIds, input.objectiveIds);
      const position = (await capabilityIds(dimensionId)).length;
      const [created] = await tx
        .insert(capabilities)
        .values({ organizationId, dimensionId, position, statement: input.statement, difficulty: input.difficulty })
        .returning({ id: capabilities.id });
      await link(created!.id, input.toolIds, input.objectiveIds);
      return created!.id;
    },

    async changeCapability(
      mapId: string,
      capabilityId: string,
      input: Partial<CapabilityInput> & { position?: number; dimensionId?: string },
    ) {
      const current = await capabilityOf(mapId, capabilityId);
      const { toolIds, objectiveIds, position, dimensionId, ...fields } = input;
      await requireReferences(toolIds ?? [], objectiveIds ?? []);
      if (Object.keys(fields).length) {
        await tx.update(capabilities).set(fields).where(eq(capabilities.id, capabilityId));
      }
      if (toolIds !== undefined) {
        await tx.delete(capabilityTools).where(eq(capabilityTools.capabilityId, capabilityId));
        await link(capabilityId, toolIds, []);
      }
      if (objectiveIds !== undefined) {
        await tx.delete(capabilityObjectives).where(eq(capabilityObjectives.capabilityId, capabilityId));
        await link(capabilityId, [], objectiveIds);
      }
      const target = dimensionId === undefined ? current.dimensionId : await dimensionOf(mapId, dimensionId);
      if (target !== current.dimensionId) {
        await tx.update(capabilities).set({ dimensionId: target }).where(eq(capabilities.id, capabilityId));
        await renumber(capabilities, await capabilityIds(current.dimensionId));
      }
      if (target !== current.dimensionId || position !== undefined) {
        const ids = await capabilityIds(target);
        await renumber(capabilities, moved(ids, capabilityId, position ?? ids.length));
      }
    },

    async removeCapability(mapId: string, capabilityId: string) {
      const current = await capabilityOf(mapId, capabilityId);
      await tx.delete(capabilities).where(eq(capabilities.id, capabilityId));
      await renumber(capabilities, await capabilityIds(current.dimensionId));
    },

    /**
     * Ids of catalog entries with the given names, keyed by each name as given, creating the
     * missing ones. Names match ignoring case the way PostgreSQL lowercases them, as the
     * catalogs' unique indexes do; JavaScript lowercasing differs for some letters.
     */
    async catalogIds(kind: 'tools' | 'objectives', names: string[]): Promise<Map<string, string>> {
      const table = kind === 'tools' ? tools : strategicObjectives;
      const ids = new Map<string, string>();
      const unique = [...new Set(names)];
      if (unique.length === 0) return ids;
      const keyed = (
        await tx.execute<{ name: string; key: string }>(
          sql`select n as name, lower(n) as key from unnest(array[${sql.join(
            unique.map((name) => sql`${name}`),
            sql`, `,
          )}]::text[]) as n`,
        )
      ).rows;
      // First spelling of each name wins; one insert and one select for all of them.
      const firstSpelling = new Map<string, string>();
      for (const row of keyed) if (!firstSpelling.has(row.key)) firstSpelling.set(row.key, row.name);
      await tx
        .insert(table)
        .values([...firstSpelling.values()].map((name) => ({ organizationId, name })))
        .onConflictDoNothing();
      const found = await tx
        .select({ id: table.id, key: sql<string>`lower(${table.name})` })
        .from(table)
        .where(and(inOrganization(table as never), inArray(sql`lower(${table.name})`, [...firstSpelling.keys()])));
      const idByKey = new Map(found.map((row) => [row.key, row.id]));
      for (const row of keyed) ids.set(row.name, idByKey.get(row.key)!);
      return ids;
    },
  };
  return store;
}
