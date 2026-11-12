import { z } from 'zod';

const environmentSchema = z.object({
  DATABASE_URL: z.url(),
  HOST: z.string().default('0.0.0.0'),
  PORT: z.coerce.number().int().positive().default(3000),
});

export type Config = {
  databaseUrl: string;
  host: string;
  port: number;
};

export function loadConfig(environment: NodeJS.ProcessEnv): Config {
  const parsed = environmentSchema.parse(environment);
  return {
    databaseUrl: parsed.DATABASE_URL,
    host: parsed.HOST,
    port: parsed.PORT,
  };
}
