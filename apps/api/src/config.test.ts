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

  it('offers no password sign-in without mail, including empty values from Compose', () => {
    const config = loadConfig({
      ...required,
      SMTP_HOST: '',
      SMTP_PORT: '',
      SMTP_USER: '',
      SMTP_PASSWORD: '',
      SMTP_FROM: '',
    });

    expect(config.smtp).toBeUndefined();
  });

  it('reads the mail settings, with the port defaulting to 465', () => {
    const config = loadConfig({
      ...required,
      SMTP_HOST: 'smtp.gmail.com',
      SMTP_USER: 'no-reply@example.com',
      SMTP_PASSWORD: 'app-password',
      SMTP_FROM: 'Potencializador <no-reply@example.com>',
    });

    expect(config.smtp).toEqual({
      host: 'smtp.gmail.com',
      port: 465,
      user: 'no-reply@example.com',
      password: 'app-password',
      from: 'Potencializador <no-reply@example.com>',
    });
    expect(loadConfig({ ...required, SMTP_HOST: 'h', SMTP_PORT: '587', SMTP_USER: 'u', SMTP_PASSWORD: 'p', SMTP_FROM: 'f' }).smtp?.port).toBe(587);
  });

  it('rejects mail settings that are only partly set', () => {
    expect(() => loadConfig({ ...required, SMTP_HOST: 'smtp.gmail.com' })).toThrow(
      'SMTP_HOST, SMTP_USER, SMTP_PASSWORD and SMTP_FROM must be set together',
    );
  });

  it('rejects a missing public address', () => {
    expect(() => loadConfig({ DATABASE_URL: required.DATABASE_URL })).toThrow();
  });
});
