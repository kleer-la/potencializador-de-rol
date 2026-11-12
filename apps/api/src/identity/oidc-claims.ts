import type { VerifiedIdentity } from './identity-provider.ts';

/** ID token claims, already validated (signature, issuer, audience, nonce) by the adapter. */
export type IdTokenClaims = { iss: string; sub: string } & Record<string, unknown>;

const stringOrNull = (value: unknown): string | null =>
  typeof value === 'string' && value.length > 0 ? value : null;

/** Google states verification per token in `email_verified`. */
export function identityFromGoogleClaims(claims: IdTokenClaims): VerifiedIdentity {
  return {
    issuer: claims.iss,
    subject: claims.sub,
    verifiedEmail: claims.email_verified === true ? stringOrNull(claims.email) : null,
  };
}

/**
 * Microsoft Entra does not verify `email`: a tenant administrator can set any value, and
 * Microsoft's claims reference says never to use it for authorization. `xms_edov` is the
 * optional claim that states the email's domain owner was verified, so the email counts
 * only with it. Without the claim the first sign-in is refused instead of trusted.
 */
export function identityFromMicrosoftClaims(claims: IdTokenClaims): VerifiedIdentity {
  const domainOwnerVerified = claims.xms_edov === true || claims.xms_edov === 'true';
  return {
    issuer: claims.iss,
    subject: claims.sub,
    verifiedEmail: domainOwnerVerified ? stringOrNull(claims.email) : null,
  };
}
