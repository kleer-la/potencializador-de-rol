import { z } from 'zod';
import type { SmtpSettings } from './identity/mailer.ts';

/** Compose passes unset variables as empty strings; treat them as absent. */
const optionalText = z.preprocess(
  (value) => (value === '' ? undefined : value),
  z.string().min(1).optional(),
);

const environmentSchema = z
  .object({
    DATABASE_URL: z.url(),
    HOST: z.string().default('0.0.0.0'),
    PORT: z.coerce.number().int().positive().default(3000),
    PUBLIC_URL: z.url(),
    SESSION_TTL_HOURS: z.coerce.number().int().positive().max(720).default(12),
    GOOGLE_CLIENT_ID: optionalText,
    GOOGLE_CLIENT_SECRET: optionalText,
    MICROSOFT_CLIENT_ID: optionalText,
    MICROSOFT_CLIENT_SECRET: optionalText,
    SMTP_HOST: optionalText,
    SMTP_PORT: z.preprocess((value) => (value === '' ? undefined : value), z.coerce.number().int().positive().default(465)),
    SMTP_USER: optionalText,
    SMTP_PASSWORD: optionalText,
    SMTP_FROM: optionalText,
    MICROSOFT_TENANT: z.preprocess(
      (value) => (value === '' ? undefined : value),
      z.string().regex(/^[A-Za-z0-9.-]+$/).default('common'),
    ),
  })
  .refine((env) => (env.GOOGLE_CLIENT_ID === undefined) === (env.GOOGLE_CLIENT_SECRET === undefined), {
    message: 'GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET must be set together',
  })
  .refine((env) => (env.MICROSOFT_CLIENT_ID === undefined) === (env.MICROSOFT_CLIENT_SECRET === undefined), {
    message: 'MICROSOFT_CLIENT_ID and MICROSOFT_CLIENT_SECRET must be set together',
  })
  .refine(
    (env) => {
      const set = [env.SMTP_HOST, env.SMTP_USER, env.SMTP_PASSWORD, env.SMTP_FROM].filter((value) => value !== undefined);
      return set.length === 0 || set.length === 4;
    },
    { message: 'SMTP_HOST, SMTP_USER, SMTP_PASSWORD and SMTP_FROM must be set together' },
  );

export type Config = {
  databaseUrl: string;
  host: string;
  port: number;
  publicUrl: URL;
  sessionTtlHours: number;
  /** Absent when the provider is not configured; its sign-in is then not offered. */
  google?: { clientId: string; clientSecret: string };
  microsoft?: { clientId: string; clientSecret: string; tenant: string };
  /** Absent when mail is not configured; sign-in with a password is then not offered. */
  smtp?: SmtpSettings;
};

export function loadConfig(environment: NodeJS.ProcessEnv): Config {
  const env = environmentSchema.parse(environment);
  return {
    databaseUrl: env.DATABASE_URL,
    host: env.HOST,
    port: env.PORT,
    publicUrl: new URL(env.PUBLIC_URL),
    sessionTtlHours: env.SESSION_TTL_HOURS,
    ...(env.GOOGLE_CLIENT_ID !== undefined && env.GOOGLE_CLIENT_SECRET !== undefined
      ? { google: { clientId: env.GOOGLE_CLIENT_ID, clientSecret: env.GOOGLE_CLIENT_SECRET } }
      : {}),
    ...(env.MICROSOFT_CLIENT_ID !== undefined && env.MICROSOFT_CLIENT_SECRET !== undefined
      ? {
          microsoft: {
            clientId: env.MICROSOFT_CLIENT_ID,
            clientSecret: env.MICROSOFT_CLIENT_SECRET,
            tenant: env.MICROSOFT_TENANT,
          },
        }
      : {}),
    ...(env.SMTP_HOST !== undefined &&
    env.SMTP_USER !== undefined &&
    env.SMTP_PASSWORD !== undefined &&
    env.SMTP_FROM !== undefined
      ? {
          smtp: {
            host: env.SMTP_HOST,
            port: env.SMTP_PORT,
            user: env.SMTP_USER,
            password: env.SMTP_PASSWORD,
            from: env.SMTP_FROM,
          },
        }
      : {}),
  };
}
