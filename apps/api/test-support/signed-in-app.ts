import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import type pg from 'pg';
import { buildApp } from '../src/app.ts';
import type { IdentityProvider } from '../src/identity/identity-provider.ts';
import { createDatabase } from '../src/infrastructure/scoped-transaction.ts';

export const TEST_PUBLIC_URL = new URL('https://app.example.test');

/**
 * The real application with a fake identity provider that vouches for whatever email the
 * test asks for. `signInAs` goes through the real sign-in routes and returns the session
 * cookie value.
 */
export function createSignedInApp(appPool: pg.Pool): {
  app: FastifyInstance;
  signInAs: (email: string) => Promise<string>;
} {
  let nextEmail = '';
  const provider: IdentityProvider = {
    id: 'google',
    beginSignIn: async () => ({
      authorizationUrl: 'https://idp.test/authorize',
      transaction: { state: 'state', nonce: 'nonce', codeVerifier: 'verifier' },
    }),
    completeSignIn: async () => ({
      issuer: 'https://idp.test',
      subject: randomUUID(),
      verifiedEmail: nextEmail,
    }),
  };
  const app = buildApp({
    databaseProbe: async () => {},
    identity: {
      database: createDatabase(appPool),
      providers: [provider],
      publicUrl: TEST_PUBLIC_URL,
      sessionTtlHours: 1,
    },
  });

  const signInAs = async (email: string) => {
    nextEmail = email;
    const start = await app.inject({ method: 'GET', url: '/api/auth/google/login' });
    const startCookie = start.cookies.find((cookie) => cookie.name === 'sign_in')!.value;
    const callback = await app.inject({
      method: 'GET',
      url: '/api/auth/google/callback?code=code&state=state',
      cookies: { sign_in: startCookie },
    });
    const session = callback.cookies.find((cookie) => cookie.name === 'session');
    if (session === undefined) throw new Error(`could not sign in as ${email}`);
    return session.value;
  };

  return { app, signInAs };
}
