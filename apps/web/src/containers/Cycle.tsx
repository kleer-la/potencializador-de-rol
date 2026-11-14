import { useId, useState } from 'react';
import { ApiError, boardApi, type Board, type Cycle, type Experiment, type ExperimentResult, type Focus } from '../api/client.ts';
import { ConfirmAction } from '../components/ConfirmAction.tsx';
import { cycleErrors, cycleStateLabels, experimentResultLabels, experimentStateLabels, messages } from '../copy.ts';

type Failure = { text: string; items: string[] };
type Change = (work: () => Promise<unknown>) => Promise<void>;

const failureOf = (error: unknown): Failure => ({
  text: (error instanceof ApiError && cycleErrors[error.code]) || messages.requestFailed,
  items: [],
});

const levelLabel = (board: Board, levelId: string | null) => {
  const level = board.levels.find((candidate) => candidate.id === levelId);
  return level ? `${level.position} · ${level.name}` : 'Sin ubicar';
};

/**
 * The improvement cycle of a board with a baseline: few focuses, each tested with at least
 * one experiment in real work (invariant 8). Participant and panel plan it; the panel starts
 * it and reviews experiments.
 */
export function CycleSection({ board, onChanged }: { board: Board; onChanged: () => Promise<void> }) {
  const headingId = useId();
  const [failure, setFailure] = useState<Failure | null>(null);
  if (!board.hasBaseline) return null;
  const { cycle } = board;

  const change: Change = async (work) => {
    setFailure(null);
    try {
      await work();
      await onChanged();
    } catch (error) {
      setFailure(failureOf(error));
    }
  };

  return (
    <section className="panel stack" aria-labelledby={headingId}>
      <h3 id={headingId}>Ciclo de mejora</h3>
      {failure !== null && <FailureNotice failure={failure} />}
      {cycle === null ? (
        board.viewer.canPlanCycle ? (
          <NewCycle board={board} change={change} />
        ) : (
          <p className="muted">Todavía no hay un ciclo abierto.</p>
        )
      ) : (
        <CurrentCycle board={board} cycle={cycle} change={change} onFailure={setFailure} />
      )}
    </section>
  );
}

