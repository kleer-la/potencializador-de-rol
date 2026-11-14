import { useState, type FormEvent } from 'react';
import type { SignInOptions } from '../api/client.ts';
import { messages, passwordMessages, providerLabels } from '../copy.ts';

type Props = {
  options: SignInOptions;
  /** Already translated; shown above the forms. */
  error: string | null;
  /** Already translated; a confirmation, such as the link having been mailed. */
  notice: string | null;
  /** The address carries a mailed link: only choosing the password is offered. */
  confirming: boolean;
  busy: boolean;
  onPasswordSignIn: (email: string, password: string) => void;
  onRequestLink: (email: string) => void;
  onChoosePassword: (password: string) => void;
};

type Mode = 'sign_in' | 'request_link';

export function SignInPanel({ options, error, notice, confirming, busy, ...actions }: Props) {
  const [mode, setMode] = useState<Mode>('sign_in');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (confirming) actions.onChoosePassword(password);
    else if (mode === 'sign_in') actions.onPasswordSignIn(email, password);
    else actions.onRequestLink(email);
  };

  const emailField = (
    <label>
      Correo
      <input type="email" autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} required />
    </label>
  );
  const passwordField = (label: string, isNew: boolean) => (
    <label>
      {label}
      <input
        type="password"
        autoComplete={isNew ? 'new-password' : 'current-password'}
        value={password}
        onChange={(event) => setPassword(event.target.value)}
        {...(isNew ? { minLength: 10, maxLength: 128 } : {})}
        required
      />
    </label>
  );

  const nothingConfigured = options.providers.length === 0 && !options.password;

  return (
    <section className="panel sign-in">
      <h1>Potencializador de rol</h1>
      {error !== null && <p role="alert">{error}</p>}
      {notice !== null && <p role="status">{notice}</p>}
      {confirming ? (
        <form className="inline-form" onSubmit={submit}>
          <p>{passwordMessages.confirmIntro}</p>
          {passwordField('Contraseña nueva', true)}
          <button type="submit" className="primary" disabled={busy}>
            Guardar contraseña
          </button>
        </form>
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
              {emailField}
              {mode === 'sign_in' && passwordField('Contraseña', false)}
              <button type="submit" className="primary" disabled={busy}>
                {mode === 'sign_in' ? 'Ingresar' : 'Enviar enlace'}
              </button>
              <button type="button" onClick={() => setMode(mode === 'sign_in' ? 'request_link' : 'sign_in')}>
                {mode === 'sign_in' ? 'Crear contraseña' : 'Ya tengo contraseña'}
              </button>
            </form>
          )}
        </>
      )}
    </section>
  );
}
