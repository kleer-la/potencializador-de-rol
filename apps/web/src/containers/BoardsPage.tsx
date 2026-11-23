import { useEffect, useId, useState } from 'react';
import { ApiError, boardApi, type Board, type BoardLists, type BoardMark, type BoardSummary, type ProposedLevel } from '../api/client.ts';
import { ConfirmAction } from '../components/ConfirmAction.tsx';
import { BaselineNote, CalibrationEditor, InitialLevels } from './Calibration.tsx';
import { CycleSection } from './Cycle.tsx';
import { BonusesSection, EvidenceSection, LevelChangesSection, MentoringSection } from './Evidence.tsx';
import { CloseBoard, RecalibrationEditor, ScoreSection } from './Score.tsx';
import { boardStatusLabels, created, enrollmentRoleLabels, markHints, markLabels, messages, programErrors } from '../copy.ts';
import { notifyCreated } from '../feedback.ts';

/** The boards a person owns, accompanies or reads as leader of their program, and the board they open. */
export function BoardsPage() {
  const [lists, setLists] = useState<BoardLists | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let current = true;
    setFailed(false);
    boardApi
      .list()
      .then((loaded) => current && setLists(loaded))
      .catch(() => current && setFailed(true));
    return () => {
      current = false;
    };
  }, [openId, attempt]);

  if (openId !== null) return <BoardView boardId={openId} onBack={() => setOpenId(null)} />;
  if (failed) {
    return (
      <div className="stack">
        <p role="alert">{messages.requestFailed}</p>
        <div className="actions">
          <button type="button" onClick={() => setAttempt(attempt + 1)}>
            Reintentar
          </button>
        </div>
      </div>
    );
  }
  if (lists === null) return <p>{messages.loading}</p>;
  if (lists.mine.length === 0 && lists.accompanied.length === 0 && lists.program.length === 0) {
    return <p className="panel">Todavía no tienes tableros. Aparecen cuando te inscriben en un programa.</p>;
  }
  return (
    <div className="columns">
      <BoardList title="Mis tableros" boards={lists.mine} onOpen={setOpenId} showOwner={false} />
      <BoardList title="Tableros que acompaño" boards={lists.accompanied} onOpen={setOpenId} showOwner />
      {lists.program.length > 0 && (
        <BoardList title="Tableros de mis programas" boards={lists.program} onOpen={setOpenId} showOwner />
      )}
    </div>
  );
}

