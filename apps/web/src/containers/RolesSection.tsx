import { useEffect, useState, type FormEvent } from 'react';
import { ApiError, type OrganizationApi, type Role } from '../api/client.ts';
import { mapErrors, messages } from '../copy.ts';
import { MapVersions } from './MapVersions.tsx';

type Props = { api: OrganizationApi; canAdminister: boolean; canDesign: boolean };

export function RolesSection({ api, canAdminister, canDesign }: Props) {
  const [roles, setRoles] = useState<Role[] | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let current = true;
    api
      .roles()
      .then((loaded) => current && setRoles(loaded))
      .catch(() => current && setError(messages.requestFailed));
    return () => {
      current = false;
    };
  }, [api]);

  const create = async (event: FormEvent) => {
    event.preventDefault();
    setError(null);
    try {
      const created = await api.createRole(name);
      setRoles(await api.roles());
      setSelectedId(created.id);
      setName('');
    } catch (failure) {
      setError((failure instanceof ApiError && mapErrors[failure.code]) || messages.requestFailed);
    }
  };

  if (roles === null) return error ? <p role="alert">{error}</p> : <p>{messages.loading}</p>;
  const selected = roles.find((role) => role.id === selectedId) ?? null;

  return (
    <div className="columns">
      <section className="panel">
        <h3>Roles</h3>
        {roles.length === 0 ? (
          <p className="muted">Todavía no hay roles.</p>
        ) : (
          <ul className="plain-list">
            {roles.map((role) => (
              <li key={role.id}>
                <button
                  type="button"
                  className="link-button"
                  aria-pressed={role.id === selectedId}
                  onClick={() => setSelectedId(role.id)}
                >
                  {role.name}
                </button>
              </li>
            ))}
          </ul>
        )}
        {canAdminister && (
          <form className="inline-form" onSubmit={create}>
            <label>
              Nombre del rol
              <input value={name} onChange={(event) => setName(event.target.value)} maxLength={160} required />
            </label>
            <button type="submit" className="primary">
              Crear rol
            </button>
          </form>
        )}
        {error !== null && <p role="alert">{error}</p>}
      </section>
      {selected !== null && (
        <section className="panel wide">
          <MapVersions api={api} role={selected} canDesign={canDesign} />
        </section>
      )}
    </div>
  );
}
