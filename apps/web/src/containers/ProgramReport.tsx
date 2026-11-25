import { Fragment, useId, useState } from 'react';
import { boardApi, type Board, type ProgramReport, type ProgramReportRow } from '../api/client.ts';
import { boardStatusLabels, cycleStateLabels, messages } from '../copy.ts';

const formatPoints = (value: number) => (Number.isInteger(value) ? String(value) : value.toFixed(2));
const signed = (value: number, text: string) => (value > 0 ? `+${text}` : value < 0 ? `−${text}` : text);

/** "+2 puntos (+50 %)", "Sin cambio (0 %)" or "Sin línea base". */
export function formatProgress(row: Pick<ProgramReportRow, 'change' | 'percent'>): string {
  if (row.change === null) return 'Sin línea base';
  const percent = row.percent === null ? '' : ` (${signed(row.percent, `${Math.round(Math.abs(row.percent))} %`)})`;
  if (row.change === 0) return `Sin cambio${percent}`;
  const points = Math.abs(row.change);
  return `${signed(row.change, formatPoints(points))} ${points === 1 ? 'punto' : 'puntos'}${percent}`;
}

/**
 * The progress report of a program for its leaders: each participant, by name, against
 * their own baseline. It never shows an absolute score nor orders people by it (invariant 9).
 */
export function ProgramReportView({ report, onBack }: { report: ProgramReport; onBack: () => void }) {
  const headingId = useId();
  return (
    <section className="panel stack" aria-labelledby={headingId}>
      <div className="actions">
        <button type="button" onClick={onBack}>
          Volver
        </button>
      </div>
      <h2 id={headingId}>Informe de progreso · {report.programName}</h2>
      <p className="muted">
        {report.organizationName} · Cada persona frente a su propia línea base. No compara personas entre sí.
      </p>
      {report.participants.length === 0 ? (
        <p className="muted">Ningún participante por ahora.</p>
      ) : (
        <table aria-label="Progreso de los participantes" className="program-report">
          <thead>
            <tr>
              <th scope="col">Participante</th>
              <th scope="col">Estado</th>
              <th scope="col">Ciclo actual</th>
              <th scope="col">Avance frente a su línea base</th>
              <th scope="col">Experimentos finalizados</th>
              <th scope="col">Experimentos en curso</th>
            </tr>
          </thead>
          <tbody>
            {report.participants.map((row) => (
              <ParticipantRows key={row.boardId} row={row} />
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}

/** The programs the person leads, each opening its report. */
export function ProgramReportList({ reports, onOpen }: { reports: ProgramReport[]; onOpen: (programId: string) => void }) {
  const headingId = useId();
  return (
    <section className="panel" aria-labelledby={headingId}>
      <h2 id={headingId}>Informe de mis programas</h2>
      <ul className="plain-list">
        {reports.map((report) => (
          <li key={report.programId} className="board-item">
            <div>
              <strong>{report.programName}</strong>
              <div className="muted">{report.organizationName}</div>
            </div>
            <span className="actions">
              <button
                type="button"
                aria-label={`Ver el informe de ${report.programName}`}
                onClick={() => onOpen(report.programId)}
              >
                Ver informe
              </button>
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}

/**
 * One participant as an expandable table row: its first cell opens or closes it; the open
 * row shows, right below, each capability of their board with its baseline and current level.
 */
function ParticipantRows({ row }: { row: ProgramReportRow }) {
  const detailId = useId();
  const [open, setOpen] = useState(false);
  const [board, setBoard] = useState<Board | null>(null);
  const [state, setState] = useState<'idle' | 'loading' | 'failed'>('idle');

  const load = () => {
    setState('loading');
    boardApi
      .board(row.boardId)
      .then((loaded) => {
        setBoard(loaded);
        setState('idle');
      })
      .catch(() => setState('failed'));
  };
  const toggle = () => {
    if (!open && board === null && state !== 'loading') load();
    setOpen(!open);
  };

  return (
    <Fragment>
      <tr>
        <th scope="row">
          <button
            type="button"
            className="report-toggle"
            aria-expanded={open}
            aria-controls={detailId}
            onClick={toggle}
          >
            {row.participantName}
          </button>
        </th>
        <td>{boardStatusLabels[row.status]}</td>
        <td>{row.cycle === null ? '—' : `Ciclo ${row.cycle.number} · ${cycleStateLabels[row.cycle.state]}`}</td>
        <td>{formatProgress(row)}</td>
        <td>{row.finishedExperiments}</td>
        <td>{row.experimentsInProgress}</td>
      </tr>
      {open && (
        <tr id={detailId} className="report-detail">
          <td colSpan={6}>
            {state === 'loading' && <p>{messages.loading}</p>}
            {state === 'failed' && (
              <p role="alert">
                {messages.requestFailed}{' '}
                <button type="button" onClick={load}>
                  Reintentar
                </button>
              </p>
            )}
            {board !== null && <CapabilitiesByDimension board={board} participantName={row.participantName} />}
          </td>
        </tr>
      )}
    </Fragment>
  );
}

/**
 * The capabilities on a board in one table, grouped by dimension in map order, each with
 * its baseline level and its current level, numbered by their position on the scale;
 * capabilities above their baseline are highlighted.
 */
function CapabilitiesByDimension({ board, participantName }: { board: Board; participantName: string }) {
  const levelById = new Map(board.levels.map((level) => [level.id, level]));
  const levelText = (levelId: string | null | undefined, none: string) => {
    const level = levelId === null || levelId === undefined ? undefined : levelById.get(levelId);
    return level === undefined ? none : `${level.position} · ${level.name}`;
  };
  const placed = new Map(board.placements.map((placement) => [placement.capabilityId, placement.levelId]));
  const baseline = new Map((board.baseline?.entries ?? []).map((entry) => [entry.capabilityId, entry.levelId]));
  /** Above its baseline level on the scale today. */
  const improved = (capabilityId: string) => {
    const before = levelById.get(baseline.get(capabilityId) ?? '');
    const now = levelById.get(placed.get(capabilityId) ?? '');
    return before !== undefined && now !== undefined && now.position > before.position;
  };
  const groups = [...board.dimensions]
    .sort((a, b) => a.position - b.position)
    .map((dimension) => ({
      dimension,
      capabilities: board.capabilities
        .filter((capability) => capability.dimensionId === dimension.id && placed.has(capability.id))
        .sort((a, b) => a.position - b.position),
    }))
    .filter((group) => group.capabilities.length > 0);
  if (groups.length === 0) return <p className="muted">Sin capacidades en el tablero.</p>;
  return (
    <table aria-label={`Capacidades de ${participantName}`} className="report-capabilities">
      <colgroup>
        <col />
        <col className="report-level" />
        <col className="report-level" />
      </colgroup>
      <thead>
        <tr>
          <th scope="col">Capacidad observable</th>
          <th scope="col">Línea base</th>
          <th scope="col">Estado actual</th>
        </tr>
      </thead>
      {groups.map(({ dimension, capabilities }) => (
        <tbody key={dimension.id}>
          <tr>
            <th scope="colgroup" colSpan={3} className="report-dimension">
              {dimension.name}
            </th>
          </tr>
          {capabilities.map((capability) => (
            <tr key={capability.id} className={improved(capability.id) ? 'report-improved' : undefined}>
              <td>{capability.statement}</td>
              <td>{levelText(baseline.get(capability.id), '—')}</td>
              <td>{levelText(placed.get(capability.id), 'Sin ubicar')}</td>
            </tr>
          ))}
        </tbody>
      ))}
    </table>
  );
}
