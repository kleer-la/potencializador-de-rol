import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { createSeeder } from '../../test-support/seed.ts';
import { buildApp } from '../app.ts';
import { createDatabase } from '../infrastructure/scoped-transaction.ts';
import type { IdentityProvider, VerifiedIdentity } from './identity-provider.ts';

const PUBLIC_URL = new URL('https://app.example.test');
const FAKE_STATE = 'fake-state';

describe('sign-in with Google or Microsoft', () => {
  let ownerPool: pg.Pool;
  let appPool: pg.Pool;
  let app: FastifyInstance;
  let seed: ReturnType<typeof createSeeder>;
  /** What the fake provider will report for the next callback. */
  let nextIdentity: VerifiedIdentity;

  const fakeProvider = (id: 'google' | 'microsoft'): IdentityProvider => ({
    id,
    beginSignIn: async (redirectUri) => ({
      authorizationUrl: `https://${id}.idp.test/authorize?redirect_uri=${encodeURIComponent(redirectUri)}`,
      transaction: { state: FAKE_STATE, nonce: 'fake-nonce', codeVerifier: 'fake-verifier' },
    }),
    completeSignIn: async (callbackUrl, transaction) => {
      if (callbackUrl.searchParams.get('state') !== transaction.state) {
        throw new Error('state mismatch');
      }
      return nextIdentity;
    },
  });

  const identity = (verifiedEmail: string | null, subject = randomUUID()): VerifiedIdentity => ({
    issuer: 'https://accounts.google.com',
    subject,
    verifiedEmail,
  });

  const invitedPerson = async () => {
    const organizationId = await seed.organization();
    const personId = await seed.person(organizationId);
    const email = (
      await ownerPool.query<{ email: string }>('select email from persons where id = $1', [personId])
    ).rows[0]!.email;
    return { organizationId, personId, email };
  };

  /** Full round trip: start, then the provider callback carrying the start cookie. */
  const signIn = async (provider = 'google') => {
    const start = await app.inject({ method: 'GET', url: `/api/auth/${provider}/login` });
    const startCookie = start.cookies.find((cookie) => cookie.name === 'sign_in');
    const callback = await app.inject({
      method: 'GET',
      url: `/api/auth/${provider}/callback?code=fake-code&state=${FAKE_STATE}`,
      cookies: startCookie ? { sign_in: startCookie.value } : {},
    });
    return { start, callback, session: callback.cookies.find((cookie) => cookie.name === 'session') };
  };

  const me = (sessionValue: string | undefined) =>
    app.inject({
      method: 'GET',
      url: '/api/me',
      cookies: sessionValue === undefined ? {} : { session: sessionValue },
    });

  beforeAll(async () => {
    ownerPool = new pg.Pool({ connectionString: inject('ownerDatabaseUrl') });
    appPool = new pg.Pool({ connectionString: inject('appDatabaseUrl') });
    seed = createSeeder(ownerPool);
    app = buildApp({
      databaseProbe: async () => {},
      identity: {
        database: createDatabase(appPool),
        providers: [fakeProvider('google'), fakeProvider('microsoft')],
        publicUrl: PUBLIC_URL,
        sessionTtlHours: 12,
      },
    });
  });

  afterAll(async () => {
    await app.close();
    await appPool.end();
    await ownerPool.end();
  });

  it('lists the configured providers', async () => {
    const response = await app.inject({ method: 'GET', url: '/api/auth/providers' });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ providers: ['google', 'microsoft'] });
  });

  it('starts sign-in by redirecting to the provider with the public callback address', async () => {
    const response = await app.inject({ method: 'GET', url: '/api/auth/microsoft/login' });

    expect(response.statusCode).toBe(302);
    expect(response.headers.location).toBe(
      'https://microsoft.idp.test/authorize?redirect_uri=' +
        encodeURIComponent('https://app.example.test/api/auth/microsoft/callback'),
    );
    const cookie = response.cookies.find((candidate) => candidate.name === 'sign_in');
    expect(cookie).toMatchObject({ httpOnly: true, secure: true, sameSite: 'Lax', path: '/api/auth' });
  });

  it('answers 404 for a provider that is not configured', async () => {
    const login = await app.inject({ method: 'GET', url: '/api/auth/facebook/login' });
    const callback = await app.inject({ method: 'GET', url: '/api/auth/facebook/callback?code=x' });

    expect(login.statusCode).toBe(404);
    expect(callback.statusCode).toBe(404);
  });

  it('signs in an invited person and reports who they are', async () => {
    const invited = await invitedPerson();
    await seed.membership(invited.organizationId, invited.personId, 'map_designer');
    nextIdentity = identity(invited.email.toUpperCase());

    const { callback, session } = await signIn();
    const response = await me(session?.value);

    expect(callback.statusCode).toBe(302);
    expect(callback.headers.location).toBe('/');
    expect(session).toMatchObject({ httpOnly: true, secure: true, sameSite: 'Lax', path: '/' });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      person: { id: invited.personId, name: 'Test Person', email: invited.email },
      isSuperAdmin: false,
      memberships: [
        {
          organizationId: invited.organizationId,
          organizationName: expect.stringContaining('Organization'),
          role: 'map_designer',
        },
      ],
    });
  });

  it('reports a person of the mentoring firm as super administrator', async () => {
    const personId = await seed.person(null);
    const email = (await ownerPool.query('select email from persons where id = $1', [personId])).rows[0]
      .email;
    nextIdentity = identity(email);

    const { session } = await signIn();
    const response = await me(session?.value);

    expect(response.json()).toMatchObject({ isSuperAdmin: true, memberships: [] });
  });

  it('refuses a person who was not invited and creates no account', async () => {
    const email = `${randomUUID()}@example.test`;
    nextIdentity = identity(email);

    const { callback, session } = await signIn();

    expect(callback.statusCode).toBe(302);
    expect(callback.headers.location).toBe('/?error=not_invited');
    expect(session).toBeUndefined();
    const stored = await ownerPool.query('select 1 from persons where lower(email) = lower($1)', [email]);
    expect(stored.rowCount).toBe(0);
  });

  it('refuses an invited person when the provider does not vouch for the email', async () => {
    await invitedPerson();
    nextIdentity = identity(null);

    const { callback, session } = await signIn();

    expect(callback.headers.location).toBe('/?error=not_invited');
    expect(session).toBeUndefined();
  });

  it('recognizes a returning person by the provider account, not by the email', async () => {
    const invited = await invitedPerson();
    const subject = randomUUID();
    nextIdentity = identity(invited.email, subject);
    await signIn();

    // Later the provider reports no verified email, or even someone else's.
    nextIdentity = identity(null, subject);
    const withoutEmail = await signIn();
    const other = await invitedPerson();
    nextIdentity = identity(other.email, subject);
    const withOtherEmail = await signIn();

    expect((await me(withoutEmail.session?.value)).json().person.id).toBe(invited.personId);
    expect((await me(withOtherEmail.session?.value)).json().person.id).toBe(invited.personId);
  });

  it('refuses a callback that does not continue a sign-in started in this browser', async () => {
    const invited = await invitedPerson();
    nextIdentity = identity(invited.email);
    const start = await app.inject({ method: 'GET', url: '/api/auth/google/login' });
    const startCookie = start.cookies.find((cookie) => cookie.name === 'sign_in')!.value;

    const withoutCookie = await app.inject({
      method: 'GET',
      url: `/api/auth/google/callback?code=fake-code&state=${FAKE_STATE}`,
    });
    const wrongState = await app.inject({
      method: 'GET',
      url: '/api/auth/google/callback?code=fake-code&state=another-state',
      cookies: { sign_in: startCookie },
    });
    const otherProvider = await app.inject({
      method: 'GET',
      url: `/api/auth/microsoft/callback?code=fake-code&state=${FAKE_STATE}`,
      cookies: { sign_in: startCookie },
    });

    for (const response of [withoutCookie, wrongState, otherProvider]) {
      expect(response.statusCode).toBe(302);
      expect(response.headers.location).toBe('/?error=sign_in_failed');
      expect(response.cookies.find((cookie) => cookie.name === 'session')).toBeUndefined();
    }
  });

  it('fails sign-in cleanly when the provider cannot be reached', async () => {
    const unreachable: IdentityProvider = {
      id: 'google',
      beginSignIn: async () => {
        throw new Error('discovery failed');
      },
      completeSignIn: async () => {
        throw new Error('unreachable');
      },
    };
    const isolated = buildApp({
      databaseProbe: async () => {},
      identity: {
        database: createDatabase(appPool),
        providers: [unreachable],
        publicUrl: PUBLIC_URL,
        sessionTtlHours: 12,
      },
    });

    const response = await isolated.inject({ method: 'GET', url: '/api/auth/google/login' });
    await isolated.close();

    expect(response.statusCode).toBe(302);
    expect(response.headers.location).toBe('/?error=sign_in_failed');
    expect(response.cookies.find((cookie) => cookie.name === 'sign_in')?.value ?? '').toBe('');
  });

  describe('when the database is unavailable', () => {
    let brokenPool: pg.Pool;
    let broken: FastifyInstance;

    beforeAll(() => {
      brokenPool = new pg.Pool({
        connectionString: 'postgres://nobody:nothing@127.0.0.1:1/none',
        connectionTimeoutMillis: 500,
      });
      broken = buildApp({
        databaseProbe: async () => {
          throw new Error('database down');
        },
        identity: {
          database: createDatabase(brokenPool),
          providers: [fakeProvider('google')],
          publicUrl: PUBLIC_URL,
          sessionTtlHours: 12,
        },
      });
    });

    afterAll(async () => {
      await broken.close();
      await brokenPool.end();
    });

    it('health still answers 503 unavailable for a browser that carries a session cookie', async () => {
      const response = await broken.inject({
        method: 'GET',
        url: '/api/health',
        cookies: { session: 'any-session' },
      });

      expect(response.statusCode).toBe(503);
      expect(response.json()).toEqual({ status: 'unavailable' });
    });

    it('answers 503 instead of an internal error to a request with a session cookie', async () => {
      const response = await broken.inject({
        method: 'GET',
        url: '/api/me',
        cookies: { session: 'any-session' },
      });

      expect(response.statusCode).toBe(503);
      expect(response.json()).toEqual({ error: 'unavailable' });
    });

    it('ends the sign-in callback with the failure redirect and clears the start cookie', async () => {
      nextIdentity = identity(`${randomUUID()}@example.test`);
      const start = await broken.inject({ method: 'GET', url: '/api/auth/google/login' });
      const startCookie = start.cookies.find((cookie) => cookie.name === 'sign_in')!.value;

      const callback = await broken.inject({
        method: 'GET',
        url: `/api/auth/google/callback?code=fake-code&state=${FAKE_STATE}`,
        cookies: { sign_in: startCookie },
      });

      expect(callback.statusCode).toBe(302);
      expect(callback.headers.location).toBe('/?error=sign_in_failed');
      expect(callback.cookies.find((cookie) => cookie.name === 'sign_in')?.value).toBe('');
      expect(callback.cookies.find((cookie) => cookie.name === 'session')).toBeUndefined();
    });
  });

  it('answers 401 on /api/me without a session, with an unknown one, or with an expired one', async () => {
    const invited = await invitedPerson();
    nextIdentity = identity(invited.email);
    const { session } = await signIn();
    await ownerPool.query("update sessions set expires_at = now() - interval '1 second' where person_id = $1", [
      invited.personId,
    ]);

    const responses = [await me(undefined), await me('unknown-session'), await me(session?.value)];

    expect(responses.map((response) => response.statusCode)).toEqual([401, 401, 401]);
  });

  it('stores only a hash of the session value', async () => {
    const invited = await invitedPerson();
    nextIdentity = identity(invited.email);

    const { session } = await signIn();

    const stored = await ownerPool.query<{ token_hash: string }>(
      'select token_hash from sessions where person_id = $1',
      [invited.personId],
    );
    expect(stored.rows).toHaveLength(1);
    expect(stored.rows[0]!.token_hash).not.toBe(session!.value);
    expect(session!.value.length).toBeGreaterThanOrEqual(43);
  });

  it('ends the session on sign-out', async () => {
    const invited = await invitedPerson();
    nextIdentity = identity(invited.email);
    const { session } = await signIn();

    const signOut = await app.inject({
      method: 'POST',
      url: '/api/auth/logout',
      cookies: { session: session!.value },
      headers: { origin: PUBLIC_URL.origin },
    });
    const afterwards = await me(session!.value);

    expect(signOut.statusCode).toBe(204);
    expect(signOut.cookies.find((cookie) => cookie.name === 'session')?.value).toBe('');
    expect(afterwards.statusCode).toBe(401);
  });

  it('refuses a state-changing request that comes from another site', async () => {
    const invited = await invitedPerson();
    nextIdentity = identity(invited.email);
    const { session } = await signIn();

    const response = await app.inject({
      method: 'POST',
      url: '/api/auth/logout',
      cookies: { session: session!.value },
      headers: { origin: 'https://evil.example.test' },
    });

    expect(response.statusCode).toBe(403);
    expect((await me(session!.value)).statusCode).toBe(200);
  });
});
