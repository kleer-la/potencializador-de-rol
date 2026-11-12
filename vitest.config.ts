import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['packages/*/src/**/*.test.ts', 'apps/*/src/**/*.test.{ts,tsx}'],
    // One throwaway PostgreSQL for the run; needs a running Docker daemon.
    globalSetup: ['apps/api/test-support/postgres.global-setup.ts'],
    hookTimeout: 120_000,
  },
});
