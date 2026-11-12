import * as client from 'openid-client';
import type {
  IdentityProvider,
  ProviderId,
  SignInTransaction,
  VerifiedIdentity,
} from './identity-provider.ts';
import {
  identityFromGoogleClaims,
  identityFromMicrosoftClaims,
  type IdTokenClaims,
} from './oidc-claims.ts';

type OidcProviderOptions = {
  id: ProviderId;
  issuer: URL;
  clientId: string;
  clientSecret: string;
  toIdentity: (claims: IdTokenClaims) => VerifiedIdentity;
};

/** Adapter: authorization code flow with PKCE, state and nonce through openid-client. */
class OidcIdentityProvider implements IdentityProvider {
  readonly id: ProviderId;
  readonly #options: OidcProviderOptions;
  #configuration: Promise<client.Configuration> | undefined;

  constructor(options: OidcProviderOptions) {
    this.id = options.id;
    this.#options = options;
  }

  /** Discovery is lazy so the API starts without reaching the provider, and retried after a failure. */
  #configure(): Promise<client.Configuration> {
    this.#configuration ??= client
      .discovery(this.#options.issuer, this.#options.clientId, this.#options.clientSecret)
      .catch((error: unknown) => {
        this.#configuration = undefined;
        throw error;
      });
    return this.#configuration;
  }

  async beginSignIn(redirectUri: string) {
    const configuration = await this.#configure();
    const transaction: SignInTransaction = {
      state: client.randomState(),
      nonce: client.randomNonce(),
      codeVerifier: client.randomPKCECodeVerifier(),
    };
    const authorizationUrl = client.buildAuthorizationUrl(configuration, {
      redirect_uri: redirectUri,
      scope: 'openid email profile',
      state: transaction.state,
      nonce: transaction.nonce,
      code_challenge: await client.calculatePKCECodeChallenge(transaction.codeVerifier),
      code_challenge_method: 'S256',
    });
    return { authorizationUrl: authorizationUrl.href, transaction };
  }

  async completeSignIn(callbackUrl: URL, transaction: SignInTransaction): Promise<VerifiedIdentity> {
    const configuration = await this.#configure();
    const tokens = await client.authorizationCodeGrant(configuration, callbackUrl, {
      expectedState: transaction.state,
      expectedNonce: transaction.nonce,
      pkceCodeVerifier: transaction.codeVerifier,
      idTokenExpected: true,
    });
    const claims = tokens.claims();
    if (claims === undefined) {
      throw new Error('the provider returned no ID token');
    }
    return this.#options.toIdentity(claims);
  }
}

export function createGoogleProvider(credentials: {
  clientId: string;
  clientSecret: string;
}): IdentityProvider {
  return new OidcIdentityProvider({
    id: 'google',
    issuer: new URL('https://accounts.google.com'),
    toIdentity: identityFromGoogleClaims,
    ...credentials,
  });
}

export function createMicrosoftProvider(credentials: {
  clientId: string;
  clientSecret: string;
  /** `common`, `organizations`, or one tenant id. */
  tenant: string;
}): IdentityProvider {
  return new OidcIdentityProvider({
    id: 'microsoft',
    issuer: new URL(`https://login.microsoftonline.com/${credentials.tenant}/v2.0`),
    toIdentity: identityFromMicrosoftClaims,
    clientId: credentials.clientId,
    clientSecret: credentials.clientSecret,
  });
}
