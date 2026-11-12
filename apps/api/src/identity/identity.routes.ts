import cookie from '@fastify/cookie';
import type { FastifyInstance, FastifyReply } from 'fastify';
import type { Database } from '../infrastructure/scoped-transaction.ts';
import type { IdentityProvider, SignInTransaction } from './identity-provider.ts';
import { createIdentityStore } from './identity-store.ts';

export type IdentityOptions = {
  database: Database;
  providers: IdentityProvider[];
  /** Address the browser uses, for example `https://app.example.com`. Provider callbacks hang from it. */
  publicUrl: URL;
  sessionTtlHours: number;
};

declare module 'fastify' {
  interface FastifyRequest {
    /** The signed-in person, or `null`. Set for every request under `/api`. */
    personId: string | null;
  }
}

const SESSION_COOKIE = 'session';
const SIGN_IN_COOKIE = 'sign_in';
const SIGN_IN_COOKIE_PATH = '/api/auth';
const SIGN_IN_MINUTES = 10;
const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

type PendingSignIn = { provider: string; transaction: SignInTransaction };

function parsePendingSignIn(raw: string | undefined): PendingSignIn | null {
  if (raw === undefined) return null;
  try {
    const value = JSON.parse(raw) as Partial<PendingSignIn>;
    const transaction = value.transaction;
    if (
      typeof value.provider === 'string' &&
      typeof transaction?.state === 'string' &&
      typeof transaction.nonce === 'string' &&
      typeof transaction.codeVerifier === 'string'
    ) {
      return { provider: value.provider, transaction };
    }
  } catch {
    // Not JSON: treated as no pending sign-in.
  }
  return null;
}

/**
 * Sign-in, sign-out and the current person. Registers directly on the given instance, so
 * `request.personId` and the origin check apply to every route registered on it afterwards.
 */
export async function registerIdentity(api: FastifyInstance, options: IdentityOptions): Promise<void> {
  const store = createIdentityStore(options.database);
  const providers = new Map(options.providers.map((provider) => [provider.id as string, provider]));
  const secure = options.publicUrl.protocol === 'https:';
  const cookieBase = { httpOnly: true, secure, sameSite: 'lax' as const };

  await api.register(cookie);
  api.decorateRequest('personId', null);

  api.addHook('onRequest', async (request, reply) => {
    // Browsers send Origin on cross-site state-changing requests; SameSite=Lax is the first
    // barrier and this is the second.
    const origin = request.headers.origin;
    if (!SAFE_METHODS.has(request.method) && origin !== undefined && origin !== options.publicUrl.origin) {
      return reply.code(403).send({ error: 'forbidden_origin' });
    }
    const token = request.cookies[SESSION_COOKIE];
    if (!token) return;
    try {
      request.personId = await store.findSessionPerson(token);
    } catch (error) {
      request.log.error(error, 'session lookup failed');
      return reply.code(503).send({ error: 'unavailable' });
    }
  });

  const callbackAddress = (providerId: string) =>
    new URL(`/api/auth/${providerId}/callback`, options.publicUrl);
  const failSignIn = (reply: FastifyReply, reason: 'not_invited' | 'sign_in_failed') =>
    reply.clearCookie(SIGN_IN_COOKIE, { path: SIGN_IN_COOKIE_PATH }).redirect(`/?error=${reason}`);

  api.get('/auth/providers', async () => ({ providers: [...providers.keys()] }));

  api.get<{ Params: { provider: string } }>('/auth/:provider/login', async (request, reply) => {
    const provider = providers.get(request.params.provider);
    if (provider === undefined) return reply.code(404).send({ error: 'unknown_provider' });

    let started;
    try {
      started = await provider.beginSignIn(callbackAddress(provider.id).href);
    } catch (error) {
      request.log.error(error, 'could not start sign-in');
      return failSignIn(reply, 'sign_in_failed');
    }
    const pending: PendingSignIn = { provider: provider.id, transaction: started.transaction };
    return reply
      .setCookie(SIGN_IN_COOKIE, JSON.stringify(pending), {
        ...cookieBase,
        path: SIGN_IN_COOKIE_PATH,
        maxAge: SIGN_IN_MINUTES * 60,
      })
      .redirect(started.authorizationUrl);
  });

  api.get<{ Params: { provider: string } }>('/auth/:provider/callback', async (request, reply) => {
    const provider = providers.get(request.params.provider);
    if (provider === undefined) return reply.code(404).send({ error: 'unknown_provider' });

    const pending = parsePendingSignIn(request.cookies[SIGN_IN_COOKIE]);
    if (pending === null || pending.provider !== provider.id) {
      return failSignIn(reply, 'sign_in_failed');
    }

    let identity;
    try {
      // Rebuilt on the public address: behind the proxy, the request's own host is internal.
      const query = request.url.includes('?') ? request.url.slice(request.url.indexOf('?')) : '';
      const callbackUrl = new URL(callbackAddress(provider.id).href + query);
      identity = await provider.completeSignIn(callbackUrl, pending.transaction);
    } catch (error) {
      request.log.warn(error, 'sign-in callback rejected');
      return failSignIn(reply, 'sign_in_failed');
    }

    let token;
    try {
      const personId = await store.resolvePerson(identity);
      if (personId === null) {
        return failSignIn(reply, 'not_invited');
      }
      token = await store.createSession(personId, options.sessionTtlHours);
    } catch (error) {
      request.log.error(error, 'could not complete sign-in');
      return failSignIn(reply, 'sign_in_failed');
    }
    return reply
      .clearCookie(SIGN_IN_COOKIE, { path: SIGN_IN_COOKIE_PATH })
      .setCookie(SESSION_COOKIE, token, {
        ...cookieBase,
        path: '/',
        maxAge: options.sessionTtlHours * 3600,
      })
      .redirect('/');
  });

  api.post('/auth/logout', async (request, reply) => {
    const token = request.cookies[SESSION_COOKIE];
    if (token) await store.deleteSession(token);
    return reply.clearCookie(SESSION_COOKIE, { path: '/' }).code(204).send();
  });

  api.get('/me', async (request, reply) => {
    const current = request.personId === null ? null : await store.describePerson(request.personId);
    if (current === null) return reply.code(401).send({ error: 'not_signed_in' });
    return current;
  });
}
