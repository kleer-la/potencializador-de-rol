import { useEffect, useId, useState } from 'react';
import { ApiError, boardApi, type Board, type BoardSummary } from '../api/client.ts';
import { ConfirmAction } from '../components/ConfirmAction.tsx';
import { boardStatusLabels, enrollmentRoleLabels, messages, programErrors } from '../copy.ts';

/** The boards a person owns and the ones they accompany, and the board they open. */
export function BoardsPage() {
  const [lists, setLists] = useState<{ mine: BoardSummary[]; accompanied: BoardSummary[] } | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let current = true;
    boardApi
      .list()
      .then((loaded) => current && setLists(loaded))
      .catch(() => current && setFailed(true));
    return () => {
      current = false;
    };
  }, [openId]);

  if (openId !== null) return <BoardView boardId={openId} onBack={() => setOpenId(null)} />;
  if (failed) return <p role="alert">{messages.requestFailed}</p>;
  if (lists === null) return <p>{messages.loading}</p>;
  if (lists.mine.length === 0 && lists.accompanied.length === 0) {
    return <p className="panel">Todavía no tienes tableros. Aparecen cuando te inscriben en un programa.</p>;
  }
  return (
    <div className="columns">
      <BoardList title="Mis tableros" boards={lists.mine} onOpen={setOpenId} showOwner={false} />
      <BoardList title="Tableros que acompaño" boards={lists.accompanied} onOpen={setOpenId} showOwner />
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

  const change = async (work: () => Promise<unknown>) => {
    setError(null);
    try {
      await work();
      await load();
    } catch (failure) {
      setError((failure instanceof ApiError && programErrors[failure.code]) || messages.requestFailed);
    }
  };

  if (failed) return <p role="alert">{messages.requestFailed}</p>;
  if (board === null) return <p>{messages.loading}</p>;

  const levelOf = new Map(board.placements.map((placement) => [placement.capabilityId, placement.levelId]));
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
                      <span>{capability.statement}</span>
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
                          <span className="kanban-dot" aria-label="Aquí">
                            ●
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

      {board.viewer.canAdd && offBoard.length > 0 && (
        <section className="panel">
          <h3>Capacidades del mapa que no están en el tablero</h3>
          <ul className="plain-list">
            {offBoard.map((capability) => (
              <li key={capability.id} className="board-item">
                <span>{capability.statement}</span>
                <button
                  type="button"
                  className="secondary"
                  aria-label={`Agregar «${capability.statement}»`}
                  onClick={() => change(() => boardApi.add(board.id, capability.id))}
                >
                  Agregar
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
