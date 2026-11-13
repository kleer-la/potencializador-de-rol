import { DIMENSION_KINDS, type DimensionKind } from '@potencializador/domain';
import { useState, type FormEvent } from 'react';
import type { DimensionInput } from '../api/client.ts';
import { kindLabels } from '../copy.ts';

type Props = {
  initial?: DimensionInput;
  submitLabel: string;
  onSubmit: (dimension: DimensionInput) => Promise<void>;
  onCancel?: () => void;
};

const empty: DimensionInput = { name: '', description: '', kind: 'work_cycle' };

export function DimensionForm({ initial = empty, submitLabel, onSubmit, onCancel }: Props) {
  const [value, setValue] = useState(initial);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    try {
      await onSubmit(value);
      setValue(initial);
    } catch {
      // The container reports the failure; what was typed stays.
    }
  };

  return (
    <form className="inline-form" onSubmit={submit}>
      <label>
        Nombre de la dimensión
        <input value={value.name} onChange={(event) => setValue({ ...value, name: event.target.value })} required />
      </label>
      <label>
        Tipo
        <select value={value.kind} onChange={(event) => setValue({ ...value, kind: event.target.value as DimensionKind })}>
          {DIMENSION_KINDS.map((kind) => (
            <option key={kind} value={kind}>
              {kindLabels[kind]}
            </option>
          ))}
        </select>
      </label>
      <div className="actions">
        <button type="submit">{submitLabel}</button>
        {onCancel && (
          <button type="button" className="secondary" onClick={onCancel}>
            Cancelar
          </button>
        )}
      </div>
    </form>
  );
}
