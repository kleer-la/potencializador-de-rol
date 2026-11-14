import { useId, useState, type ReactNode } from 'react';
import { ApiError, boardApi, type Board, type Evidence } from '../api/client.ts';
import { decisionStateLabels, evidenceErrors, messages, proposalProblemLabels } from '../copy.ts';

type Failure = { text: string; items: string[] };
type Change = (work: () => Promise<unknown>) => Promise<boolean>;

const failureOf = (error: unknown): Failure => {
  if (error instanceof ApiError && Array.isArray(error.details.problems)) {
    return {
      text: 'La propuesta no se puede registrar:',
      items: (error.details.problems as string[]).map((problem) => proposalProblemLabels[problem] ?? problem),
    };
  }
  return { text: (error instanceof ApiError && evidenceErrors[error.code]) || messages.requestFailed, items: [] };
};

/** Today in the person's own time zone, as a date input expects it. */
export const localToday = (now = new Date()) => {
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
};
const today = () => localToday();

/**
 * Evidence and what is decided with it, after the baseline: level changes (invariants 4 to
 * 6), bonuses (invariant 7) and mentoring sessions. The owner proposes; the panel decides.
 */
export function EvidenceSections({ board, onChanged }: { board: Board; onChanged: () => Promise<void> }) {
  if (!board.hasBaseline) return null;
  return (
    <>
      <EvidenceSection board={board} onChanged={onChanged} />
      <LevelChangesSection board={board} onChanged={onChanged} />
      <BonusesSection board={board} onChanged={onChanged} />
      <MentoringSection board={board} onChanged={onChanged} />
    </>
  );
}

/** A titled section with its own failure notice; `change` runs a write and reloads. */
function Section(props: {
  title: string;
  onChanged: () => Promise<void>;
  children: (change: Change) => ReactNode;
}) {
  const headingId = useId();
  const [failure, setFailure] = useState<Failure | null>(null);
  const change: Change = async (work) => {
    setFailure(null);
    try {
      await work();
      await props.onChanged();
      return true;
    } catch (error) {
      setFailure(failureOf(error));
      return false;
    }
  };
  return (
    <section className="panel stack" aria-labelledby={headingId}>
      <h3 id={headingId}>{props.title}</h3>
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
      {props.children(change)}
    </section>
  );
}

