import { useCallback, useEffect, useState } from 'react';
import { api, type CurrentPerson, type ProviderId } from './api/client.ts';
import { SignInPanel } from './components/SignInPanel.tsx';
import { OrganizationsPage } from './containers/OrganizationsPage.tsx';
import { messages, signInErrors } from './copy.ts';

type Session =
  | { status: 'loading' }
  | { status: 'unavailable' }
  | { status: 'signed_out'; providers: ProviderId[] }
  | { status: 'signed_in'; me: CurrentPerson };

/** The sign-in callback reports a refusal as `?error=<code>` in the address. */
function signInErrorFromAddress(): string | null {
  const code = new URLSearchParams(window.location.search).get('error');
  return code === null ? null : (signInErrors[code] ?? signInErrors.sign_in_failed ?? null);
}

export function App() {
  const [session, setSession] = useState<Session>({ status: 'loading' });

  const load = useCallback(async () => {
    try {
      const me = await api.currentPerson();
      setSession(
        me === null ? { status: 'signed_out', providers: await api.providers() } : { status: 'signed_in', me },
      );
    } catch {
      setSession({ status: 'unavailable' });
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const signOut = async () => {
    try {
      await api.signOut();
    } finally {
      await load();
    }
  };

  if (session.status === 'loading') return <p className="status">{messages.loading}</p>;
  if (session.status === 'unavailable') {
    return (
      <p className="status" role="alert">
        {messages.unavailable}
      </p>
    );
  }
  if (session.status === 'signed_out') {
    return <SignInPanel providers={session.providers} error={signInErrorFromAddress()} />;
  }

  const { me } = session;
  return (
    <>
      <header className="top-bar">
        <span className="ds-marker">Potencializador de rol</span>
        <span>
          <span>{me.person.name}</span>
          {me.isSuperAdmin && <span className="tag">Superadministrador</span>}
          <button type="button" onClick={signOut}>
            Cerrar sesión
          </button>
        </span>
      </header>
      <main>
        <OrganizationsPage me={me} />
      </main>
    </>
  );
}
