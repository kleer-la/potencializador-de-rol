import { useEffect, useState } from 'react';
import type { BonusRuleInput } from '../api/client.ts';

type Props = {
  rules: BonusRuleInput[];
  /** Absent: the rules are shown, not edited. */
  onSave?: (rules: BonusRuleInput[]) => Promise<void>;
};

export function BonusRulesEditor({ rules, onSave }: Props) {
  const [rows, setRows] = useState(rules);
  useEffect(() => setRows(rules), [rules]);

  if (onSave === undefined) {
    if (rules.length === 0) return <p className="muted">Sin bonificaciones.</p>;
    return (
      <ul className="plain-list">
        {rules.map((rule, index) => (
          <li key={index}>
            <strong>{rule.name}</strong> <span className="tag">+{rule.extraPoints}</span>
            <div className="muted">{rule.condition}</div>
          </li>
        ))}
      </ul>
    );
  }

  const update = (index: number, change: Partial<BonusRuleInput>) =>
    setRows(rows.map((row, position) => (position === index ? { ...row, ...change } : row)));

  return (
    <div className="stack">
      {rows.map((row, index) => (
        <fieldset key={index} className="inline-form">
          <label>
            Nombre de la bonificación {index + 1}
            <input value={row.name} onChange={(event) => update(index, { name: event.target.value })} />
          </label>
          <label>
            Puntos extra {index + 1}
            <input
              type="number"
              min={0}
              step="any"
              value={row.extraPoints}
              onChange={(event) => update(index, { extraPoints: Number(event.target.value) })}
            />
          </label>
          <label>
            Condición {index + 1}
            <textarea value={row.condition} onChange={(event) => update(index, { condition: event.target.value })} />
          </label>
          <button
            type="button"
            className="secondary"
            onClick={() => setRows(rows.filter((_, position) => position !== index))}
          >
            Quitar bonificación {index + 1}
          </button>
        </fieldset>
      ))}
      <div className="actions">
        <button
          type="button"
          className="secondary"
          onClick={() => setRows([...rows, { name: '', extraPoints: 1, condition: '' }])}
        >
          Agregar bonificación
        </button>
        <button type="button" onClick={() => onSave(rows)}>
          Guardar bonificaciones
        </button>
      </div>
    </div>
  );
}