function EvidenceSection({ board, onChanged }: { board: Board; onChanged: () => Promise<void> }) {
  const [description, setDescription] = useState('');
  const [occurredOn, setOccurredOn] = useState(today);
  const [link, setLink] = useState('');
  const [showsTransfer, setShowsTransfer] = useState(false);

  return (
    <Section title="Evidencias" onChanged={onChanged}>
      {(change) => (
        <>
          {board.evidence.length === 0 ? (
            <p className="muted">Todavía no hay evidencias. Son hechos del trabajo real que sustentan los cambios de nivel.</p>
          ) : (
            <ul className="plain-list stack">
              {board.evidence.map((fact) => (
                <li key={fact.id} className="experiment">
                  <div>
                    <strong>{fact.description}</strong>{' '}
                    {fact.showsTransfer && <span className="tag">Enseñó a otros</span>}
                  </div>
                  <div className="muted">
                    {fact.occurredOn} · {fact.authorName}
                    {fact.link !== null && (
                      <>
                        {' · '}
                        <a href={fact.link} target="_blank" rel="noreferrer noopener">
                          {fact.link}
                        </a>
                      </>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}
          {board.viewer.canRecordEvidence && (
            <form
              className="stack"
              onSubmit={(event) => {
                event.preventDefault();
                void change(async () => {
                  await boardApi.recordEvidence(board.id, {
                    description,
                    occurredOn,
                    ...(link.trim() === '' ? {} : { link: link.trim() }),
                    showsTransfer,
                  });
                  setDescription('');
                  setLink('');
                  setShowsTransfer(false);
                });
              }}
            >
              <label>
                Hecho
                <textarea required maxLength={2000} value={description} onChange={(event) => setDescription(event.target.value)} />
              </label>
              <label>
                Fecha del hecho
                <input type="date" required value={occurredOn} onChange={(event) => setOccurredOn(event.target.value)} />
              </label>
              <label>
                Enlace (opcional)
                <input type="url" maxLength={2000} value={link} onChange={(event) => setLink(event.target.value)} />
              </label>
              <label className="checkbox-row">
                <input type="checkbox" checked={showsTransfer} onChange={(event) => setShowsTransfer(event.target.checked)} />
                Muestra que enseñó a otros
              </label>
              <div className="actions">
                <button type="submit">Registrar evidencia</button>
              </div>
            </form>
          )}
        </>
      )}
    </Section>
  );
}

/** Checkboxes to cite evidence of the board. */
function EvidencePicker(props: { evidence: Evidence[]; chosen: string[]; onChange: (chosen: string[]) => void }) {
  if (props.evidence.length === 0) return <p className="muted">Registra primero una evidencia para citarla.</p>;
  return (
    <fieldset>
      <legend>Evidencias que lo sustentan</legend>
      {props.evidence.map((fact) => (
        <label key={fact.id} className="checkbox-row">
          <input
            type="checkbox"
            checked={props.chosen.includes(fact.id)}
            onChange={(event) =>
              props.onChange(event.target.checked ? [...props.chosen, fact.id] : props.chosen.filter((id) => id !== fact.id))
            }
          />
          {fact.description}
        </label>
      ))}
    </fieldset>
  );
}

/** Approve or reject, with a note, for a panel member. `subject` names what is decided. */
function DecisionControls(props: { subject: string; onDecide: (approve: boolean, note: string) => Promise<boolean> }) {
  const [note, setNote] = useState('');
  return (
    <div className="stack">
      <label>
        Nota de la decisión
        <input
          maxLength={2000}
          value={note}
          aria-label={`Nota de la decisión sobre «${props.subject}»`}
          onChange={(event) => setNote(event.target.value)}
        />
      </label>
      <div className="actions">
        <button type="button" aria-label={`Aprobar «${props.subject}»`} onClick={() => void props.onDecide(true, note)}>
          Aprobar
        </button>
        <button
          type="button"
          className="secondary"
          aria-label={`Rechazar «${props.subject}»`}
          onClick={() => void props.onDecide(false, note)}
        >
          Rechazar
        </button>
      </div>
    </div>
  );
}

function LevelChangesSection({ board, onChanged }: { board: Board; onChanged: () => Promise<void> }) {
  const [capabilityId, setCapabilityId] = useState('');
  const [levelId, setLevelId] = useState('');
  const [evidenceIds, setEvidenceIds] = useState<string[]>([]);
  const statement = new Map(board.capabilities.map((capability) => [capability.id, capability.statement]));
  const levelName = (id: string) => {
    const level = board.levels.find((candidate) => candidate.id === id);
    return level ? `${level.position} · ${level.name}` : id;
  };
  const position = (id: string | null | undefined) => board.levels.find((level) => level.id === id)?.position;
  const placed = board.capabilities.filter((capability) =>
    board.placements.some((placement) => placement.capabilityId === capability.id && placement.levelId !== null),
  );
  const current = position(board.placements.find((placement) => placement.capabilityId === capabilityId)?.levelId);
  const targets = current === undefined ? [] : board.levels.filter((level) => level.position > current);

  return (
    <Section title="Cambios de nivel" onChanged={onChanged}>
      {(change) => (
        <>
          <p className="muted">Después de la línea base, un nivel sube solo con evidencia y la aprobación de alguien del panel.</p>
          {board.proposals.length > 0 && (
            <ul className="plain-list stack">
              {board.proposals.map((proposal) => (
                <li key={proposal.id} className="experiment stack">
                  <div>
                    <strong>
                      {statement.get(proposal.capabilityId) ?? proposal.capabilityId} → {levelName(proposal.proposedLevelId)}
                    </strong>{' '}
                    <span className="tag">{decisionStateLabels[proposal.state]}</span>
                  </div>
                  <div className="muted">
                    Evidencias: {proposal.evidenceIds.map((id) => board.evidence.find((fact) => fact.id === id)?.description ?? id).join('; ')}
                  </div>
                  {proposal.decisionNote !== '' && <div className="notes">Nota: {proposal.decisionNote}</div>}
                  {proposal.state === 'proposed' && board.viewer.canDecideProposals && (
                    <DecisionControls
                      subject={`${statement.get(proposal.capabilityId) ?? ''} → ${levelName(proposal.proposedLevelId)}`}
                      onDecide={(approve, note) => change(() => boardApi.decideLevel(board.id, proposal.id, approve, note))}
                    />
                  )}
                </li>
              ))}
            </ul>
          )}
          {board.viewer.canProposeChanges && (
            <form
              className="stack"
              onSubmit={(event) => {
                event.preventDefault();
                void change(() => boardApi.proposeLevel(board.id, { capabilityId, levelId, evidenceIds })).then((done) => {
                  if (done) setEvidenceIds([]);
                });
              }}
            >
              <h4>Proponer un cambio de nivel</h4>
              <label>
                Capacidad
                <select
                  required
                  value={capabilityId}
                  onChange={(event) => {
                    setCapabilityId(event.target.value);
                    setLevelId('');
                  }}
                >
                  <option value="" disabled>
                    Elige una capacidad
                  </option>
                  {placed.map((capability) => (
                    <option key={capability.id} value={capability.id}>
                      {capability.statement}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Nivel propuesto
                <select required value={levelId} onChange={(event) => setLevelId(event.target.value)}>
                  <option value="" disabled>
                    Elige un nivel
                  </option>
                  {targets.map((level) => (
                    <option key={level.id} value={level.id}>
                      {level.position} · {level.name}
                      {level.requiresTransfer ? ' (exige haber enseñado)' : ''}
                    </option>
                  ))}
                </select>
              </label>
              <EvidencePicker evidence={board.evidence} chosen={evidenceIds} onChange={setEvidenceIds} />
              <div className="actions">
                <button type="submit">Proponer cambio</button>
              </div>
            </form>
          )}
        </>
      )}
    </Section>
  );
}

function BonusesSection({ board, onChanged }: { board: Board; onChanged: () => Promise<void> }) {
  const [capabilityId, setCapabilityId] = useState('');
  const [bonusRuleId, setBonusRuleId] = useState('');
  const [evidenceIds, setEvidenceIds] = useState<string[]>([]);
  const statement = new Map(board.capabilities.map((capability) => [capability.id, capability.statement]));
  const ruleName = new Map(board.bonusRules.map((rule) => [rule.id, rule.name]));
  const onBoard = board.capabilities.filter((capability) => board.placements.some((placement) => placement.capabilityId === capability.id));
  if (board.bonusRules.length === 0) return null;

  return (
    <Section title="Bonificaciones" onChanged={onChanged}>
      {(change) => (
        <>
          <ul className="plain-list">
            {board.bonusRules.map((rule) => (
              <li key={rule.id} className="muted">
                {rule.name} (+{rule.extraPoints}): {rule.condition}
              </li>
            ))}
          </ul>
          {board.bonuses.length > 0 && (
            <ul className="plain-list stack">
              {board.bonuses.map((bonus) => (
                <li key={bonus.id} className="experiment stack">
                  <div>
                    <strong>
                      {ruleName.get(bonus.bonusRuleId) ?? bonus.bonusRuleId} · {statement.get(bonus.capabilityId) ?? bonus.capabilityId}
                    </strong>{' '}
                    <span className="tag">{decisionStateLabels[bonus.state]}</span>
                  </div>
                  {bonus.decisionNote !== '' && <div className="notes">Nota: {bonus.decisionNote}</div>}
                  {bonus.state === 'proposed' && board.viewer.canDecideProposals && (
                    <DecisionControls
                      subject={`${ruleName.get(bonus.bonusRuleId) ?? ''} · ${statement.get(bonus.capabilityId) ?? ''}`}
                      onDecide={(approve, note) => change(() => boardApi.decideBonus(board.id, bonus.id, approve, note))}
                    />
                  )}
                </li>
              ))}
            </ul>
          )}
          {board.viewer.canProposeChanges && (
            <form
              className="stack"
              onSubmit={(event) => {
                event.preventDefault();
                void change(() => boardApi.proposeBonus(board.id, { capabilityId, bonusRuleId, evidenceIds })).then((done) => {
                  if (done) setEvidenceIds([]);
                });
              }}
            >
              <h4>Proponer una bonificación</h4>
              <label>
                Capacidad
                <select required value={capabilityId} onChange={(event) => setCapabilityId(event.target.value)}>
                  <option value="" disabled>
                    Elige una capacidad
                  </option>
                  {onBoard.map((capability) => (
                    <option key={capability.id} value={capability.id}>
                      {capability.statement}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Regla
                <select required value={bonusRuleId} onChange={(event) => setBonusRuleId(event.target.value)}>
                  <option value="" disabled>
                    Elige una regla
                  </option>
                  {board.bonusRules.map((rule) => (
                    <option key={rule.id} value={rule.id}>
                      {rule.name}
                    </option>
                  ))}
                </select>
              </label>
              <EvidencePicker evidence={board.evidence} chosen={evidenceIds} onChange={setEvidenceIds} />
              <div className="actions">
                <button type="submit">Proponer bonificación</button>
              </div>
            </form>
          )}
        </>
      )}
    </Section>
  );
}

function MentoringSection({ board, onChanged }: { board: Board; onChanged: () => Promise<void> }) {
  const [heldOn, setHeldOn] = useState(today);
  const [notes, setNotes] = useState('');
  const [experimentIds, setExperimentIds] = useState<string[]>([]);
  const experiments = board.cycle?.focuses.flatMap((focus) => focus.experiments) ?? [];
  const described = new Map(experiments.map((experiment) => [experiment.id, experiment.description]));

  return (
    <Section title="Mentorías" onChanged={onChanged}>
      {(change) => (
        <>
          {board.mentoringSessions.length === 0 ? (
            <p className="muted">Todavía no hay sesiones de mentoría registradas.</p>
          ) : (
            <ul className="plain-list stack">
              {board.mentoringSessions.map((session) => (
                <li key={session.id} className="experiment">
                  <div>
                    <strong>{session.heldOn}</strong> <span className="muted">· {session.recordedByName}</span>
                  </div>
                  {session.notes !== '' && <div className="notes">{session.notes}</div>}
                  {session.experimentIds.length > 0 && (
                    <div className="muted">Revisó: {session.experimentIds.map((id) => described.get(id) ?? 'experimento de otro ciclo').join('; ')}</div>
                  )}
                </li>
              ))}
            </ul>
          )}
          {board.viewer.canRecordMentoring && (
            <form
              className="stack"
              onSubmit={(event) => {
                event.preventDefault();
                void change(() => boardApi.recordMentoring(board.id, { heldOn, notes, experimentIds })).then((done) => {
                  if (done) {
                    setNotes('');
                    setExperimentIds([]);
                  }
                });
              }}
            >
              <h4>Registrar una sesión</h4>
              <label>
                Fecha de la sesión
                <input type="date" required value={heldOn} onChange={(event) => setHeldOn(event.target.value)} />
              </label>
              <label>
                Notas
                <textarea maxLength={5000} value={notes} onChange={(event) => setNotes(event.target.value)} />
              </label>
              {experiments.length > 0 && (
                <fieldset>
                  <legend>Experimentos revisados</legend>
                  {experiments.map((experiment) => (
                    <label key={experiment.id} className="checkbox-row">
                      <input
                        type="checkbox"
                        checked={experimentIds.includes(experiment.id)}
                        onChange={(event) =>
                          setExperimentIds(
                            event.target.checked ? [...experimentIds, experiment.id] : experimentIds.filter((id) => id !== experiment.id),
                          )
                        }
                      />
                      {experiment.description}
                    </label>
                  ))}
                </fieldset>
              )}
              <div className="actions">
                <button type="submit">Registrar mentoría</button>
              </div>
            </form>
          )}
        </>
      )}
    </Section>
  );
}
