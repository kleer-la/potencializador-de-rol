import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { createSeeder } from '../../test-support/seed.ts';
import { createSignedInApp, TEST_PUBLIC_URL } from '../../test-support/signed-in-app.ts';

type Method = 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';

const SCALE = [
  { name: 'No sabe', description: '', multiplier: 0, requiresTransfer: false },
  { name: 'Principiante', description: '', multiplier: 1, requiresTransfer: false },
  { name: 'Transferencia', description: 'Enseña a otros', multiplier: 4, requiresTransfer: true },
];
const BONUS = [{ name: 'Plus por IA', extraPoints: 1, condition: 'Usó IA y transfirió la práctica' }];

describe('capability maps', () => {
  let ownerPool: pg.Pool;
  let appPool: pg.Pool;
  let app: FastifyInstance;
  let organizationA: string;
  let organizationB: string;
  let sessions: { superAdministrator: string; administratorA: string; designerA: string; designerB: string };

  const call = async (session: string, method: Method, url: string, body?: unknown) =>
    app.inject({
      method,
      url: `/api/organizations/${url}`,
      cookies: { session },
      headers: method === 'GET' ? {} : { origin: TEST_PUBLIC_URL.origin },
      ...(body === undefined ? {} : { payload: body as Record<string, unknown> }),
    });
  const asDesigner = (method: Method, url: string, body?: unknown) =>
    call(sessions.designerA, method, `${organizationA}/${url}`, body);
  const ok = async (response: Awaited<ReturnType<typeof call>>, status = 200) => {
    expect(response.statusCode, response.body).toBe(status);
    return response.body === '' ? undefined : response.json();
  };

  const newRole = async () =>
    (
      await ok(
        await call(sessions.administratorA, 'POST', `${organizationA}/roles`, { name: `Rol ${randomUUID()}` }),
        201,
      )
    ).id as string;
  const newTool = async () =>
    (await ok(await asDesigner('POST', 'tools', { name: `Herramienta ${randomUUID()}` }), 201)).id as string;
  const newObjective = async () =>
    (await ok(await asDesigner('POST', 'strategic-objectives', { name: `Objetivo ${randomUUID()}` }), 201))
      .id as string;

  /** A draft with the scale, one bonus rule, and one dimension holding one capability. */
  const completeDraft = async () => {
    const roleId = await newRole();
    const map = await ok(await asDesigner('POST', `roles/${roleId}/maps`, {}), 201);
    await ok(await asDesigner('PUT', `maps/${map.id}/scale`, { levels: SCALE }));
    await ok(await asDesigner('PUT', `maps/${map.id}/bonus-rules`, { bonusRules: BONUS }));
    const dimension = await ok(
      await asDesigner('POST', `maps/${map.id}/dimensions`, { name: 'Entender', kind: 'work_cycle' }),
      201,
    );
    const toolId = await newTool();
    const objectiveId = await newObjective();
    const capability = await ok(
      await asDesigner('POST', `maps/${map.id}/dimensions/${dimension.id}/capabilities`, {
        statement: 'Identifica a quién sirve el producto',
        difficulty: 'medium',
        toolIds: [toolId],
        objectiveIds: [objectiveId],
      }),
      201,
    );
    return { roleId, mapId: map.id as string, dimensionId: dimension.id as string, capabilityId: capability.id as string, toolId, objectiveId };
  };
  const publish = async (mapId: string) => ok(await asDesigner('POST', `maps/${mapId}/publish`));
  const read = async (mapId: string) => ok(await asDesigner('GET', `maps/${mapId}`));

  beforeAll(async () => {
    ownerPool = new pg.Pool({ connectionString: inject('ownerDatabaseUrl') });
    appPool = new pg.Pool({ connectionString: inject('appDatabaseUrl') });
    const signedIn = createSignedInApp(appPool);
    app = signedIn.app;
    const seed = createSeeder(ownerPool);
    const emailOf = async (personId: string) =>
      (await ownerPool.query<{ email: string }>('select email from persons where id = $1', [personId])).rows[0]!
        .email;
    organizationA = await seed.organization();
    organizationB = await seed.organization();
    const superAdministrator = await seed.person(null);
    const administratorA = await seed.person(organizationA);
    const designerA = await seed.person(organizationA);
    const designerB = await seed.person(organizationB);
    await seed.membership(organizationA, administratorA, 'administrator');
    await seed.membership(organizationA, designerA, 'map_designer');
    await seed.membership(organizationB, designerB, 'map_designer');
    sessions = {
      superAdministrator: await signedIn.signInAs(await emailOf(superAdministrator)),
      administratorA: await signedIn.signInAs(await emailOf(administratorA)),
      designerA: await signedIn.signInAs(await emailOf(designerA)),
      designerB: await signedIn.signInAs(await emailOf(designerB)),
    };
  });

  afterAll(async () => {
    await app.close();
    await appPool.end();
    await ownerPool.end();
  });

  describe('designing a draft', () => {
    it('builds a map that reads back with its scale, dimensions, capabilities and bonus rules', async () => {
      const draft = await completeDraft();

      const map = await read(draft.mapId);

      expect(map).toEqual({
        id: draft.mapId,
        roleId: draft.roleId,
        version: 1,
        status: 'draft',
        createdAt: expect.any(String),
        publishedAt: null,
        archivedAt: null,
        levels: SCALE.map((level, position) => ({ id: expect.any(String), position, ...level })),
        bonusRules: BONUS.map((rule) => ({ id: expect.any(String), ...rule })),
        dimensions: [
          {
            id: draft.dimensionId,
            position: 0,
            name: 'Entender',
            description: '',
            kind: 'work_cycle',
            capabilities: [
              {
                id: draft.capabilityId,
                position: 0,
                statement: 'Identifica a quién sirve el producto',
                difficulty: 'medium',
                toolIds: [draft.toolId],
                objectiveIds: [draft.objectiveId],
              },
            ],
          },
        ],
      });
    });

    it('changes, reorders and removes content freely', async () => {
      const draft = await completeDraft();
      const second = await ok(
        await asDesigner('POST', `maps/${draft.mapId}/dimensions`, { name: 'Descubrir', kind: 'work_cycle' }),
        201,
      );

      await ok(await asDesigner('PATCH', `maps/${draft.mapId}/dimensions/${second.id}`, { position: 0 }));
      await ok(
        await asDesigner('PATCH', `maps/${draft.mapId}/capabilities/${draft.capabilityId}`, {
          statement: 'Identifica segmentos',
          difficulty: null,
          toolIds: [],
          dimensionId: second.id,
        }),
      );
      await ok(await asDesigner('DELETE', `maps/${draft.mapId}/dimensions/${draft.dimensionId}`), 204);

      const map = await read(draft.mapId);
      expect(map.dimensions).toEqual([
        expect.objectContaining({
          id: second.id,
          position: 0,
          capabilities: [
            expect.objectContaining({ statement: 'Identifica segmentos', difficulty: null, toolIds: [], position: 0 }),
          ],
        }),
      ]);
    });

    it('refuses a link to a tool or objective that is not in the catalog of the organization', async () => {
      const draft = await completeDraft();
      const toolOfB = (
        await ok(
          await call(sessions.designerB, 'POST', `${organizationB}/tools`, { name: `Ajena ${randomUUID()}` }),
          201,
        )
      ).id;

      const response = await asDesigner('POST', `maps/${draft.mapId}/dimensions/${draft.dimensionId}/capabilities`, {
        statement: 'Con herramienta ajena',
        toolIds: [toolOfB],
      });

      expect(response.statusCode).toBe(400);
      expect(response.json()).toEqual({ error: 'unknown_reference' });
    });

    it('keeps one draft per role and discards it with its content', async () => {
      const draft = await completeDraft();

      const second = await asDesigner('POST', `roles/${draft.roleId}/maps`, {});
      const discarded = await asDesigner('DELETE', `maps/${draft.mapId}`);
      const afterwards = await asDesigner('GET', `maps/${draft.mapId}`);

      expect(second.statusCode).toBe(409);
      expect(second.json()).toEqual({ error: 'draft_exists' });
      expect(discarded.statusCode).toBe(204);
      expect(afterwards.statusCode).toBe(404);
    });
  });

  describe('publishing', () => {
    it('names everything that stops a draft from being published', async () => {
      const roleId = await newRole();
      const map = await ok(await asDesigner('POST', `roles/${roleId}/maps`, {}), 201);
      await ok(await asDesigner('POST', `maps/${map.id}/dimensions`, { name: 'Vacía', kind: 'transversal' }), 201);

      const response = await asDesigner('POST', `maps/${map.id}/publish`);

      expect(response.statusCode).toBe(422);
      expect(response.json()).toEqual({
        error: 'cannot_publish',
        obstacles: [{ kind: 'no_levels' }, { kind: 'dimension_without_capabilities', dimension: 'Vacía' }],
      });
      expect((await read(map.id)).status).toBe('draft');
    });

    it('publishes a complete draft and lists it among the versions of the role', async () => {
      const draft = await completeDraft();

      const published = await publish(draft.mapId);
      const versions = await ok(await asDesigner('GET', `roles/${draft.roleId}/maps`));

      expect(published).toMatchObject({ status: 'published', publishedAt: expect.any(String) });
      expect(versions.maps).toEqual([
        expect.objectContaining({ id: draft.mapId, version: 1, status: 'published' }),
      ]);
    });
  });

  describe('INV-10 a published map only grows', () => {
    it('INV-10 refuses every change or removal of what exists, changing nothing', async () => {
      const draft = await completeDraft();
      await publish(draft.mapId);
      const before = await read(draft.mapId);

      const responses = await Promise.all([
        asDesigner('PATCH', `maps/${draft.mapId}/dimensions/${draft.dimensionId}`, { name: 'Otra' }),
        asDesigner('DELETE', `maps/${draft.mapId}/dimensions/${draft.dimensionId}`),
        asDesigner('PATCH', `maps/${draft.mapId}/capabilities/${draft.capabilityId}`, { statement: 'Otra' }),
        asDesigner('PATCH', `maps/${draft.mapId}/capabilities/${draft.capabilityId}`, { toolIds: [] }),
        asDesigner('DELETE', `maps/${draft.mapId}/capabilities/${draft.capabilityId}`),
        asDesigner('PUT', `maps/${draft.mapId}/scale`, { levels: SCALE.slice(0, 1) }),
        asDesigner('PUT', `maps/${draft.mapId}/bonus-rules`, { bonusRules: [] }),
        asDesigner('DELETE', `maps/${draft.mapId}`),
      ]);

      for (const response of responses) {
        expect(response.statusCode, response.body).toBe(409);
        expect(response.json()).toEqual({ error: 'map_frozen' });
      }
      expect(await read(draft.mapId)).toEqual(before);
    });

    it('INV-10 accepts a new dimension and a new capability with its tools and objectives', async () => {
      const draft = await completeDraft();
      await publish(draft.mapId);

      const dimension = await ok(
        await asDesigner('POST', `maps/${draft.mapId}/dimensions`, { name: 'Comunicación', kind: 'transversal' }),
        201,
      );
      const capability = await ok(
        await asDesigner('POST', `maps/${draft.mapId}/dimensions/${dimension.id}/capabilities`, {
          statement: 'Adapta el mensaje a cada audiencia',
          toolIds: [draft.toolId],
          objectiveIds: [draft.objectiveId],
        }),
        201,
      );

      const map = await read(draft.mapId);
      expect(map.dimensions.map((item: { name: string }) => item.name)).toEqual(['Entender', 'Comunicación']);
      expect(map.dimensions[1].capabilities).toEqual([
        expect.objectContaining({ id: capability.id, toolIds: [draft.toolId], objectiveIds: [draft.objectiveId] }),
      ]);
      const frozenAgain = await asDesigner('PATCH', `maps/${draft.mapId}/capabilities/${capability.id}`, {
        statement: 'Cambiada',
      });
      expect(frozenAgain.statusCode).toBe(409);
    });

    it('INV-10 changes go to a new version, a draft copy that leaves the published one intact', async () => {
      const draft = await completeDraft();
      await publish(draft.mapId);
      const published = await read(draft.mapId);

      const copy = await ok(
        await asDesigner('POST', `roles/${draft.roleId}/maps`, { copyFrom: draft.mapId }),
        201,
      );
      const copied = await read(copy.id);
      const capabilityOfCopy = copied.dimensions[0].capabilities[0].id;
      await ok(
        await asDesigner('PATCH', `maps/${copy.id}/capabilities/${capabilityOfCopy}`, { statement: 'Versión 2' }),
      );

      const strip = (map: Record<string, unknown>) =>
        JSON.parse(JSON.stringify(map, (key, value) => (key === 'id' || key.endsWith('At') ? undefined : value)));
      expect(copied.version).toBe(2);
      expect(copied.status).toBe('draft');
      expect(strip({ ...copied, version: 1, status: 'published' })).toEqual(strip(published));
      expect(await read(draft.mapId)).toEqual(published);
    });

    it('archives a published map, which then accepts nothing', async () => {
      const draft = await completeDraft();
      await publish(draft.mapId);

      const archived = await ok(await asDesigner('POST', `maps/${draft.mapId}/archive`));
      const growth = await asDesigner('POST', `maps/${draft.mapId}/dimensions`, { name: 'Nueva', kind: 'transversal' });
      const republish = await asDesigner('POST', `maps/${draft.mapId}/publish`);

      expect(archived).toMatchObject({ status: 'archived', archivedAt: expect.any(String) });
      expect(growth.statusCode).toBe(409);
      expect(republish.statusCode).toBe(409);
      expect(republish.json()).toEqual({ error: 'invalid_transition' });
    });
  });

  describe('import', () => {
    const file = (suffix: string) => ({
      format: 'potencializador.capability-map/v1',
      scale: SCALE,
      bonusRules: BONUS,
      dimensions: [
        {
          name: 'Entender',
          kind: 'work_cycle',
          capabilities: [
            {
              statement: 'Identifica a quién sirve el producto',
              tools: [`Jobs To Be Done ${suffix}`, `Segmentos ${suffix}`],
              prioritized: true,
            },
            { statement: 'Lee el estado actual del producto', tools: [`Jobs to be done ${suffix}`] },
          ],
        },
        {
          name: 'Comunicación',
          kind: 'transversal',
          capabilities: [{ statement: 'Comunica por escrito', difficulty: 'low', objectives: [`PDI ${suffix}`] }],
        },
      ],
    });

    it('creates a draft of the role and adds to the catalogs the tools and objectives it names', async () => {
      const roleId = await newRole();
      const suffix = randomUUID().slice(0, 8);
      const existing = await ok(await asDesigner('POST', 'tools', { name: `Segmentos ${suffix}` }), 201);

      const imported = await ok(await asDesigner('POST', `roles/${roleId}/maps/import`, file(suffix)), 201);
      const map = await read(imported.id);
      const tools = (await ok(await asDesigner('GET', 'tools'))).items as { id: string; name: string }[];

      expect(map).toMatchObject({ status: 'draft', version: 1, levels: expect.any(Array) });
      expect(map.levels).toHaveLength(3);
      expect(map.dimensions.map((dimension: { name: string }) => dimension.name)).toEqual(['Entender', 'Comunicación']);
      const ofSuffix = tools.filter((tool) => tool.name.endsWith(suffix));
      // "Jobs To Be Done" and "Jobs to be done" are the same entry; "Segmentos" existed.
      expect(ofSuffix.map((tool) => tool.name).sort()).toEqual([`Jobs To Be Done ${suffix}`, `Segmentos ${suffix}`]);
      expect(map.dimensions[0].capabilities[0].toolIds).toContain(existing.id);
      expect(map.dimensions[0].capabilities[1].toolIds).toEqual([
        ofSuffix.find((tool) => tool.name.startsWith('Jobs'))!.id,
      ]);
      expect(map.dimensions[1].capabilities[0]).toMatchObject({ difficulty: 'low', objectiveIds: [expect.any(String)] });
    });

    it('refuses a file in another format, and a role that already has a draft', async () => {
      const roleId = await newRole();
      await ok(await asDesigner('POST', `roles/${roleId}/maps`, {}), 201);

      const wrongFormat = await asDesigner('POST', `roles/${roleId}/maps/import`, { ...file('x'), format: 'other' });
      const withDraft = await asDesigner('POST', `roles/${roleId}/maps/import`, file('y'));

      expect(wrongFormat.statusCode).toBe(400);
      expect(withDraft.statusCode).toBe(409);
    });
  });

  describe('permissions and isolation', () => {
    it('lets every member read the maps but only a map designer change them', async () => {
      const draft = await completeDraft();

      const read = await call(sessions.administratorA, 'GET', `${organizationA}/maps/${draft.mapId}`);
      const changes = await Promise.all([
        call(sessions.administratorA, 'POST', `${organizationA}/roles/${draft.roleId}/maps/import`, {}),
        call(sessions.administratorA, 'POST', `${organizationA}/maps/${draft.mapId}/publish`),
        call(sessions.administratorA, 'POST', `${organizationA}/maps/${draft.mapId}/dimensions`, {
          name: 'X',
          kind: 'transversal',
        }),
      ]);

      expect(read.statusCode).toBe(200);
      expect(changes.map((response) => response.statusCode)).toEqual([403, 403, 403]);
    });

    it('lets a super administrator design maps of any organization', async () => {
      const draft = await completeDraft();

      const response = await call(sessions.superAdministrator, 'POST', `${organizationA}/maps/${draft.mapId}/publish`);

      expect(response.statusCode).toBe(200);
    });

    it('INV-11 refuses maps of another organization, also when addressed through one\'s own', async () => {
      const draft = await completeDraft();

      const responses = await Promise.all([
        call(sessions.designerB, 'GET', `${organizationA}/maps/${draft.mapId}`),
        call(sessions.designerB, 'GET', `${organizationA}/roles/${draft.roleId}/maps`),
        call(sessions.designerB, 'GET', `${organizationB}/maps/${draft.mapId}`),
        call(sessions.designerB, 'POST', `${organizationB}/maps/${draft.mapId}/publish`),
        call(sessions.designerB, 'GET', `${organizationB}/roles/${draft.roleId}/maps`),
        call(sessions.superAdministrator, 'GET', `${organizationB}/maps/${draft.mapId}`),
      ]);

      expect(responses.map((response) => response.statusCode)).toEqual([403, 403, 404, 404, 404, 404]);
      expect((await read(draft.mapId)).status).toBe('draft');
    });
  });
});
