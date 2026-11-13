import type { Difficulty } from '@potencializador/domain';
import { useId, useState } from 'react';
import type { CapabilityInput, Dimension, DimensionInput, Objective, Tool } from '../api/client.ts';
import { difficultyLabels, kindLabels } from '../copy.ts';
import { CapabilityForm } from './CapabilityForm.tsx';
import { ConfirmAction } from './ConfirmAction.tsx';
import { DimensionForm } from './DimensionForm.tsx';

const FILLED: Record<Difficulty, number> = { low: 1, medium: 2, high: 3 };

/** Three squares, filled by difficulty; the word beside them carries the meaning. */
function DifficultySquares({ difficulty }: { difficulty: Difficulty | null }) {
  const filled = difficulty === null ? 0 : FILLED[difficulty];
  return (
    <>
      {[0, 1, 2].map((index) => (
        <i key={index} aria-hidden="true" className={index < filled ? 'on' : undefined} />
      ))}
      {'\u00a0'}
    </>
  );
}

/** What the person may do here; each absent handler hides its action. */
export type DimensionActions = {
  addCapability?: (capability: CapabilityInput) => Promise<void>;
  changeDimension?: (change: Partial<DimensionInput> & { position?: number }) => Promise<void>;
  removeDimension?: () => Promise<void>;
  changeCapability?: (capabilityId: string, change: Partial<CapabilityInput>) => Promise<void>;
  removeCapability?: (capabilityId: string) => Promise<void>;
};

type Props = {
  dimension: Dimension;
  isFirst: boolean;
  isLast: boolean;
  tools: Tool[];
  objectives: Objective[];
  actions: DimensionActions;
};

export function DimensionSection({ dimension, isFirst, isLast, tools, objectives, actions }: Props) {
  const headingId = useId();
  const [editingDimension, setEditingDimension] = useState(false);
  const [editingCapability, setEditingCapability] = useState<string | null>(null);
  const toolName = new Map(tools.map((tool) => [tool.id, tool.name]));
  const objectiveName = new Map(objectives.map((objective) => [objective.id, objective.name]));

  return (
    <section className="panel dimension" aria-labelledby={headingId}>
      <header className="dimension-header">
        <h3 id={headingId}>{dimension.name}</h3>
        <span className="tag">{kindLabels[dimension.kind]}</span>
        {actions.changeDimension && (
          <span className="actions">
            {!isFirst && (
              <button type="button" className="secondary" onClick={() => actions.changeDimension!({ position: dimension.position - 1 })}>
                Subir
              </button>
            )}
            {!isLast && (
              <button type="button" className="secondary" onClick={() => actions.changeDimension!({ position: dimension.position + 1 })}>
                Bajar
              </button>
            )}
            <button type="button" className="secondary" onClick={() => setEditingDimension(true)}>
              Editar dimensión
            </button>
          </span>
        )}
        {actions.removeDimension && (
          <ConfirmAction
            variant="quiet-danger"
            label="Quitar dimensión"
            prompt={`¿Quitar «${dimension.name}» y sus capacidades?`}
            confirmLabel="Confirmar"
            onConfirm={actions.removeDimension}
          />
        )}
      </header>

      {editingDimension && actions.changeDimension && (
        <DimensionForm
          initial={{ name: dimension.name, description: dimension.description, kind: dimension.kind }}
          submitLabel="Guardar dimensión"
          onSubmit={async (change) => {
            await actions.changeDimension!(change);
            setEditingDimension(false);
          }}
          onCancel={() => setEditingDimension(false)}
        />
      )}

      <ol className="capabilities">
        {dimension.capabilities.map((capability) => (
          <li key={capability.id}>
            {editingCapability === capability.id && actions.changeCapability ? (
              <CapabilityForm
                tools={tools}
                objectives={objectives}
                initial={capability}
                submitLabel="Guardar capacidad"
                onSubmit={async (change) => {
                  await actions.changeCapability!(capability.id, change);
                  setEditingCapability(null);
                }}
                onCancel={() => setEditingCapability(null)}
              />
            ) : (
              <>
                <p className="statement">{capability.statement}</p>
                <p className="ds-difficulty">
                  <DifficultySquares difficulty={capability.difficulty} />
                  {capability.difficulty === null
                    ? 'Dificultad sin definir'
                    : `Dificultad ${difficultyLabels[capability.difficulty].toLowerCase()}`}
                </p>
                <ul className="tags">
                  {capability.toolIds.map((id) => (
                    <li key={id} className="tag">
                      {toolName.get(id) ?? id}
                    </li>
                  ))}
                  {capability.objectiveIds.map((id) => (
                    <li key={id} className="tag objective">
                      {objectiveName.get(id) ?? id}
                    </li>
                  ))}
                </ul>
                <span className="actions">
                  {actions.changeCapability && (
                    <button type="button" className="secondary" onClick={() => setEditingCapability(capability.id)}>
                      Editar
                    </button>
                  )}
                  {actions.removeCapability && (
                    <ConfirmAction
                      variant="quiet-danger"
                      label="Quitar"
                      prompt="¿Quitar esta capacidad?"
                      confirmLabel="Confirmar"
                      onConfirm={() => actions.removeCapability!(capability.id)}
                    />
                  )}
                </span>
              </>
            )}
          </li>
        ))}
      </ol>

      {actions.addCapability && (
        <details>
          <summary>Nueva capacidad</summary>
          <CapabilityForm tools={tools} objectives={objectives} submitLabel="Agregar capacidad" onSubmit={actions.addCapability} />
        </details>
      )}
    </section>
  );
}
