import { canStartNewVersionFrom } from '@potencializador/domain';
import { useEffect, useState, type ChangeEvent } from 'react';
import { ApiError, type MapHeader, type OrganizationApi, type Role } from '../api/client.ts';
import { mapErrors, messages, statusLabels } from '../copy.ts';
import { MapEditor } from './MapEditor.tsx';

type Props = { api: OrganizationApi; role: Role; canDesign: boolean };

/** The versions of a role's map, and the one being viewed. */
export function MapVersions({ api, role, canDesign }: Props) {
  const [versions, setVersions] = useState<MapHeader[] | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = () =>
    api
      .versions(role.id)
      .then(setVersions)
      .catch(() => setError(messages.requestFailed));

  useEffect(() => {
    setVersions(null);
    setOpenId(null);
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reload when the role changes
  }, [api, role.id]);

  const start = async (work: () => Promise<MapHeader>) => {
    setError(null);
    try {
      const created = await work();
      setOpenId(created.id);
    } catch (failure) {
      setError((failure instanceof ApiError && mapErrors[failure.code]) || messages.requestFailed);
    }
  };

  const importFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (file === undefined) return;
    let content: unknown;
    try {
      content = JSON.parse(await file.text());
    } catch {
      setError('El archivo no es un JSON válido.');
      return;
    }
    await start(() => api.importMap(role.id, content));
  };

  if (openId !== null) {
    return (
      <MapEditor
        api={api}
        mapId={openId}
        canDesign={canDesign}
        onBack={() => {
          setOpenId(null);
          void load();
        }}
      />
    );
  }
  if (versions === null) return error ? <p role="alert">{error}</p> : <p>{messages.loading}</p>;

  const hasDraft = versions.some((version) => version.status === 'draft');
  const latestFrozen = [...versions].reverse().find((version) => canStartNewVersionFrom(version.status));

  return (
    <div className="stack">
      <h3>Mapa de capacidades de {role.name}</h3>
      {versions.length === 0 ? (
        <p>Este rol todavía no tiene mapa.</p>
      ) : (
        <ul className="plain-list">
          {versions.map((version) => (
            <li key={version.id} className="version-row">
              <span>Versión {version.version}</span>
              <span className={`ds-badge ds-badge--${version.status}`}>{statusLabels[version.status]}</span>
              <button type="button" className="secondary" aria-label={`Abrir versión ${version.version}`} onClick={() => setOpenId(version.id)}>
                Abrir
              </button>
            </li>
          ))}
        </ul>
      )}
      {canDesign && !hasDraft && (
        <div className="actions">
          {latestFrozen === undefined ? (
            <button type="button" onClick={() => start(() => api.newDraft(role.id))}>
              Nuevo borrador
            </button>
          ) : (
            <button type="button" onClick={() => start(() => api.newDraft(role.id, latestFrozen.id))}>
              Nueva versión
            </button>
          )}
          <label className="file-input">
            Importar mapa (archivo JSON)
            <input type="file" accept="application/json,.json" onChange={importFile} />
          </label>
        </div>
      )}
      {error !== null && <p role="alert">{error}</p>}
    </div>
  );
}
