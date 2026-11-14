import { randomBytes } from 'node:crypto';
import type { FastifyInstance, FastifyReply } from 'fastify';
import { z } from 'zod';
import type { IdentityStore } from './identity-store.ts';
import type { Mailer } from './mailer.ts';
import {
  decoyPasswordHash,
  hashPassword,
  PASSWORD_MAX_LENGTH,
  PASSWORD_MIN_LENGTH,
  verifyPassword,
} from './password-hasher.ts';

const CONFIRMATION_HOURS = 24;

const email = z.string().trim().toLowerCase().pipe(z.email().max(254));
const credentialsInput = z.object({ email, password: z.string().max(1024) });
const confirmationInput = z.object({ token: z.string().min(1).max(200) });

export type PasswordSignInOptions = {
  store: IdentityStore;
  mailer: Mailer;
  publicUrl: URL;
  /** Opens a session for the person and sets its cookie on the reply. */
  openSession: (reply: FastifyReply, personId: string) => Promise<void>;
};

const confirmationMail = (name: string, link: string) =>
  [
    `Hola, ${name}:`,
    '',
    'Para terminar de crear tu contraseña en Potencializador de rol, abre este enlace:',
    '',
    link,
    '',
    `El enlace vale por ${CONFIRMATION_HOURS} horas y sirve una sola vez.`,
    'Si no fuiste tú, ignora este mensaje: tu contraseña no se activará.',
  ].join('\n');

/** Registration, email confirmation and sign-in with a password, for invited persons only. */
export function registerPasswordSignIn(api: FastifyInstance, options: PasswordSignInOptions): void {
  const { store, mailer } = options;

  api.post('/auth/password/register', async (request, reply) => {
    const input = credentialsInput.safeParse(request.body);
    if (!input.success) return reply.code(400).send({ error: 'invalid_request' });
    const { password } = input.data;
    if (password.length < PASSWORD_MIN_LENGTH || password.length > PASSWORD_MAX_LENGTH) {
      return reply.code(400).send({ error: 'invalid_password' });
    }

    const token = randomBytes(32).toString('base64url');
    const expiresAt = new Date(Date.now() + CONFIRMATION_HOURS * 3_600_000);
    const name = await store.registerPassword(input.data.email, await hashPassword(password), token, expiresAt);
    if (name !== null) {
      // Not awaited: the answer is the same, and as fast, whether the email was invited or not.
      const link = new URL(`/?confirm=${token}`, options.publicUrl).href;
      mailer
        .send({ to: input.data.email, subject: 'Confirma tu correo', text: confirmationMail(name, link) })
        .catch((error: unknown) => request.log.error(error, 'could not mail the confirmation link'));
    }
    return reply.code(202).send();
  });

  api.post('/auth/password/confirm', async (request, reply) => {
    const input = confirmationInput.safeParse(request.body);
    if (!input.success) return reply.code(400).send({ error: 'invalid_request' });
    const personId = await store.confirmPassword(input.data.token);
    if (personId === null) return reply.code(400).send({ error: 'confirmation_failed' });
    await options.openSession(reply, personId);
    return reply.code(204).send();
  });

  api.post('/auth/password/login', async (request, reply) => {
    const input = credentialsInput.safeParse(request.body);
    if (!input.success) return reply.code(400).send({ error: 'invalid_request' });

    const credential = await store.findPassword(input.data.email);
    if (credential?.locked) return reply.code(429).send({ error: 'too_many_attempts' });
    const matches = await verifyPassword(
      input.data.password,
      credential?.passwordHash ?? (await decoyPasswordHash),
    );
    if (credential === null) return reply.code(401).send({ error: 'invalid_credentials' });

    await store.recordPasswordAttempt(credential.personId, matches);
    if (!matches) return reply.code(401).send({ error: 'invalid_credentials' });
    await options.openSession(reply, credential.personId);
    return reply.code(204).send();
  });
}
