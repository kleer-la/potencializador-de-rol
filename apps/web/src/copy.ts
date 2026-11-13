import type { Difficulty, DimensionKind, MapStatus, MembershipRole, PublishObstacle } from '@potencializador/domain';
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
  invalid_request: 'Revisa los datos: hay un valor que no es válido.',
};

export const confirmations = {
  publish: '¿Publicar esta versión? Después solo se podrán agregar dimensiones y capacidades.',
  archive: '¿Archivar esta versión? Después no admitirá ningún cambio.',
  discard: '¿Descartar este borrador? Se pierde todo su contenido.',
};
