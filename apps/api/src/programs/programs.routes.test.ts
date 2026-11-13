import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { seedMap } from '../../test-support/seed-map.ts';
import { giveBaseline, seedProgram, type SeededProgram } from '../../test-support/seed-program.ts';
import { createSeeder } from '../../test-support/seed.ts';
import { createSignedInApp, TEST_PUBLIC_URL } from '../../test-support/signed-in-app.ts';

type Method = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

describe('programs, enrollments and panels', () => {
  let ownerPool: pg.Pool;
  let appPool: pg.Pool;
  let app: FastifyInstance;
  let seed: ReturnType<typeof createSeeder>;
  let organizationA: string;
  let organizationB: string;
  let program: SeededProgram;
  let emails: Record<'participant' | 'leader' | 'firmMentor' | 'personOfB', string>;
  let sessions: Record<'administrator' | 'designer' | 'participant' | 'superAdministrator' | 'administratorB', string>;

  const emailOf = async (personId: string) =>
    (await ownerPool.query<{ email: string }>('select email from persons where id = $1', [personId])).rows[0]!.email;
  const call = (session: string, method: Method, url: string, body?: unknown) =>
    app.inject({
      method,
      url: `/api/organizations/${url}`,
      cookies: { session },
      headers: method === 'GET' ? {} : { origin: TEST_PUBLIC_URL.origin },
      ...(body === undefined ? {} : { payload: body as Record<string, unknown> }),
    });
  const asAdmin = (method: Method, url: string, body?: unknown) =>
    call(sessions.administrator, method, `${organizationA}/${url}`, body);
  const detail = async () => (await asAdmin('GET', `programs/${program.programId}`)).json();
  const enroll = (email: string, roles: string[]) =>
    asAdmin('POST', `programs/${program.programId}/enrollments`, { email, roles });

  beforeAll(async () => {
    ownerPool = new pg.Pool({ connectionString: inject('ownerDatabaseUrl') });
    appPool = new pg.Pool({ connectionString: inject('appDatabaseUrl') });
    const signedIn = createSignedInApp(appPool);
    app = signedIn.app;
    seed = createSeeder(ownerPool);
    organizationA = await seed.organization();
    organizationB = await seed.organization();
    program = await seedProgram(ownerPool, organizationA);

    const administrator = await seed.person(organizationA);
    const designer = await seed.person(organizationA);
    const participant = await seed.person(organizationA);
    const leader = await seed.person(organizationA);
    const firmMentor = await seed.person(null);
    const superAdministrator = await seed.person(null);
    const administratorB = await seed.person(organizationB);
    await seed.membership(organizationA, administrator, 'administrator');
    await seed.membership(organizationA, designer, 'map_designer');
    await seed.membership(organizationB, administratorB, 'administrator');
    emails = {
      participant: await emailOf(participant),
      leader: await emailOf(leader),
      firmMentor: await emailOf(firmMentor),
      personOfB: await emailOf(await seed.person(organizationB)),
    };
    sessions = {
      administrator: await signedIn.signInAs(await emailOf(administrator)),
      designer: await signedIn.signInAs(await emailOf(designer)),
      participant: await signedIn.signInAs(emails.participant),
      superAdministrator: await signedIn.signInAs(await emailOf(superAdministrator)),
      administratorB: await signedIn.signInAs(await emailOf(administratorB)),
    };
  });

  afterAll(async () => {
    await app.close();
    await appPool.end();
    await ownerPool.end();
  });

  describe('programs', () => {
    it('lets an administrator create a program on a published map, with defaults', async () => {
      const response = await asAdmin('POST', 'programs', {
        mapId: program.mapId,
        name: '  Programa Product Owners 2027 ',
        startsOn: '2027-01-15',
        endsOn: '2027-06-30',
      });

      expect(response.statusCode, response.body).toBe(201);
      expect(response.json()).toEqual({
        id: expect.any(String),
        mapId: program.mapId,
        roleId: expect.any(String),
        name: 'Programa Product Owners 2027',
        startsOn: '2027-01-15',
        endsOn: '2027-06-30',
        maxFocuses: 3,
        mandatoryPanelRoles: ['leader', 'specialist', 'mentor'],
      });
      const listed = await call(sessions.designer, 'GET', `${organizationA}/programs`);
      expect(listed.json().programs).toContainEqual(response.json());
    });

    it('refuses a draft map, inverted dates and a map designer who is not administrator', async () => {
      const draft = await seedMap(ownerPool, organizationA, 'draft');
      const body = { mapId: draft.mapId, name: 'P', startsOn: '2027-01-01', endsOn: '2027-02-01' };

      const onDraft = await asAdmin('POST', 'programs', body);
      const inverted = await asAdmin('POST', 'programs', { ...body, mapId: program.mapId, endsOn: '2026-12-01' });
      const byDesigner = await call(sessions.designer, 'POST', `${organizationA}/programs`, { ...body, mapId: program.mapId });

      const repeatedRoles = await asAdmin('POST', 'programs', {
        ...body,
        mapId: program.mapId,
        mandatoryPanelRoles: ['leader', 'leader'],
      });

      expect([onDraft.statusCode, inverted.statusCode, byDesigner.statusCode, repeatedRoles.statusCode]).toEqual([
        409, 400, 403, 400,
      ]);
      expect(onDraft.json()).toEqual({ error: 'map_not_published' });
    });

    it('INV-11 refuses programs and maps of another organization', async () => {
      const mapOfB = await seedMap(ownerPool, organizationB, 'published');

      const responses = await Promise.all([
        asAdmin('POST', 'programs', { mapId: mapOfB.mapId, name: 'P', startsOn: '2027-01-01', endsOn: '2027-02-01' }),
        call(sessions.administratorB, 'GET', `${organizationA}/programs`),
        call(sessions.administratorB, 'GET', `${organizationB}/programs/${program.programId}`),
      ]);

      expect(responses.map((response) => response.statusCode)).toEqual([404, 403, 404]);
    });
  });

  describe('settings', () => {
    it('lets an administrator set the maximum of focuses and the mandatory panel roles, and change them later', async () => {
      const created = await asAdmin('POST', 'programs', {
        mapId: program.mapId,
        name: 'Configurable',
        startsOn: '2027-01-01',
        endsOn: '2027-06-30',
        maxFocuses: 5,
        mandatoryPanelRoles: ['mentor'],
      });
      const changed = await asAdmin('PATCH', `programs/${created.json().id}`, {
        maxFocuses: 2,
        mandatoryPanelRoles: ['leader', 'mentor'],
        endsOn: '2027-07-31',
      });

      expect(created.json()).toMatchObject({ maxFocuses: 5, mandatoryPanelRoles: ['mentor'] });
      expect(changed.statusCode, changed.body).toBe(200);
      expect(changed.json()).toMatchObject({
        name: 'Configurable',
        maxFocuses: 2,
        mandatoryPanelRoles: ['leader', 'mentor'],
        endsOn: '2027-07-31',
      });
    });

    it('requires at least one mandatory panel role, and dates in order, when creating or changing', async () => {
      const base = { mapId: program.mapId, name: 'P', startsOn: '2027-01-01', endsOn: '2027-06-30' };

      const responses = await Promise.all([
        asAdmin('POST', 'programs', { ...base, mandatoryPanelRoles: [] }),
        asAdmin('PATCH', `programs/${program.programId}`, { mandatoryPanelRoles: [] }),
        asAdmin('PATCH', `programs/${program.programId}`, { maxFocuses: 0 }),
        asAdmin('PATCH', `programs/${program.programId}`, { startsOn: '2030-01-01' }),
        asAdmin('PATCH', `programs/${program.programId}`, { mapId: program.mapId }),
        call(sessions.designer, 'PATCH', `${organizationA}/programs/${program.programId}`, { maxFocuses: 4 }),
      ]);

      expect(responses.map((response) => response.statusCode)).toEqual([400, 400, 400, 400, 400, 403]);
    });

    it('refuses a change without a session, to a program of another organization, and an end before the start', async () => {
      const programOfB = await seedProgram(ownerPool, organizationB);

      const anonymous = await app.inject({
        method: 'PATCH',
        url: `/api/organizations/${organizationA}/programs/${program.programId}`,
        headers: { origin: TEST_PUBLIC_URL.origin },
        payload: { maxFocuses: 4 },
      });
      const throughA = await asAdmin('PATCH', `programs/${programOfB.programId}`, { maxFocuses: 4 });
      const unknown = await asAdmin('PATCH', `programs/${randomUUID()}`, { maxFocuses: 4 });
      const endBeforeStart = await asAdmin('PATCH', `programs/${program.programId}`, { endsOn: '2020-01-01' });

      expect([anonymous.statusCode, throughA.statusCode, unknown.statusCode, endBeforeStart.statusCode]).toEqual([
        401, 404, 404, 400,
      ]);
      expect(throughA.json()).toEqual(unknown.json());
    });
  });

  describe('base selection', () => {
    it('lets a map designer replace it with capabilities of the program map', async () => {
      const chosen = [program.capabilityIds[0], program.capabilityIds[2]];

      const response = await call(sessions.designer, 'PUT', `${organizationA}/programs/${program.programId}/selection`, {
        capabilityIds: chosen,
      });

      expect(response.statusCode, response.body).toBe(200);
      expect((await detail()).selection.sort()).toEqual([...chosen].sort());
    });

    it('refuses a capability of another map, and an administrator who is not map designer', async () => {
      const other = await seedMap(ownerPool, organizationA, 'published');

      const foreign = await call(sessions.designer, 'PUT', `${organizationA}/programs/${program.programId}/selection`, {
        capabilityIds: [other.capabilityId],
      });
      const byAdministrator = await asAdmin('PUT', `programs/${program.programId}/selection`, { capabilityIds: [] });

      expect([foreign.statusCode, byAdministrator.statusCode]).toEqual([400, 403]);
      expect(foreign.json()).toEqual({ error: 'unknown_reference' });
    });
  });

  describe('enrollments and panels', () => {
    let participantEnrollment: string;
    let leaderEnrollment: string;
    let mentorEnrollment: string;

    it('enrolls a participant, whose board starts with the base selection and is not shown here', async () => {
      await call(sessions.designer, 'PUT', `${organizationA}/programs/${program.programId}/selection`, {
        capabilityIds: program.capabilityIds.slice(0, 2),
      });

      const response = await enroll(emails.participant.toUpperCase(), ['participant']);
      const program_ = await detail();

      expect(response.statusCode, response.body).toBe(201);
      participantEnrollment = response.json().enrollments[0].id;
      expect(response.json()).toEqual({
        enrollments: [{ id: participantEnrollment, role: 'participant' }],
        boardId: expect.any(String),
      });
      expect(program_.boards).toEqual([{ id: response.json().boardId, enrollmentId: participantEnrollment, status: 'not_started' }]);
      expect(JSON.stringify(program_)).not.toContain('placement');
      const stored = await ownerPool.query('select count(*) from placements where board_id = $1', [response.json().boardId]);
      expect(Number(stored.rows[0].count)).toBe(2);
    });

    it('enrolls a person of the organization and a Kleer mentor in panel roles', async () => {
      const leader = await enroll(emails.leader, ['leader', 'specialist']);
      const mentor = await enroll(emails.firmMentor, ['mentor']);

      expect([leader.statusCode, mentor.statusCode]).toEqual([201, 201]);
      leaderEnrollment = leader.json().enrollments.find((item: { role: string }) => item.role === 'leader').id;
      mentorEnrollment = mentor.json().enrollments[0].id;
      expect(leader.json().boardId).toBeNull();
      const people = (await detail()).enrollments;
      expect(people).toContainEqual(
        expect.objectContaining({ id: mentorEnrollment, email: emails.firmMentor, role: 'mentor', isFirmPerson: true }),
      );
    });

    it('refuses a Kleer person as participant, an unknown email and a person of another organization alike', async () => {
      const firmAsParticipant = await enroll(emails.firmMentor, ['participant']);
      const unknown = await enroll(`${randomUUID()}@example.test`, ['leader']);
      const ofB = await enroll(emails.personOfB, ['leader']);

      expect(firmAsParticipant.statusCode).toBe(400);
      expect(firmAsParticipant.json()).toEqual({ error: 'firm_person_cannot_participate' });
      expect([unknown.statusCode, ofB.statusCode]).toEqual([404, 404]);
      expect(ofB.json()).toEqual(unknown.json());
    });

    it('assigns the panel, names the mandatory roles still missing, and refuses an invalid assignment', async () => {
      const assign = (memberEnrollmentId: string, role: string) =>
        asAdmin('POST', `programs/${program.programId}/panel`, {
          participantEnrollmentId: participantEnrollment,
          memberEnrollmentId,
          role,
        });

      const leader = await assign(leaderEnrollment, 'leader');
      const mentor = await assign(mentorEnrollment, 'mentor');
      const wrongRole = await assign(leaderEnrollment, 'mentor');

      expect([leader.statusCode, mentor.statusCode, wrongRole.statusCode]).toEqual([201, 201, 400]);
      expect(wrongRole.json()).toEqual({ error: 'invalid_panel' });
      const program_ = await detail();
      expect(program_.panels).toHaveLength(2);
      expect(program_.missingPanelRoles).toEqual({ [participantEnrollment]: ['specialist'] });
    });

    it('removes a panel member and an enrollment', async () => {
      const panel = await asAdmin(
        'DELETE',
        `programs/${program.programId}/panel/${participantEnrollment}/${mentorEnrollment}/mentor`,
      );
      const enrollment = await asAdmin('DELETE', `programs/${program.programId}/enrollments/${mentorEnrollment}`);

      expect([panel.statusCode, enrollment.statusCode]).toEqual([204, 204]);
      expect((await detail()).enrollments.map((item: { id: string }) => item.id)).not.toContain(mentorEnrollment);
    });

    it('removes a participant with their board before the baseline, and refuses after it', async () => {
      const newcomer = await seed.person(organizationA);
      const enrolled = await enroll(await emailOf(newcomer), ['participant']);
      const keeper = await seed.person(organizationA);
      const kept = await enroll(await emailOf(keeper), ['participant']);
      await giveBaseline(ownerPool, kept.json().boardId);

      const removed = await asAdmin('DELETE', `programs/${program.programId}/enrollments/${enrolled.json().enrollments[0].id}`);
      const refused = await asAdmin('DELETE', `programs/${program.programId}/enrollments/${kept.json().enrollments[0].id}`);

      expect([removed.statusCode, refused.statusCode]).toEqual([204, 409]);
      expect(refused.json()).toEqual({ error: 'baseline_set' });
      const boards = await ownerPool.query('select id from boards where id = any($1)', [[enrolled.json().boardId, kept.json().boardId]]);
      expect(boards.rows).toEqual([{ id: kept.json().boardId }]);
    });

    it('keeps program administration away from a participant', async () => {
      const responses = await Promise.all([
        call(sessions.participant, 'GET', `${organizationA}/programs/${program.programId}`),
        call(sessions.participant, 'POST', `${organizationA}/programs/${program.programId}/enrollments`, {
          email: emails.participant,
          roles: ['leader'],
        }),
      ]);

      expect(responses.map((response) => response.statusCode)).toEqual([403, 403]);
    });

    it('lets a super administrator administer the program', async () => {
      const response = await call(sessions.superAdministrator, 'GET', `${organizationA}/programs/${program.programId}`);

      expect(response.statusCode).toBe(200);
    });
  });
});
