import { buildApp } from './app.ts';
import { loadConfig } from './config.ts';
import { createDatabaseProbe, createPool } from './infrastructure/database.ts';

const config = loadConfig(process.env);
const pool = createPool(config.databaseUrl);
const app = buildApp({ databaseProbe: createDatabaseProbe(pool), logger: true });

const shutdown = async () => {
  await app.close();
  await pool.end();
};
process.once('SIGTERM', shutdown);
process.once('SIGINT', shutdown);

await app.listen({ host: config.host, port: config.port });
