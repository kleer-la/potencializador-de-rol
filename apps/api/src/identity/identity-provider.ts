export type ProviderId = 'google' | 'microsoft';

/** What the provider proved about the person who signed in. */
export type VerifiedIdentity = {
  /** `issuer` + `subject` identify the provider account for good; emails can change. */
  issuer: string;
  subject: string;
  /** Only an email the provider vouches for; `null` when it is absent or unverified. */
  verifiedEmail: string | null;
};

/** Values created when sign-in starts and checked when the provider calls back. */
export type SignInTransaction = {
  state: string;
  nonce: string;
  codeVerifier: string;
};

/** Port: an external identity provider (OpenID Connect). */
export interface IdentityProvider {
  readonly id: ProviderId;
  beginSignIn(redirectUri: string): Promise<{ authorizationUrl: string; transaction: SignInTransaction }>;
  /** Rejects when the callback does not belong to `transaction` or the provider refuses. */
  completeSignIn(callbackUrl: URL, transaction: SignInTransaction): Promise<VerifiedIdentity>;
}
