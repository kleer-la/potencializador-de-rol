import { useEffect, useState } from 'react';
import type { LevelInput } from '../api/client.ts';

type Props = {
  levels: LevelInput[];
  /** Absent: the scale is shown, not edited. */
  onSave?: (levels: LevelInput[]) => Promise<void>;
};

export function ScaleEditor({ levels, onSave }: Props) {
  const [rows, setRows] = useState(levels);
  useEffect(() => setRows(levels), [levels]);

  if (onSave === undefined) {
    return (
      <table aria-label="Escala de madurez">
        <thead>
          <tr>
            <th scope="col">Nivel</th>
            <th scope="col">Multiplicador</th>
            <th scope="col">Requisito</th>
          </tr>
        </thead>
        <tbody>
          {levels.map((level, index) => (
            <tr key={index}>
              <td>
                {index}. {level.name}
                {level.description && <div className="muted">{level.description}</div>}
              </td>
              <td>{level.multiplier}</td>
              <td>{level.requiresTransfer ? 'Exige transferencia' : ''}</td>
            </tr>
          ))}
        </tbody>
      </table>
    );
  }

  const update = (index: number, change: Partial<LevelInput>) =>
    setRows(rows.map((row, position) => (position === index ? { ...row, ...change } : row)));
  const last = rows.at(-1);

  return (
    <div>
      <table aria-label="Escala de madurez">
        <thead>
          <tr>
            <th scope="col">Nivel</th>
            <th scope="col">Multiplicador</th>
            <th scope="col">Transferencia</th>
            <th scope="col" />
          </tr>
        </thead>
        <tbody>
          {rows.map((row, index) => (
            <tr key={index}>
              <td>
                <input
                  aria-label={`Nombre del nivel ${index + 1}`}
                  value={row.name}
                  onChange={(event) => update(index, { name: event.target.value })}
                />
              </td>
              <td>
                <input
                  aria-label={`Multiplicador del nivel ${index + 1}`}
                  type="number"
                  min={0}
                  step="any"
                  value={row.multiplier}
                  onChange={(event) => update(index, { multiplier: Number(event.target.value) })}
                />
              </td>
              <td>
                <input
                  aria-label={`Exige transferencia en el nivel ${index + 1}`}
                  type="checkbox"
                  checked={row.requiresTransfer}
                  onChange={(event) => update(index, { requiresTransfer: event.target.checked })}
                />
              </td>
              <td>
                <button
                  type="button"
                  className="secondary"
                  onClick={() => setRows(rows.filter((_, position) => position !== index))}
                >
                  Quitar nivel {index + 1}
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="actions">
        <button
          type="button"
          className="secondary"
          onClick={() =>
            setRows([
              ...rows,
              { name: '', description: '', multiplier: last === undefined ? 0 : last.multiplier + 1, requiresTransfer: false },
            ])
          }
        >
          Agregar nivel
        </button>
        <button type="button" onClick={() => onSave(rows)}>
          Guardar escala
        </button>
      </div>
    </div>
  );
}
