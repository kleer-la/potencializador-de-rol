import { ENROLLMENT_ROLES, PANEL_ROLES, type EnrollmentRole, type PanelRole } from '@potencializador/domain';
import { useEffect, useId, useMemo, useState, type FormEvent } from 'react';
import {
  ApiError,
  organizationApi,
  programApi,
  type CapabilityMap,
  type Enrollment,
  type Program,
  type ProgramDetail,
  type ProgramInput,
  type ProgramSettings,
} from '../api/client.ts';
import { ConfirmAction } from '../components/ConfirmAction.tsx';
import { boardStatusLabels, enrollmentRoleLabels, messages, programErrors } from '../copy.ts';

type Props = { organizationId: string; canAdminister: boolean; canDesign: boolean };

const errorText = (failure: unknown) =>
  (failure instanceof ApiError && programErrors[failure.code]) || messages.requestFailed;

/** Programs of an organization: administrators create them and enroll people; map designers choose the base selection. */
export function ProgramsSection({ organizationId, canAdminister, canDesign }: Props) {
  const programs = useMemo(() => programApi(organizationId), [organizationId]);
  const [list, setList] = useState<Program[] | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = () =>
    programs
      .list()
      .then(setList)
      .catch(() => setError(messages.requestFailed));

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reload when the organization changes
  }, [programs]);

  if (list === null) return error ? <p role="alert">{error}</p> : <p>{messages.loading}</p>;
  return (
    <div className="columns">
      <section className="panel">
        <h3>Programas</h3>
        {list.length === 0 ? (
          <p className="muted">Todavía no hay programas.</p>
        ) : (
          <ul className="plain-list">
            {list.map((program) => (
              <li key={program.id}>
                <button
                  type="button"
                  className="link-button"
                  aria-pressed={program.id === selectedId}
                  onClick={() => setSelectedId(program.id)}
                >
                  {program.name}
                </button>
              </li>
            ))}
          </ul>
        )}
        {canAdminister && (
          <CreateProgramForm
            organizationId={organizationId}
            onCreate={async (input) => {
              const created = await programs.create(input);
              await load();
              setSelectedId(created.id);
            }}
          />
        )}
      </section>
      {selectedId !== null && (
        <section className="panel wide">
          <ProgramDetailView
            key={selectedId}
            organizationId={organizationId}
            programId={selectedId}
            canAdminister={canAdminister}
            canDesign={canDesign}
          />
        </section>
      )}
    </div>
  );
}

const NEW_PROGRAM: ProgramInput = {
  name: '',
  mapId: '',
  startsOn: '',
  endsOn: '',
  maxFocuses: 3,
  mandatoryPanelRoles: [...PANEL_ROLES],
};

/** Name, dates, maximum of focuses and mandatory panel roles: at least one role stays mandatory. */
function SettingsFields(props: { value: ProgramSettings; onChange: (value: ProgramSettings) => void }) {
  const { value, onChange } = props;
  const toggle = (role: PanelRole, checked: boolean) =>
    onChange({
      ...value,
      // Kept in the panel's order.
      mandatoryPanelRoles: PANEL_ROLES.filter((candidate) =>
        candidate === role ? checked : value.mandatoryPanelRoles.includes(candidate),
      ),
    });
  return (
    <>
      <label>
        Nombre del programa
        <input value={value.name} onChange={(event) => onChange({ ...value, name: event.target.value })} maxLength={160} required />
      </label>
      <label>
        Inicio
        <input type="date" value={value.startsOn} onChange={(event) => onChange({ ...value, startsOn: event.target.value })} required />
      </label>
      <label>
        Fin
        <input
          type="date"
          value={value.endsOn}
          min={value.startsOn || undefined}
          onChange={(event) => onChange({ ...value, endsOn: event.target.value })}
          required
        />
      </label>
      <label>
        Máximo de focos por ciclo
        <input
          type="number"
          min={1}
          max={20}
          // 0 means the field was emptied while typing: show it empty, not "0".
          value={value.maxFocuses === 0 ? '' : value.maxFocuses}
          onChange={(event) => onChange({ ...value, maxFocuses: Number(event.target.value) })}
          required
        />
      </label>
      <fieldset>
        <legend>Roles obligatorios del panel</legend>
        {PANEL_ROLES.map((role) => {
          const checked = value.mandatoryPanelRoles.includes(role);
          return (
            <label key={role} className="checkbox-row">
              <input
                type="checkbox"
                checked={checked}
                disabled={checked && value.mandatoryPanelRoles.length === 1}
                onChange={(event) => toggle(role, event.target.checked)}
              />
              {enrollmentRoleLabels[role]}
            </label>
          );
        })}
        <p className="muted">Al menos un rol del panel es obligatorio.</p>
      </fieldset>
    </>
  );
}

