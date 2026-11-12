import type { ProviderId } from '../api/client.ts';
import { messages, providerLabels } from '../copy.ts';

type Props = {
  providers: ProviderId[];
  /** Already translated; shown above the buttons. */
  error: string | null;
};

export function SignInPanel({ providers, error }: Props) {
  return (
    <section className="panel sign-in">
      <h1>Potencializador de rol</h1>
      {error !== null && <p role="alert">{error}</p>}
      {providers.length === 0 ? (
        <p>{messages.noProviders}</p>
      ) : (
        <ul className="plain-list">
          {providers.map((provider) => (
            <li key={provider}>
              {/* A full navigation: the API redirects to the provider. */}
              <a className="button" href={`/api/auth/${provider}/login`}>
                {providerLabels[provider]}
              </a>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
