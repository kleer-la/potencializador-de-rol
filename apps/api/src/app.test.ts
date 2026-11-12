import { describe, expect, it } from 'vitest';
import { buildApp } from './app.ts';

describe('GET /api/health', () => {
  it('answers 200 with status ok when the database is reachable', async () => {
    const app = buildApp({ databaseProbe: async () => {} });

    const response = await app.inject({ method: 'GET', url: '/api/health' });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ status: 'ok' });
  });

  it('answers 503 when the database is not reachable', async () => {
    const app = buildApp({
      databaseProbe: async () => {
        throw new Error('connection refused');
      },
    });

    const response = await app.inject({ method: 'GET', url: '/api/health' });

    expect(response.statusCode).toBe(503);
    expect(response.json()).toEqual({ status: 'unavailable' });
  });
});
