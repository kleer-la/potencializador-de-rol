import { describe, expect, it } from 'vitest';
import { loadConfig } from './config.ts';

const required = {
  DATABASE_URL: 'postgres://user:secret@db:5432/app',
  PUBLIC_URL: 'http://localhost:8080',
};

describe('loadConfig', () => {
  it('offers no provider when none is configured, including empty values from Compose', () => {
    const config = loadConfig({
      ...required,
      GOOGLE_CLIENT_ID: '',
      GOOGLE_CLIENT_SECRET: '',
      MICROSOFT_CLIENT_ID: '',
      MICROSOFT_CLIENT_SECRET: '',
      MICROSOFT_TENANT: '',
    });

    expect(config.google).toBeUndefined();
    expect(config.microsoft).toBeUndefined();
    expect(config.sessionTtlHours).toBe(12);
    expect(config.publicUrl.origin).toBe('http://localhost:8080');
  });

  it('reads both providers, with the Microsoft tenant defaulting to common', () => {
    const config = loadConfig({
      ...required,
      GOOGLE_CLIENT_ID: 'google-id',
      GOOGLE_CLIENT_SECRET: 'google-secret',
      MICROSOFT_CLIENT_ID: 'microsoft-id',
      MICROSOFT_CLIENT_SECRET: 'microsoft-secret',
    });

    expect(config.google).toEqual({ clientId: 'google-id', clientSecret: 'google-secret' });
    expect(config.microsoft).toEqual({
      clientId: 'microsoft-id',
      clientSecret: 'microsoft-secret',
      tenant: 'common',
    });
  });

  it('rejects a provider with only half of its credentials', () => {
    expect(() => loadConfig({ ...required, GOOGLE_CLIENT_ID: 'google-id' })).toThrow(
      'GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET must be set together',
    );
    expect(() => loadConfig({ ...required, MICROSOFT_CLIENT_SECRET: 'secret' })).toThrow(
      'MICROSOFT_CLIENT_ID and MICROSOFT_CLIENT_SECRET must be set together',
    );
  });

  it('rejects a missing public address', () => {
    expect(() => loadConfig({ DATABASE_URL: required.DATABASE_URL })).toThrow();
  });
});
