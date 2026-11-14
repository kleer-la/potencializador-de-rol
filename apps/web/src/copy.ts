import type {
  Difficulty,
  DimensionKind,
  EnrollmentRole,
  MapStatus,
  MembershipRole,
  PublishObstacle,
} from '@potencializador/domain';
import type { BoardStatus } from './api/client.ts';
import type { ProviderId } from './api/client.ts';

// Interface text. Domain terms follow the glossary of the conceptual base (section 3).

export const providerLabels: Record<ProviderId, string> = {
  google: 'Continuar con Google',
  microsoft: 'Continuar con Microsoft',
};

export const roleLabels: Record<MembershipRole, string> = {
  administrator: 'Administrador',
  map_designer: 'Diseñador del mapa',
};

/** Messages for the `error` value the sign-in callback leaves in the address. */
export const signInErrors: Record<string, string> = {
  not_invited: 'Tu cuenta no tiene acceso. Pide una invitación a quien administra tu organización.',
  sign_in_failed: 'No se pudo iniciar sesión. Inténtalo de nuevo.',
};

/** Messages for the `error` code of a refused password registration, confirmation or sign-in. */
export const passwordErrors: Record<string, string> = {
  invalid_credentials: 'El correo o la contraseña no son correctos.',
  too_many_attempts: 'Demasiados intentos fallidos. Espera 15 minutos e inténtalo de nuevo.',
  invalid_password: 'La contraseña debe tener entre 10 y 128 caracteres.',
  invalid_request: 'Revisa el correo escrito.',
  confirmation_failed: 'El enlace venció o ya se usó. Pide uno nuevo en «Crear contraseña».',
};

export const passwordMessages = {
  linkSent:
    'Si tu correo tiene una invitación, te enviamos un enlace para crear tu contraseña. Revisa tu bandeja de entrada.',
  confirmIntro: 'Elige tu contraseña para terminar de confirmar tu correo.',
};

export const messages = {
  loading: 'Cargando…',
  unavailable: 'El servicio no está disponible. Inténtalo más tarde.',
  noProviders: 'El inicio de sesión no está configurado todavía.',
  invitationNotPossible: 'No se pudo invitar ese correo. Si crees que es un error, contacta a soporte.',
  requestFailed: 'No se pudo completar la operación. Inténtalo de nuevo.',
  noOrganizations: 'Todavía no hay organizaciones.',
  noRoles: 'Sin roles',
};

export const statusLabels: Record<MapStatus, string> = {
  draft: 'Borrador',
  published: 'Publicado',
  archived: 'Archivado',
};

export const kindLabels: Record<DimensionKind, string> = {
  work_cycle: 'Ciclo de trabajo',
  transversal: 'Transversal',
};

export const difficultyLabels: Record<Difficulty, string> = {
  low: 'Baja',
  medium: 'Media',
  high: 'Alta',
};

export function obstacleText(obstacle: PublishObstacle): string {
  switch (obstacle.kind) {
    case 'no_levels':
      return 'Falta la escala de madurez.';
    case 'no_dimensions':
      return 'El mapa no tiene dimensiones.';
    case 'dimension_without_capabilities':
      return `La dimensión «${obstacle.dimension}» no tiene capacidades.`;
  }
}

/** Messages for the `error` code of a refused map or catalog change. */
export const mapErrors: Record<string, string> = {
  map_frozen: 'Esta versión ya no admite ese cambio. Crea una versión nueva para hacerlo.',
  invalid_transition: 'La versión no puede pasar a ese estado.',
  draft_exists: 'Este rol ya tiene un borrador.',
  name_taken: 'Ya existe un elemento con ese nombre.',
  unknown_reference: 'Una herramienta u objetivo ya no está en el catálogo.',
  in_use: 'No se puede eliminar: alguna capacidad de un mapa la usa.',
  invalid_request: 'Revisa los datos: hay un valor que no es válido.',
};

export const confirmations = {
  publish: '¿Publicar esta versión? Después solo se podrán agregar dimensiones y capacidades.',
  archive: '¿Archivar esta versión? Después no admitirá ningún cambio.',
  discard: '¿Descartar este borrador? Se pierde todo su contenido.',
};

/** Why a frozen version shows no edit controls (invariant 10). */
export const frozenNotices = {
  published: 'Versión publicada: solo admite agregar dimensiones y capacidades. Para cambiar lo existente, crea una versión nueva.',
  archived: 'Versión archivada: no admite cambios.',
} as const;

export const enrollmentRoleLabels: Record<EnrollmentRole, string> = {
  participant: 'Participante',
  leader: 'Líder',
  specialist: 'Especialista',
  mentor: 'Mentor',
};

export const boardStatusLabels: Record<BoardStatus, string> = {
  not_started: 'Sin iniciar',
  self_assessed: 'Autoevaluado',
  calibrated: 'Calibrado',
  in_cycle: 'En ciclo',
  between_cycles: 'Entre ciclos',
  closed: 'Cerrado',
};

export const cycleStateLabels = { planned: 'Planeado', active: 'Activo', closed: 'Cerrado' } as const;
export const experimentStateLabels = { planned: 'Planteado', in_progress: 'En curso', reviewed: 'Revisado' } as const;
export const experimentResultLabels = {
  consolidated: 'Consolidó',
  not_consolidated: 'No consolidó',
  discarded: 'Descartado',
} as const;