function CreateProgramForm(props: { organizationId: string; onCreate: (input: ProgramInput) => Promise<void> }) {
  const organization = useMemo(() => organizationApi(props.organizationId), [props.organizationId]);
  const [maps, setMaps] = useState<{ id: string; label: string }[]>([]);
  const [form, setForm] = useState<ProgramInput>(NEW_PROGRAM);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let current = true;
    (async () => {
      const roles = await organization.roles();
      const options: { id: string; label: string }[] = [];
      for (const role of roles) {
        for (const version of await organization.versions(role.id)) {
          if (version.status === 'published') options.push({ id: version.id, label: `${role.name} · versión ${version.version}` });
        }
      }
      if (current) setMaps(options);
    })().catch(() => current && setError(messages.requestFailed));
    return () => {
      current = false;
    };
  }, [organization]);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setError(null);
    try {
      await props.onCreate(form);
      setForm(NEW_PROGRAM);
    } catch (failure) {
      setError(errorText(failure));
    }
  };

  return (
    <form className="inline-form" onSubmit={submit}>
      <h4>Nuevo programa</h4>
      <label>
        Mapa
        <select value={form.mapId} onChange={(event) => setForm({ ...form, mapId: event.target.value })} required>
          <option value="">Elige una versión publicada</option>
          {maps.map((map) => (
            <option key={map.id} value={map.id}>
              {map.label}
            </option>
          ))}
        </select>
      </label>
      <SettingsFields value={form} onChange={(settings) => setForm({ ...form, ...settings })} />
      <button type="submit" className="primary">
        Crear programa
      </button>
      {error !== null && <p role="alert">{error}</p>}
    </form>
  );
}

