import pg from 'pg';

export function createPool(databaseUrl: string): pg.Pool {
  const pool = new pg.Pool({
    connectionString: databaseUrl,
    connectionTimeoutMillis: 5_000,
  });
  // An idle connection that loses the database emits 'error'. Without a listener
  // Node treats it as unhandled and the process exits; the pool already discards
  // the broken connection, so logging is enough.
  pool.on('error', (error) => {
    console.error('idle database connection failed:', error.message);
  });
  return pool;
}

export function createDatabaseProbe(pool: pg.Pool): () => Promise<void> {
  return async () => {
    await pool.query('select 1');
  };
}
