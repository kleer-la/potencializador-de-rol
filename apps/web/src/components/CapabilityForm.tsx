import { DIFFICULTIES, type Difficulty } from '@potencializador/domain';
import { useState, type FormEvent } from 'react';
import type { CapabilityInput, Objective, Tool } from '../api/client.ts';
import { difficultyLabels } from '../copy.ts';

type Props = {
  tools: Tool[];
  objectives: Objective[];
  initial?: CapabilityInput;
  submitLabel: string;
  /** Resolves when saved; the form then clears. */
  onSubmit: (capability: CapabilityInput) => Promise<void>;
  onCancel?: () => void;
};

const empty: CapabilityInput = { statement: '', difficulty: null, toolIds: [], objectiveIds: [] };
const selected = (select: HTMLSelectElement) => [...select.selectedOptions].map((option) => option.value);

export function CapabilityForm({ tools, objectives, initial = empty, submitLabel, onSubmit, onCancel }: Props) {
  const [value, setValue] = useState(initial);
  const [submitting, setSubmitting] = useState(false);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setSubmitting(true);
    try {
      await onSubmit(value);
      setValue(initial);
    } catch {
      // The container reports the failure; what was typed stays.
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <form className="inline-form" onSubmit={submit}>
      <label>
        Enunciado observable
        <textarea
          value={value.statement}
          onChange={(event) => setValue({ ...value, statement: event.target.value })}
          maxLength={500}
          required
        />
      </label>
      <label>
        Dificultad
        <select
          value={value.difficulty ?? ''}
          onChange={(event) =>
            setValue({ ...value, difficulty: event.target.value === '' ? null : (event.target.value as Difficulty) })
          }
        >
          <option value="">Sin definir</option>
          {DIFFICULTIES.map((difficulty) => (
            <option key={difficulty} value={difficulty}>
              {difficultyLabels[difficulty]}
            </option>
          ))}
        </select>
      </label>
      <label>
        Herramientas
        <select
          multiple
          size={Math.min(6, Math.max(2, tools.length))}
          value={value.toolIds}
          onChange={(event) => setValue({ ...value, toolIds: selected(event.target) })}
        >
          {tools.map((tool) => (
            <option key={tool.id} value={tool.id}>
              {tool.name}
            </option>
          ))}
        </select>
      </label>
      <label>
        Objetivos estratégicos
        <select
          multiple
          size={Math.min(4, Math.max(2, objectives.length))}
          value={value.objectiveIds}
          onChange={(event) => setValue({ ...value, objectiveIds: selected(event.target) })}
        >
          {objectives.map((objective) => (
            <option key={objective.id} value={objective.id}>
              {objective.name}
            </option>
          ))}
        </select>
      </label>
      <div className="actions">
        <button type="submit" disabled={submitting}>
          {submitLabel}
        </button>
        {onCancel && (
          <button type="button" className="secondary" onClick={onCancel}>
            Cancelar
          </button>
        )}
      </div>
    </form>
  );
}
