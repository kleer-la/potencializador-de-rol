import { randomUUID } from 'node:crypto';
import type pg from 'pg';

export type SeededMap = {
  roleId: string;
  mapId: string;
  levelId: string;
  dimensionId: string;
  capabilityId: string;
  toolId: string;
  objectiveId: string;
  bonusRuleId: string;
};

/**
 * Seeds, through the owner connection, a role with a small complete map: one level, one
 * dimension with one capability linked to a tool and an objective, and one bonus rule.
 * The map is left in the requested state by walking the real transitions.
 */
export async function seedMap(
  ownerPool: pg.Pool,
  organizationId: string,
  status: 'draft' | 'published' | 'archived',
): Promise<SeededMap> {
  const insert = async (statement: string, values: unknown[]) =>
    (await ownerPool.query<{ id: string }>(`${statement} returning id`, values)).rows[0]!.id;

  const roleId = await insert('insert into roles (organization_id, name) values ($1, $2)', [
    organizationId,
    `Role ${randomUUID()}`,
  ]);
  const mapId = await insert(
    'insert into capability_maps (organization_id, role_id, version) values ($1, $2, 1)',
    [organizationId, roleId],
  );
  const levelId = await insert(
    'insert into levels (organization_id, map_id, position, name, multiplier) values ($1, $2, 0, $3, 0)',
    [organizationId, mapId, 'No sabe'],
  );
  const dimensionId = await insert(
    "insert into dimensions (organization_id, map_id, position, name, kind) values ($1, $2, 0, 'Entender', 'work_cycle')",
    [organizationId, mapId],
  );
  const capabilityId = await insert(
    'insert into capabilities (organization_id, dimension_id, position, statement) values ($1, $2, 0, $3)',
    [organizationId, dimensionId, 'Identifica a quién sirve el producto'],
  );
  const toolId = await insert('insert into tools (organization_id, name) values ($1, $2)', [
    organizationId,
    `Tool ${randomUUID()}`,
  ]);
  const objectiveId = await insert('insert into strategic_objectives (organization_id, name) values ($1, $2)', [
    organizationId,
    `Objective ${randomUUID()}`,
  ]);
  await ownerPool.query(
    'insert into capability_tools (organization_id, capability_id, tool_id) values ($1, $2, $3)',
    [organizationId, capabilityId, toolId],
  );
  await ownerPool.query(
    'insert into capability_objectives (organization_id, capability_id, objective_id) values ($1, $2, $3)',
    [organizationId, capabilityId, objectiveId],
  );
  const bonusRuleId = await insert(
    'insert into bonus_rules (organization_id, map_id, name, extra_points, condition) values ($1, $2, $3, 1, $4)',
    [organizationId, mapId, 'Plus por IA', 'Usó IA y transfirió la práctica'],
  );

  if (status !== 'draft') {
    await ownerPool.query("update capability_maps set status = 'published' where id = $1", [mapId]);
  }
  if (status === 'archived') {
    await ownerPool.query("update capability_maps set status = 'archived' where id = $1", [mapId]);
  }
  return { roleId, mapId, levelId, dimensionId, capabilityId, toolId, objectiveId, bonusRuleId };
}
