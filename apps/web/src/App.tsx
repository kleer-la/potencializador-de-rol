import { useCallback, useEffect, useState } from 'react';
import { api, type CurrentPerson, type SignInOptions } from './api/client.ts';
import { BoardsPage } from './containers/BoardsPage.tsx';
import { OrganizationsPage } from './containers/OrganizationsPage.tsx';
import { SignInPage } from './containers/SignInPage.tsx';
import { messages } from './copy.ts';

type Session =
  | { status: 'loading' }
  | { status: 'unavailable' }
  | { status: 'signed_out'; options: SignInOptions }
  | { status: 'signed_in'; me: CurrentPerson };

type View = 'boards' | 'organizations';

export function App() {
  const [session, setSession] = useState<Session>({ status: 'loading' });
  const [view, setView] = useState<View | null>(null);

  const load = useCallback(async () => {
    try {
      const me = await api.currentPerson();
      setSession(
        me === null ? { status: 'signed_out', options: await api.signInOptions() } : { status: 'signed_in', me },
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
    return <SignInPage options={session.options} onSignedIn={() => void load()} />;
  }

  const { me } = session;
  // A participant may hold no organization role: their place is their boards, and organizations stay out of sight.
  const managesOrganizations = me.isSuperAdmin || me.memberships.length > 0;
  const shown: View = managesOrganizations ? (view ?? 'organizations') : 'boards';
  return (
    <>
      <header className="top-bar">
        <span className="ds-marker">Potencializador de rol</span>
        <nav aria-label="Secciones" className="main-nav">
          <button type="button" aria-current={shown === 'boards' ? 'page' : undefined} onClick={() => setView('boards')}>
            Tableros
          </button>
          {managesOrganizations && (
            <button
              type="button"
              aria-current={shown === 'organizations' ? 'page' : undefined}
              onClick={() => setView('organizations')}
            >
              Organizaciones
            </button>
          )}
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
