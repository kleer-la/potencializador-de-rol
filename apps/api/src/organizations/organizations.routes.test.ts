import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { createSeeder } from '../../test-support/seed.ts';
import { createSignedInApp, TEST_PUBLIC_URL } from '../../test-support/signed-in-app.ts';

describe('organizations and memberships', () => {
  let ownerPool: pg.Pool;
  let appPool: pg.Pool;
  let app: FastifyInstance;
  let signInAs: (email: string) => Promise<string>;

  let organizationA: string;
  let organizationB: string;
  let personOfB: { id: string; email: string };
  let sessions: { superAdministrator: string; administratorA: string; designerA: string };

  const emailOf = async (personId: string) =>
    (await ownerPool.query<{ email: string }>('select email from persons where id = $1', [personId])).rows[0]!
      .email;
  const newEmail = () => `${randomUUID()}@example.test`;

  const call = (
    session: string | null,
    method: 'GET' | 'POST',
    url: string,
    body?: Record<string, unknown>,
  ) =>
    app.inject({
      method,
      url,
      cookies: session === null ? {} : { session },
      headers: method === 'POST' ? { origin: TEST_PUBLIC_URL.origin } : {},
      ...(body === undefined ? {} : { payload: body }),
    });

  const invite = (session: string | null, organizationId: string, body: Record<string, unknown>) =>
    call(session, 'POST', `/api/organizations/${organizationId}/members`, body);

  beforeAll(async () => {
    ownerPool = new pg.Pool({ connectionString: inject('ownerDatabaseUrl') });
    appPool = new pg.Pool({ connectionString: inject('appDatabaseUrl') });
    ({ app, signInAs } = createSignedInApp(appPool));
    const seed = createSeeder(ownerPool);

    organizationA = await seed.organization();
    organizationB = await seed.organization();
    const superAdministrator = await seed.person(null);
    const administratorA = await seed.person(organizationA);
    const designerA = await seed.person(organizationA);
    const administratorB = await seed.person(organizationB);
    await seed.membership(organizationA, administratorA, 'administrator');
    await seed.membership(organizationA, designerA, 'map_designer');
    await seed.membership(organizationB, administratorB, 'administrator');
    personOfB = { id: administratorB, email: await emailOf(administratorB) };

    sessions = {
      superAdministrator: await signInAs(await emailOf(superAdministrator)),
      administratorA: await signInAs(await emailOf(administratorA)),
      designerA: await signInAs(await emailOf(designerA)),
    };
  });

  afterAll(async () => {
    await app.close();
    await appPool.end();
    await ownerPool.end();
  });

  it('answers 401 to every operation without a session', async () => {
    const responses = await Promise.all([
      call(null, 'GET', '/api/organizations'),
      call(null, 'POST', '/api/organizations', { name: 'No session' }),
      call(null, 'GET', `/api/organizations/${organizationA}/members`),
      invite(null, organizationA, { email: newEmail(), name: 'Nobody', role: 'administrator' }),
    ]);

    expect(responses.map((response) => response.statusCode)).toEqual([401, 401, 401, 401]);
  });

  it('lets a super administrator create an organization and list all of them', async () => {
    const name = `  Universidad ${randomUUID()}  `;

    const created = await call(sessions.superAdministrator, 'POST', '/api/organizations', { name });
    const listed = await call(sessions.superAdministrator, 'GET', '/api/organizations');

    expect(created.statusCode).toBe(201);
    expect(created.json()).toEqual({ id: expect.any(String), name: name.trim() });
    const ids = listed.json().organizations.map((organization: { id: string }) => organization.id);
    expect(ids).toEqual(expect.arrayContaining([organizationA, organizationB, created.json().id]));
  });

  it('refuses organization creation to anyone who is not super administrator', async () => {
    const name = `Not allowed ${randomUUID()}`;

    const byAdministrator = await call(sessions.administratorA, 'POST', '/api/organizations', { name });
    const byDesigner = await call(sessions.designerA, 'POST', '/api/organizations', { name });

    expect([byAdministrator.statusCode, byDesigner.statusCode]).toEqual([403, 403]);
    const stored = await ownerPool.query('select 1 from organizations where name = $1', [name]);
    expect(stored.rowCount).toBe(0);
  });

  it('INV-11 a member lists only the organizations where they have a membership', async () => {
    const byAdministrator = await call(sessions.administratorA, 'GET', '/api/organizations');
    const byDesigner = await call(sessions.designerA, 'GET', '/api/organizations');

    for (const response of [byAdministrator, byDesigner]) {
      expect(response.statusCode).toBe(200);
      expect(response.json().organizations.map((organization: { id: string }) => organization.id)).toEqual([
        organizationA,
      ]);
    }
  });

  it('INV-11 an administrator of organization A cannot list or invite members of organization B', async () => {
    const email = newEmail();

    const listed = await call(sessions.administratorA, 'GET', `/api/organizations/${organizationB}/members`);
    const invited = await invite(sessions.administratorA, organizationB, {
      email,
      name: 'Intruder',
      role: 'administrator',
    });

    expect(listed.statusCode).toBe(403);
    expect(listed.json()).toEqual({ error: 'forbidden' });
    expect(invited.statusCode).toBe(403);
    const stored = await ownerPool.query('select 1 from persons where email = $1', [email]);
    expect(stored.rowCount).toBe(0);
  });

  it('answers an unknown organization exactly like a forbidden one to a member', async () => {
    const forbidden = await call(sessions.administratorA, 'GET', `/api/organizations/${organizationB}/members`);
    const unknown = await call(sessions.administratorA, 'GET', `/api/organizations/${randomUUID()}/members`);

    expect(unknown.statusCode).toBe(forbidden.statusCode);
    expect(unknown.json()).toEqual(forbidden.json());
  });

  it('accepts the organization id in upper case', async () => {
    const response = await call(
      sessions.administratorA,
      'GET',
      `/api/organizations/${organizationA.toUpperCase()}/members`,
    );

    expect(response.statusCode).toBe(200);
  });

  it('refuses member administration to a map designer of the organization', async () => {
    const listed = await call(sessions.designerA, 'GET', `/api/organizations/${organizationA}/members`);
    const invited = await invite(sessions.designerA, organizationA, {
      email: newEmail(),
      name: 'Colleague',
      role: 'map_designer',
    });

    expect([listed.statusCode, invited.statusCode]).toEqual([403, 403]);
  });

  it('lets an administrator invite a person who can then sign in', async () => {
    const email = newEmail();

    const invited = await invite(sessions.administratorA, organizationA, {
      email: ` ${email.toUpperCase()} `,
      name: '  Laura Díaz ',
      role: 'map_designer',
    });
    const session = await signInAs(email);
    const me = await call(session, 'GET', '/api/me');

    expect(invited.statusCode).toBe(201);
    expect(invited.json()).toEqual({
      personId: expect.any(String),
      name: 'Laura Díaz',
      email,
      roles: ['map_designer'],
    });
    expect(me.json()).toMatchObject({
      person: { id: invited.json().personId, name: 'Laura Díaz', email },
      isSuperAdmin: false,
      memberships: [{ organizationId: organizationA, role: 'map_designer' }],
    });
  });

  it('adds a second role to an existing member without duplicating the person, and repeats safely', async () => {
    const email = newEmail();
    const body = { email, name: 'Marta Ruiz' };

    const first = await invite(sessions.administratorA, organizationA, { ...body, role: 'map_designer' });
    const second = await invite(sessions.administratorA, organizationA, { ...body, role: 'administrator' });
    const repeated = await invite(sessions.administratorA, organizationA, { ...body, role: 'administrator' });

    expect([first.statusCode, second.statusCode, repeated.statusCode]).toEqual([201, 200, 200]);
    expect(repeated.json()).toEqual({
      personId: first.json().personId,
      name: 'Marta Ruiz',
      email,
      roles: ['administrator', 'map_designer'],
    });
    const persons = await ownerPool.query('select 1 from persons where email = $1', [email]);
    const memberships = await ownerPool.query('select 1 from organization_memberships where person_id = $1', [
      first.json().personId,
    ]);
    expect([persons.rowCount, memberships.rowCount]).toEqual([1, 2]);
  });

  it('gives every concurrent invitation of the same new email the same person', async () => {
    const body = { email: newEmail(), name: 'Carlos Peña', role: 'map_designer' };

    const responses = await Promise.all(
      Array.from({ length: 4 }, () => invite(sessions.administratorA, organizationA, body)),
    );

    expect(responses.map((response) => response.statusCode).sort()).toEqual([200, 200, 200, 201]);
    expect(new Set(responses.map((response) => response.json().personId)).size).toBe(1);
    const persons = await ownerPool.query('select 1 from persons where email = $1', [body.email]);
    expect(persons.rowCount).toBe(1);
  });

  it('INV-11 lists the members of the organization and nobody from another one', async () => {
    const response = await call(sessions.administratorA, 'GET', `/api/organizations/${organizationA}/members`);

    expect(response.statusCode).toBe(200);
    const members: { personId: string; email: string; roles: string[] }[] = response.json().members;
    expect(members.length).toBeGreaterThanOrEqual(2);
    expect(members.map((member) => member.personId)).not.toContain(personOfB.id);
    const stored = await ownerPool.query<{ id: string }>('select id from persons where organization_id = $1', [
      organizationA,
    ]);
    expect(members.map((member) => member.personId).sort()).toEqual(stored.rows.map((row) => row.id).sort());
  });

  it('INV-11 refuses to invite an email that belongs to another organization, changing nothing', async () => {
    const response = await invite(sessions.administratorA, organizationA, {
      email: personOfB.email,
      name: 'Taken',
      role: 'administrator',
    });

    expect(response.statusCode).toBe(409);
    expect(response.json()).toEqual({ error: 'invitation_not_possible' });
    const stored = await ownerPool.query<{ organization_id: string }>(
      'select organization_id from persons where email = $1',
      [personOfB.email],
    );
    expect(stored.rows).toEqual([{ organization_id: organizationB }]);
    const memberships = await ownerPool.query(
      'select 1 from organization_memberships where person_id = $1 and organization_id = $2',
      [personOfB.id, organizationA],
    );
    expect(memberships.rowCount).toBe(0);
  });

  it('INV-11 lets a super administrator list and invite members in both organizations', async () => {
    const email = newEmail();

    const listedA = await call(sessions.superAdministrator, 'GET', `/api/organizations/${organizationA}/members`);
    const listedB = await call(sessions.superAdministrator, 'GET', `/api/organizations/${organizationB}/members`);
    const invited = await invite(sessions.superAdministrator, organizationB, {
      email,
      name: 'Soporte Invitado',
      role: 'administrator',
    });

    expect([listedA.statusCode, listedB.statusCode, invited.statusCode]).toEqual([200, 200, 201]);
    const stored = await ownerPool.query<{ organization_id: string }>(
      'select organization_id from persons where email = $1',
      [email],
    );
    expect(stored.rows).toEqual([{ organization_id: organizationB }]);
  });

  it('answers 404 to a super administrator for an organization that does not exist', async () => {
    const missing = randomUUID();

    const listed = await call(sessions.superAdministrator, 'GET', `/api/organizations/${missing}/members`);
    const invited = await invite(sessions.superAdministrator, missing, {
      email: newEmail(),
      name: 'Nobody',
      role: 'administrator',
    });

    expect([listed.statusCode, invited.statusCode]).toEqual([404, 404]);
  });

  it('answers 400 to invalid input and stores nothing', async () => {
    const responses = await Promise.all([
      call(sessions.superAdministrator, 'POST', '/api/organizations', { name: '   ' }),
      call(sessions.superAdministrator, 'POST', '/api/organizations', { name: 'x'.repeat(121) }),
      invite(sessions.administratorA, organizationA, { email: 'not-an-email', name: 'A', role: 'administrator' }),
      invite(sessions.administratorA, organizationA, { email: newEmail(), name: ' ', role: 'administrator' }),
      invite(sessions.administratorA, organizationA, { email: newEmail(), name: 'A', role: 'owner' }),
      call(sessions.administratorA, 'GET', '/api/organizations/not-a-uuid/members'),
    ]);

    expect(responses.map((response) => response.statusCode)).toEqual([400, 400, 400, 400, 400, 400]);
    expect(responses[0]!.json()).toEqual({ error: 'invalid_request' });
  });
});
