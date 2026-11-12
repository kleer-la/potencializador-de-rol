import { z } from 'zod';
import { ensureSuperAdministrators, parseEmailList } from './bootstrap.ts';
import { migrate } from './migrate.ts';

const environment = z
  .object({
    MIGRATION_DATABASE_URL: z.url(),
    APP_DB_PASSWORD: z.string().min(1),
    SUPER_ADMIN_EMAILS: z.string().optional(),
  })
  .parse(process.env);

const applied = await migrate({
  ownerDatabaseUrl: environment.MIGRATION_DATABASE_URL,
  appRolePassword: environment.APP_DB_PASSWORD,
});
console.log(applied.length === 0 ? 'no pending migrations' : `applied: ${applied.join(', ')}`);

const superAdministrators = await ensureSuperAdministrators(
  environment.MIGRATION_DATABASE_URL,
  parseEmailList(environment.SUPER_ADMIN_EMAILS),
);
if (superAdministrators.created.length > 0) {
  console.log(`super administrators created: ${superAdministrators.created.length}`);
}
if (superAdministrators.skipped.length > 0) {
  console.warn(
    `SUPER_ADMIN_EMAILS: ${superAdministrators.skipped.length} email(s) already belong to a person of an organization and were not changed`,
  );
}
