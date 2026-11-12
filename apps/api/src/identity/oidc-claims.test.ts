import { describe, expect, it } from 'vitest';
import { identityFromGoogleClaims, identityFromMicrosoftClaims } from './oidc-claims.ts';

describe('identity from Google claims', () => {
  const claims = { iss: 'https://accounts.google.com', sub: 'google-subject', email: 'Ana@Example.com' };

  it('keeps the email only when Google marks it verified', () => {
    expect(identityFromGoogleClaims({ ...claims, email_verified: true })).toEqual({
      issuer: 'https://accounts.google.com',
      subject: 'google-subject',
      verifiedEmail: 'Ana@Example.com',
    });
    expect(identityFromGoogleClaims({ ...claims, email_verified: false }).verifiedEmail).toBeNull();
    expect(identityFromGoogleClaims(claims).verifiedEmail).toBeNull();
  });
});

describe('identity from Microsoft claims', () => {
  const claims = {
    iss: 'https://login.microsoftonline.com/tenant-1/v2.0',
    sub: 'microsoft-subject',
    email: 'ana@example.com',
  };

  it('keeps the email only when the domain owner is verified (xms_edov)', () => {
    expect(identityFromMicrosoftClaims({ ...claims, xms_edov: true })).toEqual({
      issuer: 'https://login.microsoftonline.com/tenant-1/v2.0',
      subject: 'microsoft-subject',
      verifiedEmail: 'ana@example.com',
    });
    expect(identityFromMicrosoftClaims({ ...claims, xms_edov: 'true' }).verifiedEmail).toBe(
      'ana@example.com',
    );
  });

  it('drops the email when xms_edov is false or absent, because Entra does not verify it', () => {
    expect(identityFromMicrosoftClaims({ ...claims, xms_edov: false }).verifiedEmail).toBeNull();
    expect(identityFromMicrosoftClaims(claims).verifiedEmail).toBeNull();
  });

  it('never takes the email from another claim such as preferred_username', () => {
    const withoutEmail = {
      iss: claims.iss,
      sub: claims.sub,
      preferred_username: 'ana@example.com',
      xms_edov: true,
    };

    expect(identityFromMicrosoftClaims(withoutEmail).verifiedEmail).toBeNull();
  });
});
