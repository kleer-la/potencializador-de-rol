import { useId, useState } from 'react';
import { ApiError, boardApi, type Board, type ProposedLevel } from '../api/client.ts';
import { ConfirmAction } from '../components/ConfirmAction.tsx';
import { calibrationErrors, enrollmentRoleLabels, messages } from '../copy.ts';

/** `canSkipRoles`: only mandatory panel roles are missing, so the panel may fix the baseline anyway. */
type Failure = { text: string; items: string[]; canSkipRoles?: boolean };

const today = () => {
  const now = new Date();
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
};

/** "2026-11-20" as "20 de noviembre de 2026", without a time zone shift. */
const longDate = (isoDate: string) =>
  new Date(`${isoDate.slice(0, 10)}T12:00:00`).toLocaleDateString('es', { day: 'numeric', month: 'long', year: 'numeric' });

const levelLabel = (board: Board, levelId: string | null) => {
  const level = board.levels.find((candidate) => candidate.id === levelId);
  return level ? `${level.position} · ${level.name}` : null;
};

/** Capabilities on the board, in map order. */
const onBoard = (board: Board) => {
  const placed = new Set(board.placements.map((placement) => placement.capabilityId));
  return board.capabilities.filter((capability) => placed.has(capability.id));
};

/**
 * The calibration: the panel and the participant agree, with real cases, one level per
 * capability. Fixing the baseline needs the participant among the attendees; without a
 * mandatory panel role it needs an explicit confirmation, and the role is recorded as
 * missing (invariant 3 as amended).
 */
