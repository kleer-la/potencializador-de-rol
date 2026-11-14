import { useId, useState } from 'react';
import { ApiError, boardApi, type Board } from '../api/client.ts';
import { ConfirmAction } from '../components/ConfirmAction.tsx';
import { closingErrors, difficultyLabels, enrollmentRoleLabels, evolutionKindLabels, messages } from '../copy.ts';
import { localToday } from './Evidence.tsx';

const formatPoints = (value: number) => (Number.isInteger(value) ? String(value) : value.toFixed(2));
const formatChange = (change: number | null) =>
  change === null ? '—' : change === 0 ? '=' : change > 0 ? `+${formatPoints(change)}` : `−${formatPoints(-change)}`;

/**
 * The maturity score of this board (document §5.2 and §5.3): the total beside its maximum,
 * its evolution across snapshots, and its breakdown by dimension and by difficulty. It is
 * never shown beside anyone else's (invariant 9).
 */
export function ScoreSection({ board }: { board: Board }) {
  const headingId = useId();
  const { score } = board;
  if (score === null) return null;
  const dimensionName = new Map(board.dimensions.map((dimension) => [dimension.id, dimension.name]));

  return (
    <section className="panel stack" aria-labelledby={headingId}>
      <h3 id={headingId}>Puntaje de madurez</h3>
      <p>
        <strong className="score-total">
          {formatPoints(score.total)} de {formatPoints(score.maximum)}
        </strong>{' '}
        <span className="muted">· {score.capabilities} capacidades · el máximo no cuenta bonificaciones</span>
      </p>
      <table aria-label="Evolución">
        <thead>
          <tr>
            <th scope="col">Momento</th>
            <th scope="col">Fecha</th>
            <th scope="col">Puntaje</th>
            <th scope="col">Cambio</th>
            <th scope="col">Capacidades</th>
          </tr>
        </thead>
        <tbody>
          {board.evolution.map((point, index) => (
            <tr key={`${point.kind}-${index}`}>
              <th scope="row">{evolutionKindLabels[point.kind]}</th>
              <td>{point.date.slice(0, 10)}</td>
              <td>
                {formatPoints(point.total)} de {formatPoints(point.maximum)}
              </td>
              <td>{formatChange(point.change)}</td>
              <td>{point.capabilities}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="columns">
        <table aria-label="Por dimensión">
          <thead>
            <tr>
              <th scope="col">Dimensión</th>
              <th scope="col">Puntaje</th>
            </tr>
          </thead>
          <tbody>
            {score.byDimension.map((part) => (
              <tr key={part.dimensionId}>
                <th scope="row">{dimensionName.get(part.dimensionId) ?? part.dimensionId}</th>
                <td>
                  {formatPoints(part.total)} de {formatPoints(part.maximum)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <table aria-label="Por dificultad">
          <thead>
            <tr>
              <th scope="col">Dificultad</th>
              <th scope="col">Puntaje</th>
            </tr>
          </thead>
          <tbody>
            {score.byDifficulty.map((part) => (
              <tr key={part.difficulty ?? 'none'}>
                <th scope="row">{part.difficulty === null ? 'Sin definir' : difficultyLabels[part.difficulty]}</th>
                <td>
                  {formatPoints(part.total)} de {formatPoints(part.maximum)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="muted">La dificultad se muestra; no pondera el puntaje.</p>
    </section>
  );
}

/** A refused change, in Spanish; lists names when the answer gives them. */
function failureText(error: unknown, board: Board): { text: string; items: string[] } {
  if (error instanceof ApiError && error.code === 'attendance') {
    const roles = (error.details.missingRoles as Board['program']['mandatoryPanelRoles']) ?? [];
    return {
      text: 'Para recalibrar deben asistir:',
      items: [
        ...(error.details.participantMissing ? [`${board.owner.name} (${enrollmentRoleLabels.participant})`] : []),
        ...roles.map((role) => `Alguien con el rol ${enrollmentRoleLabels[role]}`),
      ],
    };
  }
  return { text: (error instanceof ApiError && closingErrors[error.code]) || messages.requestFailed, items: [] };
}

/**
 * A recalibration between cycles: the panel and the participant agree every level again,
 * starting from where each capability is now; a level may go down. It leaves a snapshot
 * and never replaces the baseline.
 */
export function RecalibrationEditor({ board, onDone }: { board: Board; onDone: () => Promise<void> }) {
  const headingId = useId();
  const onBoard = new Set(board.placements.map((placement) => placement.capabilityId));
  const capabilities = board.capabilities.filter((capability) => onBoard.has(capability.id));
  const people = [
    { personId: board.owner.personId, label: `${board.owner.name} (${enrollmentRoleLabels.participant})` },
    ...board.panel.map((member) => ({ personId: member.personId, label: `${member.name} (${enrollmentRoleLabels[member.role]})` })),
  ];
  const [heldOn, setHeldOn] = useState(() => localToday());
  const [notes, setNotes] = useState('');
  const [attendees, setAttendees] = useState<string[]>([]);
  const [agreed, setAgreed] = useState(
    () =>
      new Map(
        board.placements.flatMap((placement) => (placement.levelId === null ? [] : [[placement.capabilityId, placement.levelId] as const])),
      ),
  );
  const [failure, setFailure] = useState<{ text: string; items: string[] } | null>(null);
  if (!board.viewer.canRecalibrate) return null;

  const record = async () => {
    setFailure(null);
    try {
      await boardApi.recalibrate(board.id, {
        heldOn,
        notes,
        attendees,
        levels: capabilities.flatMap((capability) => {
          const levelId = agreed.get(capability.id);
          return levelId === undefined ? [] : [{ capabilityId: capability.id, levelId }];
        }),
      });
      await onDone();
    } catch (error) {
      setFailure(failureText(error, board));
    }
  };

  return (
    <section className="panel stack" aria-labelledby={headingId}>
      <h3 id={headingId}>Recalibración</h3>
      <p className="ds-notice">
        Opcional antes del siguiente ciclo. Acuerden de nuevo cada nivel con casos reales; un nivel puede bajar. Deja una fotografía y no
        cambia la línea base.
      </p>
      {failure !== null && (
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
      )}
      <label>
        Fecha de la sesión
        <input type="date" value={heldOn} onChange={(event) => setHeldOn(event.target.value)} />
      </label>
      <fieldset>
        <legend>Asistentes</legend>
        {people.map((person) => (
          <label key={person.personId} className="checkbox-row">
            <input
              type="checkbox"
              checked={attendees.includes(person.personId)}
              onChange={() =>
                setAttendees(
                  attendees.includes(person.personId)
                    ? attendees.filter((candidate) => candidate !== person.personId)
                    : [...attendees, person.personId],
                )
              }
            />
            {person.label}
          </label>
        ))}
      </fieldset>
      <label>
        Notas
        <textarea maxLength={5000} value={notes} onChange={(event) => setNotes(event.target.value)} />
      </label>
      <div className="self-assessment">
        {capabilities.map((capability) => (
          <div key={capability.id} role="radiogroup" aria-label={capability.statement} className="self-assessment-row">
            <span className="statement">{capability.statement}</span>
            <span className="level-options">
              {board.levels.map((level) => (
                <label key={level.id} className="level-option">
                  <input
                    type="radio"
                    name={`recalibrated-${capability.id}`}
                    checked={agreed.get(capability.id) === level.id}
                    onChange={() => setAgreed(new Map(agreed).set(capability.id, level.id))}
                  />
                  {level.position} · {level.name}
                </label>
              ))}
            </span>
          </div>
        ))}
      </div>
      <div className="actions">
        <ConfirmAction
          label="Registrar recalibración"
          prompt="¿Registrar la recalibración? Los niveles que cambien quedan registrados y se toma una fotografía."
          confirmLabel="Confirmar"
          variant="primary"
          onConfirm={record}
        />
      </div>
    </section>
  );
}

/** Closing the board: afterwards nothing on it changes; owner and panel keep reading it. */
export function CloseBoard({ board, onDone }: { board: Board; onDone: () => Promise<void> }) {
  const [error, setError] = useState<string | null>(null);
  if (!board.viewer.canCloseBoard) return null;
  return (
    <div className="actions">
      {error !== null && (
        <p role="alert" className="alert">
          {error}
        </p>
      )}
      <ConfirmAction
        label="Cerrar tablero"
        prompt="¿Cerrar el tablero? Ya no admitirá cambios; su historia y su puntaje se podrán seguir viendo."
        confirmLabel="Confirmar cierre del tablero"
        variant="danger"
        onConfirm={async () => {
          setError(null);
          try {
            await boardApi.closeBoard(board.id);
            await onDone();
          } catch (failure) {
            setError(failureText(failure, board).text);
          }
        }}
      />
    </div>
  );
}
