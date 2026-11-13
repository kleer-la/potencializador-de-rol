import { useEffect, useId, useState, type FormEvent } from 'react';
import { ApiError, type CatalogEntry, type CatalogKind, type OrganizationApi } from '../api/client.ts';
import { ConfirmAction } from '../components/ConfirmAction.tsx';
import { mapErrors, messages } from '../copy.ts';

type Props = { api: OrganizationApi; kind: CatalogKind; title: string; canDesign: boolean };

type Draft = { name: string; description: string; link: string };
const emptyDraft: Draft = { name: '', description: '', link: '' };

/** One catalog of the organization (tools or strategic objectives). */
export function CatalogSection({ api, kind, title, canDesign }: Props) {
  const headingId = useId();
  const withLink = kind === 'tools';
  const [items, setItems] = useState<CatalogEntry[] | null>(null);
  const [draft, setDraft] = useState<Draft>(emptyDraft);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let current = true;
    api
      .catalog(kind)
      .then((loaded) => current && setItems(loaded))
      .catch(() => current && setError(messages.requestFailed));
    return () => {
      current = false;
    };
  }, [api, kind]);

  const payload = (value: Draft) =>
    withLink
      ? { name: value.name, description: value.description, link: value.link.trim() === '' ? null : value.link.trim() }
      : { name: value.name, description: value.description };

  const remove = async (id: string) => {
    setError(null);
    try {
      await api.removeFromCatalog(kind, id);
    } catch (failure) {
      // Already deleted by someone else: the outcome wanted, so drop it like a success.
      if (!(failure instanceof ApiError && failure.status === 404)) {
        setError((failure instanceof ApiError && mapErrors[failure.code]) || messages.requestFailed);
        return;
      }
    }
    // Deleted: take it out at once, so a failed reload cannot show it again.
    setItems((current) => current?.filter((item) => item.id !== id) ?? current);
    if (editingId === id) {
      setEditingId(null);
      setDraft(emptyDraft);
    }
    api
      .catalog(kind)
      .then(setItems)
      .catch(() => undefined);
  };

  const save = async (event: FormEvent) => {
    event.preventDefault();
    setError(null);
    try {
      if (editingId === null) await api.addToCatalog(kind, payload(draft));
      else await api.changeInCatalog(kind, editingId, payload(draft));
      setItems(await api.catalog(kind));
      setDraft(emptyDraft);
      setEditingId(null);
    } catch (failure) {
      setError((failure instanceof ApiError && mapErrors[failure.code]) || messages.requestFailed);
    }
  };

  return (
    <section className="panel" aria-labelledby={headingId}>
      <h3 id={headingId}>{title}</h3>
      {items === null ? (
        <p>{messages.loading}</p>
      ) : (
        <ul className="plain-list catalog">
          {items.map((item) => (
            <li key={item.id}>
              <strong>{item.name}</strong>
              {item.description && <span className="muted"> — {item.description}</span>}
              {'link' in item && item.link && (
                <>
                  {' '}
                  <a href={item.link} target="_blank" rel="noreferrer">
                    enlace
                  </a>
                </>
              )}
              {canDesign && (
                <button
                  type="button"
                  className="secondary small"
                  onClick={() => {
                    setEditingId(item.id);
                    setDraft({ name: item.name, description: item.description, link: 'link' in item ? (item.link ?? '') : '' });
                  }}
                >
                  Editar
                </button>
              )}
              {canDesign && (
                <ConfirmAction
                  label="Eliminar"
                  accessibleLabel={`Eliminar «${item.name}»`}
                  prompt={`¿Eliminar «${item.name}» del catálogo?`}
                  confirmLabel="Confirmar"
                  variant="quiet-danger"
                  onConfirm={() => remove(item.id)}
                />
              )}
            </li>
          ))}
        </ul>
      )}
      {canDesign && (
        <form className="inline-form" onSubmit={save}>
          <label>
            Nombre
            <input value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} maxLength={160} required />
          </label>
          <label>
            Descripción
            <input value={draft.description} onChange={(event) => setDraft({ ...draft, description: event.target.value })} />
          </label>
          {withLink && (
            <label>
              Enlace
              <input type="url" value={draft.link} onChange={(event) => setDraft({ ...draft, link: event.target.value })} />
            </label>
          )}
          <div className="actions">
            <button type="submit">{editingId === null ? 'Agregar' : 'Guardar'}</button>
            {editingId !== null && (
              <button
                type="button"
                className="secondary"
                onClick={() => {
                  setEditingId(null);
                  setDraft(emptyDraft);
                }}
              >
                Cancelar
              </button>
            )}
          </div>
        </form>
      )}
      {error !== null && <p role="alert">{error}</p>}
    </section>
  );
}
