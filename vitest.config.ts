import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: 'api',
          include: ['apps/api/src/**/*.test.ts'],
          // One throwaway PostgreSQL for the run; needs a running Docker daemon.
          globalSetup: ['apps/api/test-support/postgres.global-setup.ts'],
          hookTimeout: 120_000,
        },
      },
      {
        // No database: `npx vitest run --project unit` works without Docker.
        test: {
          name: 'unit',
          include: ['packages/*/src/**/*.test.ts', 'apps/web/src/**/*.test.{ts,tsx}'],
        },
      },
    ],
  },
});
