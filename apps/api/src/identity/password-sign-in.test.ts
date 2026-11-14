import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import pg from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, inject, it } from 'vitest';
import { createSeeder } from '../../test-support/seed.ts';
import { buildApp } from '../app.ts';
import { createDatabase } from '../infrastructure/scoped-transaction.ts';
import type { MailMessage, Mailer } from './mailer.ts';

const PUBLIC_URL = new URL('https://app.example.test');
const PASSWORD = 'correct horse battery';

describe('sign-in with an email and a password', () => {
  let ownerPool: pg.Pool;
  let appPool: pg.Pool;
  let app: FastifyInstance;
  let seed: ReturnType<typeof createSeeder>;
  let sent: MailMessage[];
  let mailer: Mailer;

  const invitedPerson = async () => {
    const organizationId = await seed.organization();
    const personId = await seed.person(organizationId);
    const email = (
      await ownerPool.query<{ email: string }>('select email from persons where id = $1', [personId])
    ).rows[0]!.email;
    return { personId, email };
  };

  const register = (email: string) =>
    app.inject({ method: 'POST', url: '/api/auth/password/register', payload: { email } });
  const confirm = (token: string, password = PASSWORD) =>
    app.inject({ method: 'POST', url: '/api/auth/password/confirm', payload: { token, password } });
  const login = (email: string, password = PASSWORD) =>
    app.inject({ method: 'POST', url: '/api/auth/password/login', payload: { email, password } });
  const me = (session: string | undefined) =>
    app.inject({ method: 'GET', url: '/api/me', cookies: session === undefined ? {} : { session } });
  const sessionOf = (response: Awaited<ReturnType<typeof login>>) =>
    response.cookies.find((cookie) => cookie.name === 'session');

  /** Mail goes out in the background; wait until it was handed to the mailer. */
  const nextMail = async () => {
    for (let attempt = 0; attempt < 50 && sent.length === 0; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    return sent.shift();
  };
  const tokenFrom = (mail: MailMessage | undefined) => {
    const link = mail?.text.match(/https:\/\/\S+/)?.[0];
    return link === undefined ? undefined : (new URL(link).searchParams.get('confirm') ?? undefined);
  };

  /** Registers and confirms; returns the person and the confirmation answer. */
  const confirmedPerson = async () => {
    const invited = await invitedPerson();
    await register(invited.email);
    const confirmation = await confirm(tokenFrom(await nextMail())!);
    return { ...invited, confirmation };
  };

  beforeAll(async () => {
    ownerPool = new pg.Pool({ connectionString: inject('ownerDatabaseUrl') });
    appPool = new pg.Pool({ connectionString: inject('appDatabaseUrl') });
    seed = createSeeder(ownerPool);
    mailer = { send: async (message) => void sent.push(message) };
    app = buildApp({
      databaseProbe: async () => {},
      identity: {
        database: createDatabase(appPool),
        providers: [],
        publicUrl: PUBLIC_URL,
        sessionTtlHours: 12,
        password: { mailer: { send: (message) => mailer.send(message) } },
      },
    });
  });

  beforeEach(() => {
    sent = [];
  });

  afterAll(async () => {
    await app.close();
    await appPool.end();
    await ownerPool.end();
  });

  it('offers password sign-in when mail is configured', async () => {
    const response = await app.inject({ method: 'GET', url: '/api/auth/providers' });

    expect(response.json()).toEqual({ providers: [], password: true });
  });

  it('mails an invited person a link to the public address where they choose the password and are signed in', async () => {
    const invited = await invitedPerson();

    const registration = await register(invited.email.toUpperCase());
    const mail = await nextMail();

    expect(registration.statusCode).toBe(202);
    expect(mail).toMatchObject({ to: invited.email, subject: 'Crea tu contraseña' });
    expect(mail!.text).toContain('Hola, Test Person:');
    expect(mail!.text).toMatch(/https:\/\/app\.example\.test\/\?confirm=[\w-]{43}\b/);

    const confirmation = await confirm(tokenFrom(mail)!);
    expect(confirmation.statusCode).toBe(204);
    const session = sessionOf(confirmation);
    expect(session).toMatchObject({ httpOnly: true, secure: true, sameSite: 'Lax', path: '/' });
    expect((await me(session!.value)).json()).toMatchObject({ person: { id: invited.personId } });
  });

  it('answers the same for an email that was not invited, mails nothing and stores nothing', async () => {
    const email = `${randomUUID()}@example.test`;

    const registration = await register(email);

    expect(registration.statusCode).toBe(202);
    expect(await nextMail()).toBeUndefined();
    const stored = await ownerPool.query('select 1 from password_credentials c join persons p on p.id = c.person_id where p.email = $1', [email]);
    expect(stored.rowCount).toBe(0);
  });

  it('refuses a password shorter than 10 or longer than 128 characters, keeping the link usable', async () => {
    const invited = await invitedPerson();
    await register(invited.email);
    const token = tokenFrom(await nextMail())!;

    for (const password of ['x'.repeat(9), 'x'.repeat(129)]) {
      const response = await confirm(token, password);
      expect(response.statusCode).toBe(400);
      expect(response.json()).toEqual({ error: 'invalid_password' });
      expect(sessionOf(response)).toBeUndefined();
    }
    expect((await confirm(token, 'x'.repeat(10))).statusCode).toBe(204);
  });

  it('refuses a malformed registration and mails nothing', async () => {
    const response = await register('not-an-email');

    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({ error: 'invalid_request' });
    expect(await nextMail()).toBeUndefined();
  });

  it('never lets whoever asks for the link choose the password', async () => {
    const invited = await invitedPerson();
    // Anyone may ask for the link of an invited email; the request carries no password.
    const request = await app.inject({
      method: 'POST',
      url: '/api/auth/password/register',
      payload: { email: invited.email, password: 'an attacker password' },
    });
    expect(request.statusCode).toBe(202);

    // The person opens the link from their mailbox and chooses their own password.
    expect((await confirm(tokenFrom(await nextMail())!, PASSWORD)).statusCode).toBe(204);

    expect((await login(invited.email, 'an attacker password')).statusCode).toBe(401);
    expect((await login(invited.email, PASSWORD)).statusCode).toBe(204);
  });

  it('does not sign in before the link was used to choose a password', async () => {
    const invited = await invitedPerson();
    await register(invited.email);

    const response = await login(invited.email);

    expect(response.statusCode).toBe(401);
    expect(response.json()).toEqual({ error: 'invalid_credentials' });
    expect(sessionOf(response)).toBeUndefined();
  });

  it('signs in with a confirmed password, ignoring the case of the email', async () => {
    const person = await confirmedPerson();

    const response = await login(person.email.toUpperCase());

    expect(response.statusCode).toBe(204);
    expect((await me(sessionOf(response)!.value)).json()).toMatchObject({ person: { id: person.personId } });
  });

  it('answers invalid_credentials for a wrong password and for an unknown email alike', async () => {
    const person = await confirmedPerson();

    const wrongPassword = await login(person.email, 'not the password');
    const unknownEmail = await login(`${randomUUID()}@example.test`);

    for (const response of [wrongPassword, unknownEmail]) {
      expect(response.statusCode).toBe(401);
      expect(response.json()).toEqual({ error: 'invalid_credentials' });
      expect(sessionOf(response)).toBeUndefined();
    }
  });

  it('locks the password for 15 minutes after 5 failures in a row', async () => {
    const person = await confirmedPerson();

    for (let attempt = 0; attempt < 5; attempt += 1) {
      expect((await login(person.email, 'not the password')).statusCode).toBe(401);
    }
    const locked = await login(person.email);

    expect(locked.statusCode).toBe(429);
    expect(locked.json()).toEqual({ error: 'too_many_attempts' });
    expect(sessionOf(locked)).toBeUndefined();

    await ownerPool.query(
      "update password_credentials set locked_until = now() - interval '1 second' where person_id = $1",
      [person.personId],
    );
    expect((await login(person.email)).statusCode).toBe(204);
  });

  it('checks no more than 5 passwords per lock, even when they arrive at the same time', async () => {
    const person = await confirmedPerson();

    const wrong = await Promise.all(
      Array.from({ length: 20 }, () => login(person.email, 'not the password')),
    );
    const right = await login(person.email);

    expect(wrong.filter((response) => response.statusCode === 401)).toHaveLength(5);
    expect(wrong.filter((response) => response.statusCode === 429)).toHaveLength(15);
    expect(right.statusCode).toBe(429);
    expect(sessionOf(right)).toBeUndefined();
  });

  it('clears the failure count after a successful sign-in', async () => {
    const person = await confirmedPerson();
    for (let attempt = 0; attempt < 4; attempt += 1) await login(person.email, 'not the password');

    expect((await login(person.email)).statusCode).toBe(204);
    for (let attempt = 0; attempt < 4; attempt += 1) await login(person.email, 'not the password');
    expect((await login(person.email)).statusCode).toBe(204);
  });

  it('accepts a confirmation link only once', async () => {
    const invited = await invitedPerson();
    await register(invited.email);
    const token = tokenFrom(await nextMail())!;

    expect((await confirm(token)).statusCode).toBe(204);
    const again = await confirm(token);

    expect(again.statusCode).toBe(400);
    expect(again.json()).toEqual({ error: 'confirmation_failed' });
    expect(sessionOf(again)).toBeUndefined();
  });

  it('refuses an expired or unknown confirmation link', async () => {
    const invited = await invitedPerson();
    await register(invited.email);
    const token = tokenFrom(await nextMail())!;
    await ownerPool.query(
      "update password_credentials set confirmation_expires_at = now() - interval '1 second' where person_id = $1",
      [invited.personId],
    );

    expect((await confirm(token)).json()).toEqual({ error: 'confirmation_failed' });
    expect((await confirm('unknown-token')).json()).toEqual({ error: 'confirmation_failed' });
    expect((await login(invited.email)).statusCode).toBe(401);
  });

  it('replaces a pending link when asked again', async () => {
    const invited = await invitedPerson();
    await register(invited.email);
    const firstToken = tokenFrom(await nextMail())!;
    await register(invited.email);
    const secondToken = tokenFrom(await nextMail())!;

    expect((await confirm(firstToken)).statusCode).toBe(400);
    expect((await confirm(secondToken)).statusCode).toBe(204);
  });

  it('mails no link to a person who already has a password, and keeps it', async () => {
    const person = await confirmedPerson();

    expect((await register(person.email)).statusCode).toBe(202);

    expect(await nextMail()).toBeUndefined();
    expect((await login(person.email)).statusCode).toBe(204);
  });

  it('stores only a hash of the link, then only a hash of the password', async () => {
    const invited = await invitedPerson();
    await register(invited.email);
    const token = tokenFrom(await nextMail())!;
    const pending = (
      await ownerPool.query<{ password_hash: string | null; confirmation_token_hash: string }>(
        'select password_hash, confirmation_token_hash from password_credentials where person_id = $1',
        [invited.personId],
      )
    ).rows[0]!;
    expect(pending.password_hash).toBeNull();
    expect(pending.confirmation_token_hash).not.toBe(token);
    await confirm(token);

    const stored = (
      await ownerPool.query<{ password_hash: string; confirmation_token_hash: string }>(
        'select password_hash, confirmation_token_hash from password_credentials where person_id = $1',
        [invited.personId],
      )
    ).rows[0]!;

    expect(stored.password_hash).toMatch(/^scrypt\$16384\$8\$1\$/);
    expect(stored.password_hash).not.toContain(PASSWORD);
    expect(stored.confirmation_token_hash).toBeNull();
  });

  it('answers 202 even when the mail cannot be sent', async () => {
    const invited = await invitedPerson();
    const working = mailer;
    mailer = { send: async () => Promise.reject(new Error('smtp down')) };
    try {
      expect((await register(invited.email)).statusCode).toBe(202);
    } finally {
      mailer = working;
    }
  });

  it('gives the API role no direct access to the passwords', async () => {
    await expect(appPool.query('select * from password_credentials')).rejects.toThrow(/permission denied/);
  });
});

describe('without mail configured', () => {
  it('neither offers nor accepts password sign-in', async () => {
    const appPool = new pg.Pool({ connectionString: inject('appDatabaseUrl') });
    const app = buildApp({
      databaseProbe: async () => {},
      identity: { database: createDatabase(appPool), providers: [], publicUrl: PUBLIC_URL, sessionTtlHours: 12 },
    });
    try {
      expect((await app.inject({ method: 'GET', url: '/api/auth/providers' })).json()).toEqual({
        providers: [],
        password: false,
      });
      const login = await app.inject({
        method: 'POST',
        url: '/api/auth/password/login',
        payload: { email: 'someone@example.test', password: PASSWORD },
      });
      expect(login.statusCode).toBe(404);
    } finally {
      await app.close();
      await appPool.end();
    }
  });
});