function ProgramDetailView(props: { organizationId: string; programId: string; canAdminister: boolean; canDesign: boolean }) {
  const programs = useMemo(() => programApi(props.organizationId), [props.organizationId]);
  const organization = useMemo(() => organizationApi(props.organizationId), [props.organizationId]);
  const [detail, setDetail] = useState<ProgramDetail | null>(null);
  const [map, setMap] = useState<CapabilityMap | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    const loaded = await programs.detail(props.programId);
    setDetail(loaded);
    return loaded;
  };

  useEffect(() => {
    let current = true;
    load()
      .then((loaded) => organization.map(loaded.program.mapId))
      .then((loaded) => current && setMap(loaded))
      .catch(() => current && setError(messages.requestFailed));
    return () => {
      current = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reload when the program changes
  }, [props.programId]);

  const run = async (work: () => Promise<unknown>) => {
    setError(null);
    try {
      await work();
      await load();
    } catch (failure) {
      setError(errorText(failure));
      throw failure;
    }
  };
  const quietly = (work: () => Promise<unknown>) => run(work).catch(() => undefined);

  if (detail === null) return error ? <p role="alert">{error}</p> : <p>{messages.loading}</p>;
  const { program } = detail;
  const participants = detail.enrollments.filter((enrollment) => enrollment.role === 'participant');

  return (
    <div className="stack">
      <header>
        <h3>{program.name}</h3>
        <p className="muted">
          Del {program.startsOn} al {program.endsOn} · hasta {program.maxFocuses} focos por ciclo
        </p>
      </header>
      {error !== null && (
        <p role="alert" className="alert">
          {error}
        </p>
      )}

      {props.canAdminister && (
        <SettingsForm
          program={program}
          onSave={(settings) => run(() => programs.update(program.id, settings))}
        />
      )}

      {map !== null && (
        <SelectionEditor
          map={map}
          selection={detail.selection}
          canDesign={props.canDesign}
          onSave={(capabilityIds) => run(() => programs.setSelection(program.id, capabilityIds))}
        />
      )}

      <section>
        <h4>Personas inscritas</h4>
        <table aria-label="Personas inscritas">
          <thead>
            <tr>
              <th scope="col">Nombre</th>
              <th scope="col">Correo</th>
              <th scope="col">Rol</th>
              <th scope="col">Tablero</th>
              {props.canAdminister && <th scope="col" />}
            </tr>
          </thead>
          <tbody>
            {detail.enrollments.map((enrollment) => {
              const board = detail.boards.find((candidate) => candidate.enrollmentId === enrollment.id);
              return (
                <tr key={enrollment.id}>
                  <td>
                    {enrollment.name} {enrollment.isFirmPerson && <span className="tag objective">Kleer</span>}
                  </td>
                  <td>{enrollment.email}</td>
                  <td>{enrollmentRoleLabels[enrollment.role]}</td>
                  <td>{board ? boardStatusLabels[board.status] : ''}</td>
                  {props.canAdminister && (
                    <td>
                      <ConfirmAction
                        label="Quitar"
                        accessibleLabel={`Quitar a ${enrollment.name} como ${enrollmentRoleLabels[enrollment.role]}`}
                        prompt={
                          enrollment.role === 'participant'
                            ? '¿Quitar a esta persona? Su tablero se elimina.'
                            : '¿Quitar a esta persona del programa?'
                        }
                        confirmLabel="Confirmar"
                        variant="quiet-danger"
                        onConfirm={() => quietly(() => programs.unenroll(program.id, enrollment.id))}
                      />
                    </td>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
        {props.canAdminister && (
          <EnrollForm onEnroll={(email, roles, name) => run(() => programs.enroll(program.id, email, roles, name))} />
        )}
      </section>

      {participants.map((participant) => (
        <PanelSection
          key={participant.id}
          participant={participant}
          detail={detail}
          canAdminister={props.canAdminister}
          onAssign={(memberEnrollmentId, role) =>
            run(() => programs.assign(program.id, { participantEnrollmentId: participant.id, memberEnrollmentId, role }))
          }
          onRemove={(memberEnrollmentId, role) =>
            quietly(() => programs.unassign(program.id, { participantEnrollmentId: participant.id, memberEnrollmentId, role }))
          }
        />
      ))}
    </div>
  );
}

function SettingsForm(props: { program: Program; onSave: (settings: ProgramSettings) => Promise<void> }) {
  const initial = (program: Program): ProgramSettings => ({
    name: program.name,
    startsOn: program.startsOn,
    endsOn: program.endsOn,
    maxFocuses: program.maxFocuses,
    mandatoryPanelRoles: program.mandatoryPanelRoles,
  });
  const [value, setValue] = useState(() => initial(props.program));
  // Reset only when the stored settings change (a save), not on every reload of the
  // program after an unrelated action, which would discard what is being typed.
  const stored = JSON.stringify(initial(props.program));
  // eslint-disable-next-line react-hooks/exhaustive-deps -- `stored` captures the settings
  useEffect(() => setValue(initial(props.program)), [stored]);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    props.onSave(value).catch(() => undefined);
  };

  return (
    <form onSubmit={submit}>
      <fieldset className="inline-form settings">
        <legend>Configuración del programa</legend>
        <SettingsFields value={value} onChange={setValue} />
        <button type="submit">Guardar configuración</button>
      </fieldset>
    </form>
  );
}

function SelectionEditor(props: {
  map: CapabilityMap;
  selection: string[];
  canDesign: boolean;
  onSave: (capabilityIds: string[]) => Promise<void>;
}) {
  const [chosen, setChosen] = useState(() => new Set(props.selection));
  useEffect(() => setChosen(new Set(props.selection)), [props.selection]);
  const ordered = props.map.dimensions.flatMap((dimension) => dimension.capabilities.map((capability) => capability.id));

  return (
    <fieldset className="selection">
      <legend>Selección base</legend>
      <p className="muted">
        Las capacidades con las que empieza cada tablero nuevo. {chosen.size} de {ordered.length} elegidas.
      </p>
      {props.map.dimensions.map((dimension) => (
        <div key={dimension.id} className="selection-group">
          <strong>{dimension.name}</strong>
          {dimension.capabilities.map((capability) => (
            <label key={capability.id} className="checkbox-row">
              <input
                type="checkbox"
                checked={chosen.has(capability.id)}
                disabled={!props.canDesign}
                onChange={(event) => {
                  const next = new Set(chosen);
                  if (event.target.checked) next.add(capability.id);
                  else next.delete(capability.id);
                  setChosen(next);
                }}
              />
              {capability.statement}
            </label>
          ))}
        </div>
      ))}
      {props.canDesign && (
        <button
          type="button"
          className="primary"
          onClick={() => props.onSave(ordered.filter((capabilityId) => chosen.has(capabilityId))).catch(() => undefined)}
        >
          Guardar selección
        </button>
      )}
    </fieldset>
  );
}

function EnrollForm({
  onEnroll,
}: {
  onEnroll: (email: string, roles: EnrollmentRole[], name?: string) => Promise<void>;
}) {
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [roles, setRoles] = useState<EnrollmentRole[]>([]);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    try {
      await onEnroll(email, roles, name.trim() === '' ? undefined : name.trim());
      setEmail('');
      setName('');
      setRoles([]);
    } catch {
      // The program view shows the refusal; what was typed stays.
    }
  };

  return (
    <form className="inline-form" onSubmit={submit}>
      <h4>Inscribir</h4>
      <p className="muted">Si la persona todavía no está en la organización, escribe su nombre: se la invita y se inscribe a la vez.</p>
      <label>
        Correo de la persona
        <input type="email" value={email} onChange={(event) => setEmail(event.target.value)} required />
      </label>
      <label>
        Nombre (si es nueva)
        <input value={name} maxLength={120} onChange={(event) => setName(event.target.value)} />
      </label>
      <fieldset>
        <legend>Roles en el programa</legend>
        {ENROLLMENT_ROLES.map((role) => (
          <label key={role} className="checkbox-row">
            <input
              type="checkbox"
              checked={roles.includes(role)}
              onChange={(event) =>
                setRoles(event.target.checked ? [...roles, role] : roles.filter((candidate) => candidate !== role))
              }
            />
            {enrollmentRoleLabels[role]}
          </label>
        ))}
      </fieldset>
      <button type="submit" disabled={roles.length === 0}>
        Inscribir
      </button>
    </form>
  );
}

function PanelSection(props: {
  participant: Enrollment;
  detail: ProgramDetail;
  canAdminister: boolean;
  onAssign: (memberEnrollmentId: string, role: PanelRole) => Promise<void>;
  onRemove: (memberEnrollmentId: string, role: PanelRole) => void;
}) {
  const headingId = useId();
  const [choice, setChoice] = useState('');
  const byId = new Map(props.detail.enrollments.map((enrollment) => [enrollment.id, enrollment]));
  const members = props.detail.panels.filter((panel) => panel.participantEnrollmentId === props.participant.id);
  const missing = props.detail.missingPanelRoles[props.participant.id] ?? [];
  const candidates = props.detail.enrollments.filter(
    (enrollment) =>
      (PANEL_ROLES as readonly string[]).includes(enrollment.role) &&
      enrollment.personId !== props.participant.personId &&
      !members.some((member) => member.memberEnrollmentId === enrollment.id),
  );

  return (
    <section className="panel-group" aria-labelledby={headingId}>
      <h4 id={headingId}>Panel de {props.participant.name}</h4>
      {members.length === 0 ? (
        <p className="muted">Sin integrantes todavía.</p>
      ) : (
        <ul className="plain-list">
          {members.map((member) => (
            <li key={`${member.memberEnrollmentId}-${member.role}`} className="board-item">
              <span>
                <strong>{byId.get(member.memberEnrollmentId)?.name}</strong>{' '}
                <span className="muted">{enrollmentRoleLabels[member.role]}</span>
              </span>
              {props.canAdminister && (
                <ConfirmAction
                  label="Quitar"
                  accessibleLabel={`Quitar a ${byId.get(member.memberEnrollmentId)?.name} del panel`}
                  prompt="¿Quitar a esta persona del panel?"
                  confirmLabel="Confirmar"
                  variant="quiet-danger"
                  onConfirm={() => props.onRemove(member.memberEnrollmentId, member.role)}
                />
              )}
            </li>
          ))}
        </ul>
      )}
      {missing.length > 0 && <p className="muted">Faltan: {missing.map((role) => enrollmentRoleLabels[role]).join(', ')}</p>}
      {props.canAdminister && candidates.length > 0 && (
        <div className="actions">
          <label className="file-input">
            Agregar al panel
            <select value={choice} onChange={(event) => setChoice(event.target.value)}>
              <option value="">Elige una persona</option>
              {candidates.map((candidate) => (
                <option key={candidate.id} value={candidate.id}>
                  {candidate.name} · {enrollmentRoleLabels[candidate.role]}
                </option>
              ))}
            </select>
          </label>
          <button
            type="button"
            disabled={choice === ''}
            onClick={() => {
              const member = byId.get(choice);
              if (member === undefined) return;
              props
                .onAssign(member.id, member.role as PanelRole)
                .then(() => setChoice(''))
                .catch(() => undefined);
            }}
          >
            Asignar
          </button>
        </div>
      )}
    </section>
  );
}
