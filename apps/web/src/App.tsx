import { useCallback, useEffect, useState } from 'react';
import { api, type CurrentPerson, type ProviderId } from './api/client.ts';
import { SignInPanel } from './components/SignInPanel.tsx';
import { BoardsPage } from './containers/BoardsPage.tsx';
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

type View = 'boards' | 'organizations';

export function App() {
  const [session, setSession] = useState<Session>({ status: 'loading' });
  const [view, setView] = useState<View | null>(null);

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
  // A participant may hold no organization role: their place is their boards.
  const shown: View = view ?? (me.isSuperAdmin || me.memberships.length > 0 ? 'organizations' : 'boards');
  return (
    <>
      <header className="top-bar">
        <span className="ds-marker">Potencializador de rol</span>
        <nav aria-label="Secciones" className="main-nav">
          <button type="button" aria-current={shown === 'boards' ? 'page' : undefined} onClick={() => setView('boards')}>
            Tableros
          </button>
          <button
            type="button"
            aria-current={shown === 'organizations' ? 'page' : undefined}
            onClick={() => setView('organizations')}
          >
            Organizaciones
          </button>
        </nav>
        <span>
          <span>{me.person.name}</span>
          {me.isSuperAdmin && <span className="tag">Superadministrador</span>}
          <button type="button" onClick={signOut}>
            Cerrar sesión
          </button>
        </span>
      </header>
      <main>{shown === 'boards' ? <BoardsPage /> : <OrganizationsPage me={me} />}</main>
    </>
  );
}
