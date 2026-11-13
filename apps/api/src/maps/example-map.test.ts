import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { createSeeder } from '../../test-support/seed.ts';
import { createSignedInApp, TEST_PUBLIC_URL } from '../../test-support/signed-in-app.ts';

const EXAMPLE = new URL('../../../../data/maps/product-owner.json', import.meta.url);

type ExampleFile = {
  dimensions: { name: string; kind: string; capabilities: { statement: string; prioritized?: boolean }[] }[];
};

describe('Product Owner example map', () => {
  let ownerPool: pg.Pool;
  let appPool: pg.Pool;
  let app: FastifyInstance;
  let organizationId: string;
  let session: string;
  let example: ExampleFile;

  const call = (method: 'GET' | 'POST', url: string, body?: unknown) =>
    app.inject({
      method,
      url: `/api/organizations/${organizationId}/${url}`,
      cookies: { session },
      headers: method === 'GET' ? {} : { origin: TEST_PUBLIC_URL.origin },
      ...(body === undefined ? {} : { payload: body as Record<string, unknown> }),
    });

  beforeAll(async () => {
    example = JSON.parse(await readFile(EXAMPLE, 'utf8')) as ExampleFile;
    ownerPool = new pg.Pool({ connectionString: inject('ownerDatabaseUrl') });
    appPool = new pg.Pool({ connectionString: inject('appDatabaseUrl') });
    const signedIn = createSignedInApp(appPool);
    app = signedIn.app;
    const seed = createSeeder(ownerPool);
    organizationId = await seed.organization();
    const designer = await seed.person(organizationId);
    // Administrator to create the role, map designer to import and publish.
    await seed.membership(organizationId, designer, 'administrator');
    await seed.membership(organizationId, designer, 'map_designer');
    const email = (await ownerPool.query('select email from persons where id = $1', [designer])).rows[0].email;
    session = await signedIn.signInAs(email);
  });

  afterAll(async () => {
    await app.close();
    await appPool.end();
    await ownerPool.end();
  });

  it('holds the 9 dimensions and 55 capabilities of the attached map, 15 of them prioritized', () => {
    expect(example.dimensions.map((dimension) => [dimension.name, dimension.kind, dimension.capabilities.length])).toEqual([
      ['Entender', 'work_cycle', 7],
      ['Descubrir', 'work_cycle', 10],
      ['Priorizar', 'work_cycle', 6],
      ['Crear', 'work_cycle', 6],
      ['Adaptar / Impactar', 'work_cycle', 7],
      ['Autonomía', 'transversal', 6],
      ['Liderazgo', 'transversal', 3],
      ['Complejidad de problemas', 'transversal', 4],
      ['Comunicación', 'transversal', 6],
    ]);
    const prioritized = example.dimensions.flatMap((dimension) =>
      dimension.capabilities.filter((capability) => capability.prioritized),
    );
    expect(prioritized).toHaveLength(15);
  });

  it('imports into a role as a draft that can be published as it is', async () => {
    const role = await call('POST', 'roles', { name: `Product Owner ${randomUUID().slice(0, 8)}` });
    expect(role.statusCode, role.body).toBe(201);
    const imported = await call('POST', `roles/${role.json().id}/maps/import`, example);
    const published = await call('POST', `maps/${imported.json().id}/publish`);
    const map = published.json();

    expect(imported.statusCode, imported.body).toBe(201);
    expect(published.statusCode, published.body).toBe(200);
    expect(map.levels.map((level: { name: string; multiplier: number }) => [level.name, level.multiplier])).toEqual([
      ['No sabe', 0],
      ['Principiante', 1],
      ['En práctica', 2],
      ['Experiencia', 3],
      ['Transferencia', 4],
    ]);
    expect(map.levels[4].requiresTransfer).toBe(true);
    expect(map.bonusRules).toEqual([expect.objectContaining({ name: 'Plus por IA con transferencia', extraPoints: 1 })]);
    const statements = map.dimensions.flatMap((dimension: { capabilities: { statement: string }[] }) =>
      dimension.capabilities.map((capability) => capability.statement),
    );
    expect(statements).toEqual(example.dimensions.flatMap((dimension) => dimension.capabilities.map((c) => c.statement)));
    const tools = (await call('GET', 'tools')).json().items;
    expect(tools.length).toBeGreaterThan(100);
  });
});
