import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { seedMap } from '../../test-support/seed-map.ts';
import { createSeeder } from '../../test-support/seed.ts';
import { createSignedInApp, TEST_PUBLIC_URL } from '../../test-support/signed-in-app.ts';

describe('roles, tools and strategic objectives', () => {
  let ownerPool: pg.Pool;
  let appPool: pg.Pool;
  let app: FastifyInstance;

  let organizationA: string;
  let organizationB: string;
  let sessions: {
    superAdministrator: string;
    administratorA: string;
    designerA: string;
    designerB: string;
  };

  const call = (
    session: string | null,
    method: 'GET' | 'POST' | 'PATCH' | 'DELETE',
    url: string,
    body?: Record<string, unknown>,
  ) =>
    app.inject({
      method,
      url,
      cookies: session === null ? {} : { session },
      headers: method === 'GET' ? {} : { origin: TEST_PUBLIC_URL.origin },
      ...(body === undefined ? {} : { payload: body }),
    });
  const unique = (prefix: string) => `${prefix} ${randomUUID().slice(0, 8)}`;

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

  describe('roles', () => {
    const roles = (organizationId: string) => `/api/organizations/${organizationId}/roles`;

    it('lets an administrator create a role that every member then lists', async () => {
      const name = unique('Product Owner');

      const created = await call(sessions.administratorA, 'POST', roles(organizationA), {
        name: `  ${name} `,
        description: 'Dueño de producto',
      });
      const listedByDesigner = await call(sessions.designerA, 'GET', roles(organizationA));

      expect(created.statusCode).toBe(201);
      expect(created.json()).toEqual({ id: expect.any(String), name, description: 'Dueño de producto' });
      expect(listedByDesigner.statusCode).toBe(200);
      expect(listedByDesigner.json().roles).toContainEqual(created.json());
    });

    it('lets a super administrator create a role in any organization', async () => {
      const created = await call(sessions.superAdministrator, 'POST', roles(organizationB), {
        name: unique('Scrum Master'),
      });

      expect(created.statusCode).toBe(201);
      expect(created.json().description).toBe('');
    });

    it('refuses role creation to a map designer who is not administrator', async () => {
      const name = unique('No permitido');

      const response = await call(sessions.designerA, 'POST', roles(organizationA), { name });

      expect(response.statusCode).toBe(403);
      const stored = await ownerPool.query('select 1 from roles where name = $1', [name]);
      expect(stored.rowCount).toBe(0);
    });

    it('refuses a second role with the same name, ignoring case', async () => {
      const name = unique('Analista');
      await call(sessions.administratorA, 'POST', roles(organizationA), { name });

      const repeated = await call(sessions.administratorA, 'POST', roles(organizationA), {
        name: name.toUpperCase(),
      });

      expect(repeated.statusCode).toBe(409);
      expect(repeated.json()).toEqual({ error: 'name_taken' });
    });

    it('INV-11 refuses to list or create roles of another organization', async () => {
      const listed = await call(sessions.administratorA, 'GET', roles(organizationB));
      const created = await call(sessions.administratorA, 'POST', roles(organizationB), {
        name: unique('Intruso'),
      });

      expect([listed.statusCode, created.statusCode]).toEqual([403, 403]);
    });
  });

  describe.each([
    { catalog: 'tools', withLink: true },
    { catalog: 'strategic-objectives', withLink: false },
  ])('$catalog', ({ catalog, withLink }) => {
    const path = (organizationId: string, id?: string) =>
      `/api/organizations/${organizationId}/${catalog}${id === undefined ? '' : `/${id}`}`;
    const link = withLink ? { link: 'https://example.test/okr' } : {};

    it('lets a map designer create and change an entry that every member then lists', async () => {
      const name = unique('OKR');

      const created = await call(sessions.designerA, 'POST', path(organizationA), {
        name,
        description: 'Objetivos y resultados clave',
        ...link,
      });
      const changed = await call(sessions.designerA, 'PATCH', path(organizationA, created.json().id), {
        description: 'Objetivos medibles',
      });
      const listed = await call(sessions.administratorA, 'GET', path(organizationA));

      expect(created.statusCode).toBe(201);
      expect(created.json()).toEqual({
        id: expect.any(String),
        name,
        description: 'Objetivos y resultados clave',
        ...(withLink ? { link: 'https://example.test/okr' } : {}),
      });
      expect(changed.statusCode).toBe(200);
      expect(changed.json()).toEqual({ ...created.json(), description: 'Objetivos medibles' });
      expect(listed.json().items).toContainEqual(changed.json());
    });

    it('refuses changes to an administrator who is not map designer', async () => {
      const created = await call(sessions.administratorA, 'POST', path(organizationA), { name: unique('X') });

      expect(created.statusCode).toBe(403);
    });

    it('refuses a repeated name and invalid input', async () => {
      const name = unique('Kano');
      await call(sessions.designerA, 'POST', path(organizationA), { name });

      const repeated = await call(sessions.designerA, 'POST', path(organizationA), { name: name.toLowerCase() });
      const empty = await call(sessions.designerA, 'POST', path(organizationA), { name: '  ' });

      expect(repeated.statusCode).toBe(409);
      expect(empty.statusCode).toBe(400);
    });

    it('refuses an empty change, a malformed id and a rename to a taken name', async () => {
      const first = await call(sessions.designerA, 'POST', path(organizationA), { name: unique('Primera') });
      const second = await call(sessions.designerA, 'POST', path(organizationA), { name: unique('Segunda') });

      const empty = await call(sessions.designerA, 'PATCH', path(organizationA, first.json().id), {});
      const malformed = await call(sessions.designerA, 'PATCH', path(organizationA, 'not-a-uuid'), { name: 'X' });
      const taken = await call(sessions.designerA, 'PATCH', path(organizationA, second.json().id), {
        name: first.json().name,
      });

      expect([empty.statusCode, malformed.statusCode, taken.statusCode]).toEqual([400, 400, 409]);
      expect(taken.json()).toEqual({ error: 'name_taken' });
    });

    it('lets a map designer delete an unused entry, and refuses one used by a capability', async () => {
      const unused = await call(sessions.designerA, 'POST', path(organizationA), { name: unique('Sin uso') });
      const used = await call(sessions.designerA, 'POST', path(organizationA), { name: unique('En uso') });
      const map = await seedMap(ownerPool, organizationA, 'draft');
      const link =
        catalog === 'tools'
          ? 'insert into capability_tools (organization_id, capability_id, tool_id) values ($1, $2, $3)'
          : 'insert into capability_objectives (organization_id, capability_id, objective_id) values ($1, $2, $3)';
      await ownerPool.query(link, [organizationA, map.capabilityId, used.json().id]);

      const deleted = await call(sessions.designerA, 'DELETE', path(organizationA, unused.json().id));
      const inUse = await call(sessions.designerA, 'DELETE', path(organizationA, used.json().id));
      const byAdministrator = await call(sessions.administratorA, 'DELETE', path(organizationA, used.json().id));
      const missing = await call(sessions.designerA, 'DELETE', path(organizationA, randomUUID()));
      const another = await call(sessions.designerA, 'POST', path(organizationA), { name: unique('Otra sin uso') });
      const bySuperAdministrator = await call(sessions.superAdministrator, 'DELETE', path(organizationA, another.json().id));
      expect(bySuperAdministrator.statusCode).toBe(204);

      expect([deleted.statusCode, inUse.statusCode, byAdministrator.statusCode, missing.statusCode]).toEqual([
        204, 409, 403, 404,
      ]);
      expect(inUse.json()).toEqual({ error: 'in_use' });
      const ids = (await call(sessions.designerA, 'GET', path(organizationA))).json().items.map((item: { id: string }) => item.id);
      expect(ids).toContain(used.json().id);
      expect(ids).not.toContain(unused.json().id);
    });

    it('INV-11 refuses to read, create or change entries of another organization', async () => {
      const ofB = await call(sessions.designerB, 'POST', path(organizationB), { name: unique('Ajena') });
      expect(ofB.statusCode).toBe(201);

      const responses = await Promise.all([
        call(sessions.designerA, 'GET', path(organizationB)),
        call(sessions.designerA, 'POST', path(organizationB), { name: unique('Intrusa') }),
        call(sessions.designerA, 'PATCH', path(organizationB, ofB.json().id), { name: 'Cambiada' }),
        // The entry of B addressed through organization A: not found there.
        call(sessions.designerA, 'PATCH', path(organizationA, ofB.json().id), { name: 'Cambiada' }),
        call(sessions.designerA, 'DELETE', path(organizationB, ofB.json().id)),
        call(sessions.designerA, 'DELETE', path(organizationA, ofB.json().id)),
      ]);

      expect(responses.map((response) => response.statusCode)).toEqual([403, 403, 403, 404, 403, 404]);
      const listed = await call(sessions.designerB, 'GET', path(organizationB));
      expect(listed.json().items).toContainEqual(ofB.json());
    });
  });

  it('rejects a tool link that is not an http address', async () => {
      const response = await call(sessions.designerA, 'POST', `/api/organizations/${organizationA}/tools`, {
        name: unique('Enlace'),
        link: 'javascript:alert(1)',
      });

    expect(response.statusCode).toBe(400);
  });
});