export function CalibrationEditor({ board, onDone }: { board: Board; onDone: () => Promise<void> }) {
  const headingId = useId();
  const capabilities = onBoard(board);
  const proposed = new Map((board.selfAssessment?.levels ?? []).map((level) => [level.capabilityId, level.levelId]));
  const people = [
    { personId: board.owner.personId, label: `${board.owner.name} (${enrollmentRoleLabels.participant})` },
    ...board.panel.map((member) => ({ personId: member.personId, label: `${member.name} (${enrollmentRoleLabels[member.role]})` })),
  ];
  const [heldOn, setHeldOn] = useState(today);
  const [notes, setNotes] = useState('');
  const [attendees, setAttendees] = useState<string[]>([]);
  const [agreed, setAgreed] = useState(() => new Map<string, string>());
  const [failure, setFailure] = useState<Failure | null>(null);
  const statement = new Map(board.capabilities.map((capability) => [capability.id, capability.statement]));
  const settled = capabilities.filter((capability) => agreed.has(capability.id)).length;

  const toggle = (personId: string) =>
    setAttendees(
      attendees.includes(personId) ? attendees.filter((candidate) => candidate !== personId) : [...attendees, personId],
    );

  const record = async (allowMissingRoles = false) => {
    setFailure(null);
    const levels: ProposedLevel[] = capabilities.flatMap((capability) => {
      const levelId = agreed.get(capability.id);
      return levelId === undefined ? [] : [{ capabilityId: capability.id, levelId }];
    });
    try {
      await boardApi.calibrate(board.id, { heldOn, notes, attendees, levels, ...(allowMissingRoles ? { allowMissingRoles } : {}) });
      await onDone();
    } catch (error) {
      if (error instanceof ApiError && error.code === 'attendance') {
        const missingRoles = (error.details.missingRoles as Board['program']['mandatoryPanelRoles']) ?? [];
        const onlyRoles = !error.details.participantMissing && missingRoles.length > 0;
        setFailure({
          text: onlyRoles
            ? 'Faltan roles obligatorios del panel. Pueden fijar la línea base igual; quedará registrado qué roles faltaron.'
            : 'Para fijar la línea base deben asistir:',
          canSkipRoles: onlyRoles,
          items: [
            ...(error.details.participantMissing ? [`${board.owner.name} (${enrollmentRoleLabels.participant})`] : []),
            ...missingRoles.map((role) => `Alguien con el rol ${enrollmentRoleLabels[role]}`),
          ],
        });
      } else if (error instanceof ApiError && error.code === 'incomplete') {
        setFailure({
          text: 'Falta el nivel acordado de estas capacidades:',
          items: ((error.details.missing as string[]) ?? []).map((capabilityId) => statement.get(capabilityId) ?? capabilityId),
        });
      } else {
        setFailure({ text: (error instanceof ApiError && calibrationErrors[error.code]) || messages.requestFailed, items: [] });
      }
    }
  };

  return (
    <section className="panel stack" aria-labelledby={headingId}>
      <h3 id={headingId}>Calibración</h3>
      <p className="ds-notice">
        Contrasten cada capacidad con casos reales y acuerden su nivel. Al fijar la línea base, el sistema guarda la diferencia
        con la autoevaluación.
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
          {failure.canSkipRoles && (
            <ConfirmAction
              label="Fijar sin el panel completo"
              prompt="¿Fijar la línea base sin todos los roles obligatorios? Después no se podrá cambiar y quedará registrado qué roles faltaron."
              confirmLabel="Confirmar"
              onConfirm={() => record(true)}
            />
          )}
        </div>
      )}
      <label>
        Fecha de la sesión
        <input type="date" value={heldOn} onChange={(event) => setHeldOn(event.target.value)} />
      </label>
      <fieldset>
        <legend>Asistentes</legend>
        <p className="muted">
          Roles obligatorios: {board.program.mandatoryPanelRoles.map((role) => enrollmentRoleLabels[role]).join(', ')}. El
          participante también debe asistir.
        </p>
        {people.map((person) => (
          <label key={person.personId} className="checkbox-row">
            <input type="checkbox" checked={attendees.includes(person.personId)} onChange={() => toggle(person.personId)} />
            {person.label}
          </label>
        ))}
      </fieldset>
      <label>
        Notas
        <textarea value={notes} maxLength={5000} onChange={(event) => setNotes(event.target.value)} />
      </label>

      <div className="self-assessment">
        {board.dimensions.map((dimension) => {
          const rows = capabilities.filter((capability) => capability.dimensionId === dimension.id);
          if (rows.length === 0) return null;
          return (
            <section key={dimension.id} className="self-assessment-group">
              <h4>{dimension.name}</h4>
              {rows.map((capability) => (
                <div key={capability.id} role="radiogroup" aria-label={capability.statement} className="self-assessment-row">
                  <span className="statement">
                    {capability.statement}
                    <span className="muted">
                      {' '}
                      Autoevaluación: {levelLabel(board, proposed.get(capability.id) ?? null) ?? 'sin propuesta'}
                    </span>
                  </span>
                  <span className="level-options">
                    {board.levels.map((level) => (
                      <label key={level.id} className="level-option">
                        <input
                          type="radio"
                          name={`agreed-${capability.id}`}
                          checked={agreed.get(capability.id) === level.id}
                          onChange={() => setAgreed(new Map(agreed).set(capability.id, level.id))}
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
          {settled} de {capabilities.length} capacidades acordadas
        </span>
        <ConfirmAction
          label="Fijar línea base"
          prompt="¿Fijar la línea base? Después no se podrá cambiar; las capacidades que se agreguen luego se nivelan una por una."
          confirmLabel="Confirmar"
          variant="primary"
          onConfirm={() => record()}
        />
      </div>
    </section>
  );
}

/**
 * A short note under the board legend: when the baseline was fixed, who attended the
 * calibration, the mandatory roles that did not, its notes and the capabilities that joined the baseline later (invariant 3).
 * The board itself sets the baseline beside the current level.
 */
export function BaselineNote({ board }: { board: Board }) {
  const { calibration, baseline } = board;
  if (baseline === null) return null;
  const statement = new Map(board.capabilities.map((capability) => [capability.id, capability.statement]));
  const added = baseline.entries.filter((entry) => entry.origin === 'initial_leveling');

  return (
    <div role="group" aria-label="Contexto de la línea base" className="muted">
      <p className="muted">
        {calibration !== null
          ? `Línea base fijada en la calibración del ${longDate(calibration.heldOn)} · Asistieron: ${calibration.attendees
              .map((person) => person.name)
              .join(', ')}`
          : `Línea base fijada el ${longDate(baseline.setAt)}`}
        {calibration !== null &&
          calibration.missingPanelRoles.length > 0 &&
          ` · Roles obligatorios ausentes: ${calibration.missingPanelRoles.map((role) => enrollmentRoleLabels[role]).join(', ')}`}
      </p>
      {calibration !== null && calibration.notes !== '' && (
        <details>
          <summary>Notas de la calibración</summary>
          <p className="notes muted">{calibration.notes}</p>
        </details>
      )}
      {added.length > 0 && (
        <details>
          <summary>Agregadas después: {added.length}</summary>
          <ul className="plain-list">
            {added.map((entry) => (
              <li key={entry.capabilityId}>
                {statement.get(entry.capabilityId) ?? entry.capabilityId}: {levelLabel(board, entry.levelId)} (nivelación inicial del{' '}
                {longDate(entry.setAt)})
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}

/**
 * Capabilities added after the baseline enter unplaced; a panel member records the
 * initial level agreed with the participant, and it joins the baseline (invariant 3).
 */
export function InitialLevels({ board, onDone }: { board: Board; onDone: () => Promise<void> }) {
  const headingId = useId();
  const pending = onBoard(board).filter(
    (capability) => board.placements.find((placement) => placement.capabilityId === capability.id)?.levelId === null,
  );
  const [chosen, setChosen] = useState(() => new Map<string, string>());
  const [error, setError] = useState<string | null>(null);
  if (!board.viewer.canRecordInitialLevel || pending.length === 0) return null;

  const record = async (capabilityId: string) => {
    const levelId = chosen.get(capabilityId);
    if (levelId === undefined) return;
    setError(null);
    try {
      await boardApi.recordInitialLevel(board.id, { capabilityId, levelId });
      await onDone();
    } catch (failure) {
      setError((failure instanceof ApiError && calibrationErrors[failure.code]) || messages.requestFailed);
    }
  };

  return (
    <section className="panel stack" aria-labelledby={headingId}>
      <h3 id={headingId}>Capacidades por nivelar</h3>
      <p className="muted">Entraron después de la línea base. Acuerden su nivel inicial con el participante; se agrega a la línea base.</p>
      {error !== null && (
        <p role="alert" className="alert">
          {error}
        </p>
      )}
      <ul className="plain-list">
        {pending.map((capability) => (
          <li key={capability.id} className="board-item">
            <span>{capability.statement}</span>
            <span className="actions">
              <select
                aria-label={`Nivel inicial de «${capability.statement}»`}
                value={chosen.get(capability.id) ?? ''}
                onChange={(event) => setChosen(new Map(chosen).set(capability.id, event.target.value))}
              >
                <option value="" disabled>
                  Elige un nivel
                </option>
                {board.levels.map((level) => (
                  <option key={level.id} value={level.id}>
                    {level.position} · {level.name}
                  </option>
                ))}
              </select>
              <button
                type="button"
                disabled={!chosen.has(capability.id)}
                aria-label={`Fijar nivel inicial de «${capability.statement}»`}
                onClick={() => record(capability.id)}
              >
                Fijar nivel inicial
              </button>
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}
