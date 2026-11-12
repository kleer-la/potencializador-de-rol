import { buildApp } from './app.ts';
import { loadConfig } from './config.ts';
import type { IdentityProvider } from './identity/identity-provider.ts';
import { createGoogleProvider, createMicrosoftProvider } from './identity/oidc-identity-provider.ts';
import { createDatabaseProbe, createPool } from './infrastructure/database.ts';
import { createDatabase } from './infrastructure/scoped-transaction.ts';

const config = loadConfig(process.env);
const pool = createPool(config.databaseUrl);

const providers: IdentityProvider[] = [];
if (config.google) providers.push(createGoogleProvider(config.google));
if (config.microsoft) providers.push(createMicrosoftProvider(config.microsoft));

const app = buildApp({
  databaseProbe: createDatabaseProbe(pool),
  identity: {
    database: createDatabase(pool),
    providers,
    publicUrl: config.publicUrl,
    sessionTtlHours: config.sessionTtlHours,
  },
  logger: true,
});
if (providers.length === 0) {
  app.log.warn('no sign-in provider is configured: nobody can sign in');
}

const shutdown = async () => {
  try {
    await app.close();
    await pool.end();
  } catch (error) {
    console.error('shutdown failed:', error);
    process.exitCode = 1;
  }
};
process.once('SIGTERM', shutdown);
process.once('SIGINT', shutdown);

await app.listen({ host: config.host, port: config.port });
