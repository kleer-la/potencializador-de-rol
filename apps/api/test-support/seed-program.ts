import { randomUUID } from 'node:crypto';
import type pg from 'pg';
import { seedMap } from './seed-map.ts';

export type SeededProgram = {
  organizationId: string;
  mapId: string;
  levelIds: string[];
  capabilityIds: string[];
  programId: string;
};

/**
 * Seeds, through the owner connection, a published map with three capabilities and two
 * levels, and a program on it whose base selection is the first two capabilities.
 */
export async function seedProgram(ownerPool: pg.Pool, organizationId: string): Promise<SeededProgram> {
  const map = await seedMap(ownerPool, organizationId, 'draft');
  const insert = async (statement: string, values: unknown[]) =>
    (await ownerPool.query<{ id: string }>(`${statement} returning id`, values)).rows[0]!.id;

  const secondLevel = await insert(
    "insert into levels (organization_id, map_id, position, name, multiplier) values ($1, $2, 1, 'Principiante', 1)",
    [organizationId, map.mapId],
  );
  const second = await insert(
    "insert into capabilities (organization_id, dimension_id, position, statement) values ($1, $2, 1, 'Lee el estado del producto')",
    [organizationId, map.dimensionId],
  );
  const third = await insert(
    "insert into capabilities (organization_id, dimension_id, position, statement) values ($1, $2, 2, 'Mantiene un backlog ordenado')",
    [organizationId, map.dimensionId],
  );
  await ownerPool.query("update capability_maps set status = 'published' where id = $1", [map.mapId]);

  const programId = await insert(
    'insert into programs (organization_id, map_id, name, starts_on, ends_on) values ($1, $2, $3, $4, $5)',
    [organizationId, map.mapId, `Programa ${randomUUID().slice(0, 8)}`, '2026-11-15', '2027-05-15'],
  );
  const capabilityIds = [map.capabilityId, second, third];
  for (const capabilityId of capabilityIds.slice(0, 2)) {
    await ownerPool.query(
      'insert into program_capabilities (organization_id, program_id, capability_id) values ($1, $2, $3)',
      [organizationId, programId, capabilityId],
    );
  }
  return { organizationId, mapId: map.mapId, levelIds: [map.levelId, secondLevel], capabilityIds, programId };
}

/** Enrolls a person in a program with one role, through the owner connection. */
export async function enroll(
  ownerPool: pg.Pool,
  program: SeededProgram,
  personId: string,
  role: 'participant' | 'leader' | 'specialist' | 'mentor',
): Promise<string> {
  return (
    await ownerPool.query<{ id: string }>(
      'insert into enrollments (organization_id, program_id, person_id, role) values ($1, $2, $3, $4) returning id',
      [program.organizationId, program.programId, personId, role],
    )
  ).rows[0]!.id;
}
