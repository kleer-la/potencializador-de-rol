import { canApplyChange, type PublishObstacle } from '@potencializador/domain';
import { useCallback, useEffect, useState } from 'react';
import {
  ApiError,
  type CapabilityMap,
  type Objective,
  type OrganizationApi,
  type Tool,
} from '../api/client.ts';
import { BonusRulesEditor } from '../components/BonusRulesEditor.tsx';
import { ConfirmAction } from '../components/ConfirmAction.tsx';
import { DimensionForm } from '../components/DimensionForm.tsx';
import { DimensionSection } from '../components/DimensionSection.tsx';
import { ScaleEditor } from '../components/ScaleEditor.tsx';
import { confirmations, frozenNotices, mapErrors, messages, obstacleText, statusLabels } from '../copy.ts';

type Props = {
  api: OrganizationApi;
  mapId: string;
  canDesign: boolean;
  onBack: () => void;
};

/**
 * One version of a map. The changes offered follow the same rule the API and the database
 * enforce (invariant 10): a draft accepts everything, a published map only grows, an
 * archived map accepts nothing.
 */
export function MapEditor({ api, mapId, canDesign, onBack }: Props) {
  const [map, setMap] = useState<CapabilityMap | null>(null);
  const [tools, setTools] = useState<Tool[]>([]);
  const [objectives, setObjectives] = useState<Objective[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [obstacles, setObstacles] = useState<PublishObstacle[]>([]);
  const [loadFailed, setLoadFailed] = useState(false);

  const reload = useCallback(async () => {
    setMap(await api.map(mapId));
  }, [api, mapId]);

  useEffect(() => {
    let current = true;
    Promise.all([api.map(mapId), api.catalog<Tool>('tools'), api.catalog<Objective>('strategic-objectives')])
      .then(([loaded, loadedTools, loadedObjectives]) => {
        if (!current) return;
        setMap(loaded);
        setTools(loadedTools);
        setObjectives(loadedObjectives);
      })
      .catch(() => current && setLoadFailed(true));
    return () => {
      current = false;
    };
  }, [api, mapId]);

  /**
   * Runs a change and reports a refusal; rethrows so forms keep their input. A change that
   * answers with the whole map (publish, archive) shows it; any other reloads the map.
   */
  const run = async (work: () => Promise<unknown>) => {
    setError(null);
    setObstacles([]);
    try {
      const result = await work();
      if (result !== null && typeof result === 'object' && 'dimensions' in result) setMap(result as CapabilityMap);
      else await reload();
    } catch (failure) {
      if (failure instanceof ApiError && failure.code === 'cannot_publish') {
        setObstacles(failure.obstacles);
      } else {
        setError((failure instanceof ApiError && mapErrors[failure.code]) || messages.requestFailed);
      }
      throw failure;
    }
  };
  const quietly = (work: () => Promise<unknown>) => run(work).catch(() => undefined);

  if (loadFailed) return <p role="alert">{messages.requestFailed}</p>;
  if (map === null) return <p>{messages.loading}</p>;

  const allows = (change: Parameters<typeof canApplyChange>[1]) => canDesign && canApplyChange(map.status, change);

  return (
    <div className="stack">
      <div className="actions">
        <button type="button" className="secondary" onClick={onBack}>
          Volver a las versiones
        </button>
      </div>
      <header className="map-header">
        <h3>
          Versión {map.version} · {statusLabels[map.status]}
        </h3>
        {canDesign && map.status === 'draft' && (
          <>
            <ConfirmAction
              label="Publicar"
              prompt={confirmations.publish}
              confirmLabel="Confirmar publicación"
              variant="primary"
              onConfirm={() => quietly(() => api.publish(map.id))}
            />
            <ConfirmAction
              label="Descartar borrador"
              prompt={confirmations.discard}
              confirmLabel="Confirmar descarte"
              variant="danger"
              onConfirm={async () => {
                setError(null);
                try {
                  await api.discard(map.id);
                  onBack();
                } catch {
                  setError(messages.requestFailed);
                }
              }}
            />
          </>
        )}
        {canDesign && map.status === 'published' && (
          <ConfirmAction
            label="Archivar"
            prompt={confirmations.archive}
            confirmLabel="Confirmar archivo"
            onConfirm={() => quietly(() => api.archive(map.id))}
          />
        )}
      </header>

      {map.status !== 'draft' && <p className="ds-notice ds-notice--frozen">{frozenNotices[map.status]}</p>}

      {(error !== null || obstacles.length > 0) && (
        <div role="alert" className="alert">
          {error !== null && <p>{error}</p>}
          {obstacles.length > 0 && (
            <>
              <p>No se puede publicar todavía:</p>
              <ul>
                {obstacles.map((obstacle, index) => (
                  <li key={index}>{obstacleText(obstacle)}</li>
                ))}
              </ul>
            </>
          )}
        </div>
      )}

      <div className="columns">
        <section className="panel">
          <h4>Escala de madurez</h4>
          <ScaleEditor
            levels={map.levels}
            {...(allows('change_scale') ? { onSave: (levels) => run(() => api.replaceScale(map.id, levels)) } : {})}
          />
        </section>
        <section className="panel">
          <h4>Bonificaciones</h4>
          <BonusRulesEditor
            rules={map.bonusRules}
            {...(allows('change_bonus_rules')
              ? { onSave: (rules) => run(() => api.replaceBonusRules(map.id, rules)) }
              : {})}
          />
        </section>
      </div>

      {map.dimensions.map((dimension, index) => (
        <DimensionSection
          key={dimension.id}
          dimension={dimension}
          isFirst={index === 0}
          isLast={index === map.dimensions.length - 1}
          tools={tools}
          objectives={objectives}
          actions={{
            ...(allows('add_capability') && {
              addCapability: (capability) => run(() => api.addCapability(map.id, dimension.id, capability)),
            }),
            ...(allows('change_dimension') && {
              changeDimension: (change) => run(() => api.changeDimension(map.id, dimension.id, change)),
            }),
            ...(allows('remove_dimension') && {
              removeDimension: () => quietly(() => api.removeDimension(map.id, dimension.id)),
            }),
            ...(allows('change_capability') && {
              changeCapability: (capabilityId, change) => run(() => api.changeCapability(map.id, capabilityId, change)),
            }),
            ...(allows('remove_capability') && {
              removeCapability: (capabilityId) => quietly(() => api.removeCapability(map.id, capabilityId)),
            }),
          }}
        />
      ))}

      {allows('add_dimension') && (
        <section className="panel">
          <h4>Nueva dimensión</h4>
          <DimensionForm submitLabel="Agregar dimensión" onSubmit={(dimension) => run(() => api.addDimension(map.id, dimension))} />
        </section>
      )}
    </div>
  );
}