function BoardList(props: {
  title: string;
  boards: BoardSummary[];
  onOpen: (boardId: string) => void;
  showOwner: boolean;
}) {
  const headingId = useId();
  return (
    <section className="panel" aria-labelledby={headingId}>
      <h2 id={headingId}>{props.title}</h2>
      {props.boards.length === 0 ? (
        <p className="muted">Ninguno por ahora.</p>
      ) : (
        <ul className="plain-list">
          {props.boards.map((board) => (
            <li key={board.id} className="board-item">
              <div>
                {props.showOwner && <strong>{board.ownerName}</strong>}
                <div>{board.programName}</div>
                <div className="muted">{board.organizationName}</div>
              </div>
              <span className="actions">
                <span className="tag">{boardStatusLabels[board.status]}</span>
                {board.panelRoles.map((role) => (
                  <span key={role} className="tag objective">
                    {enrollmentRoleLabels[role]}
                  </span>
                ))}
                <button type="button" aria-label={`Abrir el tablero de ${board.ownerName}`} onClick={() => props.onOpen(board.id)}>
                  Abrir
                </button>
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

const LEVEL_TOKENS = ['--level-0', '--level-1', '--level-2', '--level-3', '--level-4'];

/**
 * A participant's board: capabilities in rows by dimension, a column "Sin ubicar" and one
 * column per level. Only its owner and panel reach it (invariant 9); only the panel
 * changes which capabilities it holds (invariant 1).
 */
export function BoardView({ boardId, onBack }: { boardId: string; onBack: () => void }) {
  const [board, setBoard] = useState<Board | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  const load = () =>
    boardApi
      .board(boardId)
      .then(setBoard)
      .catch(() => setFailed(true));

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reload when the board changes
  }, [boardId]);

  const change = async (work: () => Promise<unknown>, success?: string) => {
    setError(null);
    try {
      await work();
      await load();
      if (success !== undefined) notifyCreated(success);
    } catch (failure) {
      setError((failure instanceof ApiError && programErrors[failure.code]) || messages.requestFailed);
    }
  };

  if (failed) return <p role="alert">{messages.requestFailed}</p>;
  if (board === null) return <p>{messages.loading}</p>;

  if (board.viewer.canSelfAssess) {
    return <SelfAssessmentEditor board={board} onBack={onBack} onSubmitted={load} />;
  }

  const levelOf = new Map(board.placements.map((placement) => [placement.capabilityId, placement.levelId]));
  const marksOf = new Map(board.placements.map((placement) => [placement.capabilityId, placement.marks]));

  // Before the baseline the board sets the agreed level beside the self-assessment; once the
  // baseline exists, it sets the current level beside the baseline (invariant 3).
  const baselineLevels = board.baseline
    ? new Map(board.baseline.entries.map((entry) => [entry.capabilityId, entry.levelId]))
    : null;
  const proposed = baselineLevels
    ? null
    : board.selfAssessment?.submittedAt
      ? new Map(board.selfAssessment.levels.map((level) => [level.capabilityId, level.levelId]))
      : null;
  const reference = baselineLevels ?? proposed;
  const placedLabel = baselineLevels ? 'Estado actual' : 'Nivel acordado';
  const referenceLabel = baselineLevels ? 'Línea base' : 'Autoevaluación';
  const columns = [null, ...board.levels.map((level) => level.id)];
  const offBoard = board.capabilities.filter((capability) => !levelOf.has(capability.id));

  return (
    <div className="stack">
      <div className="actions">
        <button type="button" className="secondary" onClick={onBack}>
          Volver a mis tableros
        </button>
      </div>
      <header className="board-header">
        <h2>Tablero de {board.ownerName}</h2>
        <span className="tag">{boardStatusLabels[board.status]}</span>
        <span className="muted">{board.program.name}</span>
      </header>
      {board.viewer.isOwner && <p className="ds-notice">Tu panel decide qué capacidades trabajas en este programa.</p>}
      {board.viewer.isOwner && board.selfAssessment?.submittedAt && (
        <p className="ds-notice">Enviaste tu autoevaluación. Tu panel la usará en la calibración.</p>
      )}
      {baselineLevels !== null && (
        <div>
          <p className="muted">● estado actual · ○ línea base</p>
          <BaselineNote board={board} />
        </div>
      )}
      {proposed !== null && <p className="muted">● nivel acordado · ○ autoevaluación</p>}
      {error !== null && (
        <p role="alert" className="alert">
          {error}
        </p>
      )}

      <div className="panel board-scroll">
        <table className="kanban" aria-label="Tablero">
          <thead>
            <tr>
              <th scope="col">Capacidad</th>
              {columns.map((levelId, index) => {
                const level = board.levels.find((candidate) => candidate.id === levelId);
                return (
                  <th
                    key={levelId ?? 'unplaced'}
                    scope="col"
                    style={
                      level
                        ? {
                            background: `var(${LEVEL_TOKENS[Math.min(index - 1, 4)]})`,
                            color: index - 1 >= 4 ? 'var(--on-level-4)' : 'var(--ink)',
                          }
                        : undefined
                    }
                  >
                    {level ? `${level.position} · ${level.name}` : 'Sin ubicar'}
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {board.dimensions.map((dimension) => {
              const rows = board.capabilities.filter(
                (capability) => capability.dimensionId === dimension.id && levelOf.has(capability.id),
              );
              if (rows.length === 0) return null;
              return [
                <tr key={dimension.id} className="kanban-dimension">
                  <th scope="row" colSpan={columns.length + 1}>
                    {dimension.name}
                  </th>
                </tr>,
                ...rows.map((capability) => (
                  <tr key={capability.id}>
                    <td className="kanban-statement">
                      <div className="kanban-capability">
                        <span>{capability.statement}</span>
                        <CapabilityMarks
                          statement={capability.statement}
                          marks={marksOf.get(capability.id) ?? []}
                          canMark={board.viewer.canMark}
                          onToggle={(mark, on) => change(() => boardApi.mark(board.id, capability.id, mark, on))}
                        />
                      </div>
                      {board.viewer.canRemove && (
                        <ConfirmAction
                          label="Quitar"
                          accessibleLabel={`Quitar «${capability.statement}»`}
                          prompt="¿Quitar esta capacidad del tablero?"
                          confirmLabel="Confirmar"
                          variant="quiet-danger"
                          onConfirm={() => change(() => boardApi.remove(board.id, capability.id))}
                        />
                      )}
                    </td>
                    {columns.map((levelId) => (
                      <td key={levelId ?? 'unplaced'} className="kanban-cell">
                        {levelOf.get(capability.id) === levelId && (
                          <span className="kanban-dot" aria-label={placedLabel}>
                            ●
                          </span>
                        )}
                        {reference !== null && levelId !== null && reference.get(capability.id) === levelId && (
                          <span className="kanban-dot proposed" aria-label={referenceLabel}>
                            ○
                          </span>
                        )}
                      </td>
                    ))}
                  </tr>
                )),
              ];
            })}
          </tbody>
        </table>
      </div>

      {board.viewer.canCalibrate && <CalibrationEditor board={board} onDone={load} />}
      <InitialLevels board={board} onDone={load} />
      <ScoreSection board={board} />
      <CycleSection board={board} onChanged={load} />
      <EvidenceSection board={board} onChanged={load} />
      <LevelChangesSection board={board} onChanged={load} />
      <BonusesSection board={board} onChanged={load} />
      {/* Remounted when levels change, so the form starts from the board as it is now. */}
      <RecalibrationEditor
        key={board.placements.map((placement) => `${placement.capabilityId}:${placement.levelId}`).join('|')}
        board={board}
        onDone={load}
      />
      <MentoringSection board={board} onChanged={load} />
      <CloseBoard board={board} onDone={load} />

      {board.viewer.canAdd && offBoard.length > 0 && (
        <section className="panel" aria-labelledby="off-board-title">
          <h3 id="off-board-title">Capacidades del mapa que no están en el tablero</h3>
          {board.dimensions.map((dimension) => {
            const items = offBoard.filter((capability) => capability.dimensionId === dimension.id);
            if (items.length === 0) return null;
            return (
              <div key={dimension.id}>
                <h4>{dimension.name}</h4>
                <ul className="plain-list" aria-label={dimension.name}>
                  {items.map((capability) => (
                    <li key={capability.id} className="board-item">
                      <span>{capability.statement}</span>
                      <button
                        type="button"
                        className="secondary"
                        aria-label={`Agregar «${capability.statement}»`}
                        onClick={() => change(() => boardApi.add(board.id, capability.id), created.boardCapability)}
                      >
                        Agregar
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            );
          })}
        </section>
      )}
    </div>
  );
}

const MARKS = Object.keys(markLabels) as BoardMark[];
/** WIP follows the experiments of the capability; the other marks are put by hand. */
const BY_HAND: readonly BoardMark[] = ['candidate'];

/**
 * The marks of one capability of the board: toggles for the marks put by hand, for the owner
 * and their panel; tags for the rest and for anyone else who reads the board.
 */
function CapabilityMarks(props: {
  statement: string;
  marks: BoardMark[];
  canMark: boolean;
  onToggle: (mark: BoardMark, on: boolean) => void;
}) {
  const { statement, marks, canMark, onToggle } = props;
  const shown = MARKS.filter((mark) => (canMark && BY_HAND.includes(mark)) || marks.includes(mark));
  if (shown.length === 0) return null;
  return (
    <span className="capability-marks">
      {shown.map((mark) => {
        const on = marks.includes(mark);
        if (!canMark || !BY_HAND.includes(mark)) {
          return (
            <span key={mark} className={`tag mark ${mark}`} title={markHints[mark]}>
              {markLabels[mark]}
            </span>
          );
        }
        return (
          <button
            key={mark}
            type="button"
            className={`mark-toggle ${mark}${on ? ' on' : ''}`}
            aria-pressed={on}
            aria-label={`${markLabels[mark]} «${statement}»`}
            title={markHints[mark]}
            onClick={() => onToggle(mark, !on)}
          >
            {markLabels[mark]}
          </button>
        );
      })}
    </span>
  );
}

/**
 * The owner's self-assessment: one level per capability on the board, by their own
 * perception. A proposal for the calibration, never the baseline and never a score
 * (invariant 2).
 */
function SelfAssessmentEditor(props: { board: Board; onBack: () => void; onSubmitted: () => Promise<void> }) {
  const { board } = props;
  const onBoard = new Set(board.placements.map((placement) => placement.capabilityId));
  const capabilities = board.capabilities.filter((capability) => onBoard.has(capability.id));
  const [chosen, setChosen] = useState(
    () => new Map((board.selfAssessment?.levels ?? []).map((level) => [level.capabilityId, level.levelId])),
  );
  const [error, setError] = useState<{ text: string; missing: string[] } | null>(null);
  const [saved, setSaved] = useState(false);
  const placed = capabilities.filter((capability) => chosen.has(capability.id)).length;

  const levels = (): ProposedLevel[] =>
    capabilities.flatMap((capability) => {
      const levelId = chosen.get(capability.id);
      return levelId === undefined ? [] : [{ capabilityId: capability.id, levelId }];
    });

  const failed = (failure: unknown) => {
    const missing = failure instanceof ApiError && failure.code === 'incomplete' ? (failure.details.missing as string[]) : [];
    setError({
      text:
        missing.length > 0
          ? 'Falta un nivel para estas capacidades:'
          : (failure instanceof ApiError && programErrors[failure.code]) || messages.requestFailed,
      missing,
    });
  };

  const save = async () => {
    setError(null);
    setSaved(false);
    try {
      await boardApi.saveSelfAssessment(board.id, levels());
      setSaved(true);
    } catch (failure) {
      failed(failure);
    }
  };

  const submit = async () => {
    setError(null);
    try {
      await boardApi.saveSelfAssessment(board.id, levels());
      await boardApi.submitSelfAssessment(board.id);
      await props.onSubmitted();
    } catch (failure) {
      failed(failure);
    }
  };

  const statement = new Map(board.capabilities.map((capability) => [capability.id, capability.statement]));

  return (
    <div className="stack">
      <div className="actions">
        <button type="button" className="secondary" onClick={props.onBack}>
          Volver a mis tableros
        </button>
      </div>
      <header className="board-header">
        <h2>Tablero de {board.ownerName}</h2>
        <span className="muted">{board.program.name}</span>
      </header>
      <p className="ds-notice">
        Tu autoevaluación es una propuesta: no es tu línea base y no da puntaje. Ubica cada capacidad donde crees que
        estás hoy; tu panel la contrastará con casos reales en la calibración.
      </p>
      {error !== null && (
        <div role="alert" className="alert">
          <p>{error.text}</p>
          {error.missing.length > 0 && (
            <ul>
              {error.missing.map((capabilityId) => (
                <li key={capabilityId}>{statement.get(capabilityId) ?? capabilityId}</li>
              ))}
            </ul>
          )}
        </div>
      )}

      <div className="panel self-assessment">
        {board.dimensions.map((dimension) => {
          const rows = capabilities.filter((capability) => capability.dimensionId === dimension.id);
          if (rows.length === 0) return null;
          return (
            <section key={dimension.id} className="self-assessment-group">
              <h3>{dimension.name}</h3>
              {rows.map((capability) => (
                <div key={capability.id} role="radiogroup" aria-label={capability.statement} className="self-assessment-row">
                  <span className="statement">{capability.statement}</span>
                  <span className="level-options">
                    {board.levels.map((level) => (
                      <label key={level.id} className="level-option">
                        <input
                          type="radio"
                          name={`level-${capability.id}`}
                          checked={chosen.get(capability.id) === level.id}
                          onChange={() => {
                            setChosen(new Map(chosen).set(capability.id, level.id));
                            setSaved(false);
                          }}
                        />
                        {level.position} · {level.name}
                      </label>
                    ))}
                  </span>
                </div>
              ))}
            </section>
          );
        })}
      </div>

      <div className="actions">
        <span className="muted">
          {placed} de {capabilities.length} capacidades con nivel
        </span>
        <button type="button" onClick={save}>
          Guardar borrador
        </button>
        {saved && <span className="muted">Borrador guardado.</span>}
        <ConfirmAction
          label="Enviar autoevaluación"
          prompt="¿Enviar tu autoevaluación? Después no podrás cambiarla; tu panel la verá en la calibración."
          confirmLabel="Confirmar envío"
          variant="primary"
          onConfirm={submit}
        />
      </div>
    </div>
  );
}