/** Messages for the `error` code of a refused cycle, focus or experiment change. */
export const cycleErrors: Record<string, string> = {
  no_baseline: 'El ciclo empieza después de fijar la línea base.',
  cycle_open: 'Ya hay un ciclo abierto en este tablero.',
  board_closed: 'Este tablero está cerrado.',
  invalid_target: 'El nivel objetivo debe estar por encima del nivel actual de la capacidad.',
  already_focus: 'Esa capacidad ya es un foco de este ciclo.',
  too_many_focuses: 'El ciclo ya tiene el máximo de focos del programa.',
  cycle_not_planned: 'Los focos solo cambian mientras el ciclo está planeado.',
  cycle_closed: 'El ciclo está cerrado.',
  board_not_ready: 'El tablero no está en un estado que permita iniciar un ciclo.',
  cycle_changed: 'El ciclo cambió mientras se iniciaba. Vuelve a abrir el tablero.',
  invalid_transition: 'Ese experimento no puede pasar a ese estado.',
  invalid_request: 'Revisa los datos: hay un valor que no es válido.',
};

export const decisionStateLabels = { proposed: 'Propuesto', approved: 'Aprobado', rejected: 'Rechazado' } as const;

export const evolutionKindLabels = {
  baseline: 'Línea base',
  cycle_close: 'Cierre de ciclo',
  recalibration: 'Recalibración',
  today: 'Hoy',
} as const;

/** Messages for the `error` code of refused closings and recalibrations. */
export const closingErrors: Record<string, string> = {
  cycle_not_active: 'Ese ciclo ya no está activo.',
  not_between_cycles: 'La recalibración se hace entre ciclos.',
  already_recalibrated: 'Ya hubo una recalibración después del último ciclo.',
  panel_changed: 'El panel cambió mientras se registraba. Vuelve a abrir el tablero.',
  cycle_open: 'Cierra o quita el ciclo abierto antes de cerrar el tablero.',
  board_closed: 'El tablero está cerrado y ya no admite cambios.',
  unknown_reference: 'Hay un asistente, una capacidad o un nivel que no corresponde a este tablero.',
  invalid_request: 'Revisa los datos: hay un valor que no es válido.',
};

/** Why a level change proposal does not stand, by problem code. */
export const proposalProblemLabels: Record<string, string> = {
  unplaced: 'La capacidad todavía no tiene nivel.',
  not_above: 'El nivel propuesto debe estar por encima del actual.',
  no_evidence: 'Elige al menos una evidencia.',
  no_transfer_evidence: 'Ese nivel exige una evidencia de haber enseñado a otros.',
};

/** Messages for the `error` code of refused evidence, proposals, bonuses and sessions. */
export const evidenceErrors: Record<string, string> = {
  no_baseline: 'Las evidencias y los cambios de nivel empiezan después de la línea base.',
  unknown_reference: 'Hay una evidencia, capacidad o experimento que no es de este tablero.',
  proposal_open: 'Esa capacidad ya tiene un cambio de nivel propuesto.',
  board_changed: 'El tablero cambió mientras se proponía. Vuelve a abrirlo.',
  already_decided: 'Ya se decidió.',
  no_longer_above: 'El nivel propuesto ya no está por encima del actual.',
  already_awarded: 'Esa bonificación ya está propuesta o aprobada para esa capacidad.',
  evidence_cited: 'Esa evidencia ya sustenta una propuesta y no se puede borrar.',
  invalid_request: 'Revisa los datos: hay un valor que no es válido.',
};

/** Messages for the `error` code of a refused calibration or initial level. */
export const calibrationErrors: Record<string, string> = {
  baseline_set: 'El tablero ya tiene línea base: la calibración no se repite.',
  not_self_assessed: 'La calibración empieza cuando el participante envía su autoevaluación.',
  no_baseline: 'Antes de la línea base, los niveles se acuerdan en la calibración.',
  already_leveled: 'Esa capacidad ya tiene su nivel inicial en la línea base.',
  panel_changed: 'El panel del participante cambió mientras se registraba la calibración. Vuelve a abrir el tablero y revisa los asistentes.',
  unknown_reference: 'Hay un asistente, una capacidad o un nivel que no corresponde a este tablero.',
  invalid_request: 'Revisa los datos: hay un valor que no es válido.',
};

/** Messages for the `error` code of a refused program or board change. */
export const programErrors: Record<string, string> = {
  map_not_published: 'Solo se puede usar una versión publicada del mapa.',
  person_not_found: 'Ese correo no corresponde a una persona de la organización ni de Kleer. Escribe su nombre para invitarla e inscribirla.',
  invitation_not_possible: 'No se pudo invitar ese correo. Si crees que es un error, contacta a soporte.',
  firm_person_cannot_participate: 'Una persona de Kleer puede acompañar, pero no participar.',
  invalid_panel: 'Esa persona no está inscrita en el programa con ese rol.',
  baseline_set: 'El tablero ya tiene línea base: no se le pueden quitar capacidades.',
  already_on_board: 'Esa capacidad ya está en el tablero.',
  unknown_reference: 'Esa capacidad no es del mapa del programa.',
  already_submitted: 'La autoevaluación ya fue enviada y no se puede cambiar.',
  board_not_open: 'Este tablero ya no admite autoevaluación.',
  empty_board: 'Este tablero no tiene capacidades para autoevaluar.',
  invalid_request: 'Revisa los datos: hay un valor que no es válido.',
};
