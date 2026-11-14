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
const password = z.string().max(1024);
const credentialsInput = z.object({ email, password });
const registrationInput = z.object({ email });
const confirmationInput = z.object({ token: z.string().min(1).max(200), password });

const acceptableLength = (value: string) =>
  value.length >= PASSWORD_MIN_LENGTH && value.length <= PASSWORD_MAX_LENGTH;

export type PasswordSignInOptions = {
  store: IdentityStore;
  mailer: Mailer;
  publicUrl: URL;
  /** Opens a session for the person and sets its cookie on the reply. */
  openSession: (reply: FastifyReply, personId: string) => Promise<void>;
};

const creationMail = (name: string, link: string) =>
  [
    `Hola, ${name}:`,
    '',
    'Para crear tu contraseña en Potencializador de rol, abre este enlace y elígela allí:',
    '',
    link,
    '',
    `El enlace vale por ${CONFIRMATION_HOURS} horas y sirve una sola vez.`,
    'Si no lo pediste, ignora este mensaje: no se creará ninguna contraseña.',
  ].join('\n');

const changeMail = (name: string, link: string) =>
  [
    `Hola, ${name}:`,
    '',
    'Para cambiar tu contraseña en Potencializador de rol, abre este enlace y elige una nueva:',
    '',
    link,
    '',
    `El enlace vale por ${CONFIRMATION_HOURS} horas y sirve una sola vez.`,
    'Al cambiarla se cierran tus sesiones abiertas en otros dispositivos.',
    'Si no lo pediste, ignora este mensaje: tu contraseña actual sigue funcionando.',
  ].join('\n');

/** Creating, recovering and signing in with a password, for invited persons only. */
export function registerPasswordSignIn(api: FastifyInstance, options: PasswordSignInOptions): void {
  const { store, mailer } = options;

  api.post('/auth/password/register', async (request, reply) => {
    const input = registrationInput.safeParse(request.body);
    if (!input.success) return reply.code(400).send({ error: 'invalid_request' });

    const token = randomBytes(32).toString('base64url');
    const expiresAt = new Date(Date.now() + CONFIRMATION_HOURS * 3_600_000);
    const recipient = await store.registerPassword(input.data.email, token, expiresAt);
    if (recipient !== null) {
      // Not awaited: the answer is the same, and as fast, whether the email was invited or not.
      const link = new URL(`/?confirm=${token}`, options.publicUrl).href;
      const mail = recipient.hasPassword
        ? { subject: 'Cambia tu contraseña', text: changeMail(recipient.name, link) }
        : { subject: 'Crea tu contraseña', text: creationMail(recipient.name, link) };
      mailer
        .send({ to: input.data.email, ...mail })
        .catch((error: unknown) => request.log.error(error, 'could not mail the confirmation link'));
    }
    return reply.code(202).send();
  });

  api.post('/auth/password/confirm', async (request, reply) => {
    const input = confirmationInput.safeParse(request.body);
    if (!input.success) return reply.code(400).send({ error: 'invalid_request' });
    if (!acceptableLength(input.data.password)) return reply.code(400).send({ error: 'invalid_password' });

    const personId = await store.confirmPassword(input.data.token, await hashPassword(input.data.password));
    if (personId === null) return reply.code(400).send({ error: 'confirmation_failed' });
    await options.openSession(reply, personId);
    return reply.code(204).send();
  });

  api.post('/auth/password/login', async (request, reply) => {
    const input = credentialsInput.safeParse(request.body);
    if (!input.success) return reply.code(400).send({ error: 'invalid_request' });

    const attempt = await store.beginPasswordAttempt(input.data.email);
    if (attempt?.locked) return reply.code(429).send({ error: 'too_many_attempts' });
    const matches = await verifyPassword(input.data.password, attempt?.passwordHash ?? (await decoyPasswordHash));
    if (attempt === null || !matches) return reply.code(401).send({ error: 'invalid_credentials' });

    await store.passwordSucceeded(attempt.personId);
    await options.openSession(reply, attempt.personId);
    return reply.code(204).send();
  });
}
