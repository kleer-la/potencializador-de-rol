import { z } from 'zod';
import { migrate } from './migrate.ts';

const environment = z
  .object({
    MIGRATION_DATABASE_URL: z.url(),
    APP_DB_PASSWORD: z.string().min(1),
  })
  .parse(process.env);

const applied = await migrate({
  ownerDatabaseUrl: environment.MIGRATION_DATABASE_URL,
  appRolePassword: environment.APP_DB_PASSWORD,
});
console.log(applied.length === 0 ? 'no pending migrations' : `applied: ${applied.join(', ')}`);
