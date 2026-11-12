import { PostgreSqlContainer } from '@testcontainers/postgresql';
import type { TestProject } from 'vitest/node';
import { APP_ROLE, migrate } from '../src/infrastructure/migrate.ts';

const APP_ROLE_PASSWORD = 'app-role-test-password';

/**
 * Starts one throwaway PostgreSQL for the whole run and migrates it.
 * Tests receive two URLs: the owner (to seed data, bypassing Row Level Security)
 * and the application role (what the API uses in production).
 */
export default async function setup(project: TestProject) {
  const container = await new PostgreSqlContainer('postgres:17-alpine').start();
  const ownerDatabaseUrl = container.getConnectionUri();
  await migrate({ ownerDatabaseUrl, appRolePassword: APP_ROLE_PASSWORD });

  const appDatabaseUrl = new URL(ownerDatabaseUrl);
  appDatabaseUrl.username = APP_ROLE;
  appDatabaseUrl.password = APP_ROLE_PASSWORD;

  project.provide('ownerDatabaseUrl', ownerDatabaseUrl);
  project.provide('appDatabaseUrl', appDatabaseUrl.toString());

  return async () => {
    await container.stop();
  };
}

declare module 'vitest' {
  export interface ProvidedContext {
    ownerDatabaseUrl: string;
    appDatabaseUrl: string;
  }
}
