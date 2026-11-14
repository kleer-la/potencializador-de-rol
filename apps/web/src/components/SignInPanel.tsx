import { useState, type FormEvent } from 'react';
import type { SignInOptions } from '../api/client.ts';
import { messages, passwordMessages, providerLabels } from '../copy.ts';

export type PasswordMode = 'sign_in' | 'register';

type Props = {
  options: SignInOptions;
  /** Already translated; shown above the forms. */
  error: string | null;
  /** Already translated; a confirmation, such as the link having been mailed. */
  notice: string | null;
  /** The address carries a confirmation link: only the confirmation is offered. */
  confirming: boolean;
  busy: boolean;
  onPasswordSignIn: (email: string, password: string) => void;
  onRegister: (email: string, password: string) => void;
  onConfirm: () => void;
};

export function SignInPanel({ options, error, notice, confirming, busy, ...actions }: Props) {
  const [mode, setMode] = useState<PasswordMode>('sign_in');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (mode === 'sign_in') actions.onPasswordSignIn(email, password);
    else actions.onRegister(email, password);
  };

  const nothingConfigured = options.providers.length === 0 && !options.password;

  return (
    <section className="panel sign-in">
      <h1>Potencializador de rol</h1>
      {error !== null && <p role="alert">{error}</p>}
      {notice !== null && <p role="status">{notice}</p>}
      {confirming ? (
        <>
          <p>{passwordMessages.confirmIntro}</p>
          <button type="button" className="primary" disabled={busy} onClick={actions.onConfirm}>
            Confirmar correo
          </button>
        </>
      ) : nothingConfigured ? (
        <p>{messages.noProviders}</p>
      ) : (
        <>
          {options.providers.length > 0 && (
            <ul className="plain-list">
              {options.providers.map((provider) => (
                <li key={provider}>
                  {/* A full navigation: the API redirects to the provider. */}
                  <a className="button" href={`/api/auth/${provider}/login`}>
                    {providerLabels[provider]}
                  </a>
                </li>
              ))}
            </ul>
          )}
          {options.password && (
            <form className="inline-form" onSubmit={submit}>
              <label>
                Correo
                <input
                  type="email"
                  autoComplete="email"
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  required
                />
              </label>
              <label>
                {mode === 'sign_in' ? 'Contraseña' : 'Contraseña nueva'}
                <input
                  type="password"
                  autoComplete={mode === 'sign_in' ? 'current-password' : 'new-password'}
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  {...(mode === 'register' ? { minLength: 10, maxLength: 128 } : {})}
                  required
                />
              </label>
              <button type="submit" className="primary" disabled={busy}>
                {mode === 'sign_in' ? 'Ingresar' : 'Enviar enlace'}
              </button>
              <button
                type="button"
                onClick={() => setMode(mode === 'sign_in' ? 'register' : 'sign_in')}
              >
                {mode === 'sign_in' ? 'Crear contraseña' : 'Ya tengo contraseña'}
              </button>
            </form>
          )}
        </>
      )}
    </section>
  );
}