function FailureNotice({ failure }: { failure: Failure }) {
  return (
    <div role="alert" className="alert">
      <p>{failure.text}</p>
      {failure.items.length > 0 && (
        <ul>
          {failure.items.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
      )}
    </div>
  );
}

function NewCycle({ board, change }: { board: Board; change: Change }) {
  const [startsOn, setStartsOn] = useState('');
  const [endsOn, setEndsOn] = useState('');
  return (
    <form
      className="stack"
      onSubmit={(event) => {
        event.preventDefault();
        void change(() => boardApi.createCycle(board.id, { startsOn, endsOn }));
      }}
    >
      <p className="muted">Un ciclo trabaja pocas capacidades; cada una se prueba con experimentos en el trabajo real.</p>
      <label>
        Inicio
        <input type="date" required value={startsOn} onChange={(event) => setStartsOn(event.target.value)} />
      </label>
      <label>
        Fin
        <input type="date" required value={endsOn} onChange={(event) => setEndsOn(event.target.value)} />
      </label>
      <div className="actions">
        <button type="submit">Crear ciclo</button>
      </div>
    </form>
  );
}

function CurrentCycle(props: { board: Board; cycle: Cycle; change: Change; onFailure: (failure: Failure) => void }) {
  const { board, cycle, change } = props;
  const statement = new Map(board.capabilities.map((capability) => [capability.id, capability.statement]));
  const planned = cycle.state === 'planned';

  const start = async () => {
    try {
      await boardApi.startCycle(board.id, cycle.id);
      await change(async () => undefined);
    } catch (error) {
      if (error instanceof ApiError && error.code === 'cannot_start') {
        const details = error.details as { noFocus?: boolean; tooMany?: boolean; withoutExperiment?: string[] };
        props.onFailure({
          text: 'El ciclo todavía no puede empezar:',
          items: [
            ...(details.noFocus ? ['Agrega al menos un foco.'] : []),
            ...(details.tooMany ? [`Hay más focos que el máximo del programa (${cycle.maxFocuses}).`] : []),
            ...(details.withoutExperiment ?? []).map((capabilityId) => statement.get(capabilityId) ?? capabilityId),
          ],
        });
      } else {
        props.onFailure(failureOf(error));
      }
    }
  };

  return (
    <div className="stack">
      <p>
        <strong>
          Ciclo {cycle.number} · {cycleStateLabels[cycle.state]}
        </strong>{' '}
        <span className="muted">
          del {cycle.startsOn} al {cycle.endsOn}
        </span>
      </p>
      <p className="muted">
        {cycle.focuses.length} de {cycle.maxFocuses} focos
      </p>
      {cycle.focuses.map((focus) => (
        <FocusCard key={focus.id} board={board} cycle={cycle} focus={focus} change={change} />
      ))}
      {planned && board.viewer.canPlanCycle && cycle.focuses.length < cycle.maxFocuses && (
        <NewFocus board={board} cycle={cycle} change={change} />
      )}
      {planned && board.viewer.canStartCycle && (
        <div className="actions">
          <ConfirmAction
            label="Iniciar ciclo"
            prompt="¿Iniciar el ciclo? Durante el ciclo los focos quedan fijos; se pueden sumar experimentos."
            confirmLabel="Confirmar inicio"
            variant="primary"
            onConfirm={start}
          />
        </div>
      )}
    </div>
  );
}

function NewFocus({ board, cycle, change }: { board: Board; cycle: Cycle; change: Change }) {
  const [capabilityId, setCapabilityId] = useState('');
  const [targetLevelId, setTargetLevelId] = useState('');
  const taken = new Set(cycle.focuses.map((focus) => focus.capabilityId));
  const levelOf = new Map(board.placements.map((placement) => [placement.capabilityId, placement.levelId]));
  const position = (levelId: string | null | undefined) => board.levels.find((level) => level.id === levelId)?.position;
  // Placed capabilities on the board that can still rise and are not a focus yet.
  const candidates = board.capabilities.filter((capability) => {
    const current = position(levelOf.get(capability.id));
    return current !== undefined && !taken.has(capability.id) && board.levels.some((level) => level.position > current);
  });
  const current = position(levelOf.get(capabilityId));
  const targets = current === undefined ? [] : board.levels.filter((level) => level.position > current);
  if (candidates.length === 0) return null;

  return (
    <form
      className="stack"
      onSubmit={(event) => {
        event.preventDefault();
        void change(() => boardApi.addFocus(board.id, cycle.id, { capabilityId, targetLevelId }));
      }}
    >
      <h4>Nuevo foco</h4>
      <label>
        Capacidad
        <select
          required
          value={capabilityId}
          onChange={(event) => {
            setCapabilityId(event.target.value);
            setTargetLevelId('');
          }}
        >
          <option value="" disabled>
            Elige una capacidad
          </option>
          {candidates.map((capability) => (
            <option key={capability.id} value={capability.id}>
              {capability.statement}
            </option>
          ))}
        </select>
      </label>
      <label>
        Nivel objetivo
        <select required value={targetLevelId} onChange={(event) => setTargetLevelId(event.target.value)}>
          <option value="" disabled>
            Elige un nivel
          </option>
          {targets.map((level) => (
            <option key={level.id} value={level.id}>
              {level.position} · {level.name}
            </option>
          ))}
        </select>
      </label>
      <div className="actions">
        <button type="submit">Agregar foco</button>
      </div>
    </form>
  );
}

function FocusCard(props: { board: Board; cycle: Cycle; focus: Focus; change: Change }) {
  const { board, cycle, focus, change } = props;
  const statement = board.capabilities.find((capability) => capability.id === focus.capabilityId)?.statement ?? focus.capabilityId;
  const currentLevelId = board.placements.find((placement) => placement.capabilityId === focus.capabilityId)?.levelId ?? null;
  const [description, setDescription] = useState('');
  const [expectedResult, setExpectedResult] = useState('');
  const canPlan = board.viewer.canPlanCycle;

  return (
    <article className="focus-card stack" aria-label={statement}>
      <div className="board-item">
        <div>
          <strong>{statement}</strong>
          <div className="muted">
            Nivel actual: {levelLabel(board, currentLevelId)} · Objetivo: {levelLabel(board, focus.targetLevelId)}
          </div>
        </div>
        {cycle.state === 'planned' && canPlan && (
          <ConfirmAction
            label="Quitar"
            accessibleLabel={`Quitar foco «${statement}»`}
            prompt="¿Quitar este foco y sus experimentos?"
            confirmLabel="Confirmar"
            variant="quiet-danger"
            onConfirm={() => change(() => boardApi.removeFocus(board.id, cycle.id, focus.id))}
          />
        )}
      </div>
      {focus.experiments.length === 0 ? (
        <p className="muted">Sin experimentos todavía: cada foco necesita al menos uno para iniciar el ciclo.</p>
      ) : (
        <ul className="plain-list stack">
          {focus.experiments.map((experiment) => (
            <ExperimentItem key={experiment.id} board={board} cycle={cycle} experiment={experiment} change={change} />
          ))}
        </ul>
      )}
      {cycle.state !== 'closed' && canPlan && (
        <form
          className="stack"
          onSubmit={(event) => {
            event.preventDefault();
            void change(async () => {
              await boardApi.addExperiment(board.id, cycle.id, focus.id, { description, expectedResult });
              setDescription('');
              setExpectedResult('');
            });
          }}
        >
          <label>
            Experimento
            <input required maxLength={2000} value={description} onChange={(event) => setDescription(event.target.value)} />
          </label>
          <label>
            Resultado esperado
            <input maxLength={2000} value={expectedResult} onChange={(event) => setExpectedResult(event.target.value)} />
          </label>
          <div className="actions">
            <button type="submit" className="secondary">
              Agregar experimento
            </button>
          </div>
        </form>
      )}
    </article>
  );
}

function ExperimentItem(props: { board: Board; cycle: Cycle; experiment: Experiment; change: Change }) {
  const { board, cycle, experiment, change } = props;
  const [result, setResult] = useState<ExperimentResult | ''>('');
  const [learnings, setLearnings] = useState('');
  const active = cycle.state === 'active';
  const reviewable = active && board.viewer.canReviewExperiments && experiment.state !== 'reviewed';
  // A planned experiment that never ran can only be discarded.
  const results = (Object.keys(experimentResultLabels) as ExperimentResult[]).filter(
    (candidate) => experiment.state === 'in_progress' || candidate === 'discarded',
  );

  return (
    <li aria-label={experiment.description} className="experiment stack">
      <div>
        <strong>{experiment.description}</strong>{' '}
        <span className="tag">
          {experimentStateLabels[experiment.state]}
          {experiment.result !== null && `: ${experimentResultLabels[experiment.result]}`}
        </span>
      </div>
      {experiment.expectedResult !== '' && <div className="muted">Resultado esperado: {experiment.expectedResult}</div>}
      {experiment.learnings !== '' && <div className="notes">Aprendizajes: {experiment.learnings}</div>}
      {active && board.viewer.canPlanCycle && experiment.state === 'planned' && (
        <div className="actions">
          <button
            type="button"
            className="secondary"
            aria-label={`Marcar en curso «${experiment.description}»`}
            onClick={() => change(() => boardApi.moveExperiment(board.id, experiment.id, { state: 'in_progress' }))}
          >
            Marcar en curso
          </button>
        </div>
      )}
      {reviewable && (
        <form
          className="stack"
          onSubmit={(event) => {
            event.preventDefault();
            if (result === '') return;
            void change(() => boardApi.moveExperiment(board.id, experiment.id, { state: 'reviewed', result, learnings }));
          }}
        >
          <label>
            Resultado
            <select required value={result} onChange={(event) => setResult(event.target.value as ExperimentResult)}>
              <option value="" disabled>
                Elige un resultado
              </option>
              {results.map((candidate) => (
                <option key={candidate} value={candidate}>
                  {experimentResultLabels[candidate]}
                </option>
              ))}
            </select>
          </label>
          <label>
            Aprendizajes
            <textarea maxLength={5000} value={learnings} onChange={(event) => setLearnings(event.target.value)} />
          </label>
          <div className="actions">
            <button type="submit" aria-label={`Registrar revisión «${experiment.description}»`}>
              Registrar revisión
            </button>
          </div>
        </form>
      )}
    </li>
  );
}
