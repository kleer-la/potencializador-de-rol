import { useId, useState } from 'react';

type Option = { id: string; name: string };

type Props = {
  /** Plural noun, as shown: "Herramientas". */
  legend: string;
  options: Option[];
  selected: string[];
  onChange: (selected: string[]) => void;
};

const MAX_MATCHES = 8;

/** Lowercase without accents, so "gestion" finds "Gestión". */
const fold = (text: string) =>
  text
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase();

/**
 * Picks entries of a long catalog by typing part of their name. The chosen ones show as
 * tags that can be removed; matches list only what is not chosen yet.
 */
export function SearchPicker({ legend, options, selected, onChange }: Props) {
  const [query, setQuery] = useState('');
  const searchId = useId();
  const byId = new Map(options.map((option) => [option.id, option]));
  const wanted = fold(query.trim());
  const matches =
    wanted === ''
      ? []
      : options
          .filter((option) => !selected.includes(option.id) && fold(option.name).includes(wanted))
          .slice(0, MAX_MATCHES);
  const noun = legend.toLowerCase();
  const add = (option: Option) => {
    onChange([...selected, option.id]);
    setQuery('');
  };

  return (
    <fieldset className="search-picker">
      <legend>{legend}</legend>
      {selected.length > 0 && (
        <ul className="tags" aria-label={`${legend} elegidas`}>
          {selected.map((id) => (
            <li key={id} className="tag chosen">
              {byId.get(id)?.name ?? id}
              <button
                type="button"
                className="secondary small"
                aria-label={`Quitar «${byId.get(id)?.name ?? id}»`}
                onClick={() => onChange(selected.filter((candidate) => candidate !== id))}
              >
                ×
              </button>
            </li>
          ))}
        </ul>
      )}
      <label htmlFor={searchId} className="search-label">
        Buscar <span className="visually-hidden">{noun}</span>
      </label>
      <input
        id={searchId}
        type="search"
        aria-label={`Buscar ${noun}`}
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        // Enter picks the first match; it must never submit the form around the picker.
        onKeyDown={(event) => {
          if (event.key !== 'Enter') return;
          event.preventDefault();
          const first = matches[0];
          if (first !== undefined) add(first);
        }}
        autoComplete="off"
      />
      {wanted === '' ? (
        <p className="muted">Escribe para buscar entre {options.length}.</p>
      ) : matches.length === 0 ? (
        <p className="muted">Sin resultados.</p>
      ) : (
        <ul className="plain-list search-results">
          {matches.map((option) => (
            <li key={option.id}>
              <button
                type="button"
                className="link-button"
                aria-label={`Agregar «${option.name}»`}
                onClick={() => add(option)}
              >
                {option.name}
              </button>
            </li>
          ))}
        </ul>
      )}
    </fieldset>
  );
}
