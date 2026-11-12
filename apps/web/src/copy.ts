import type { MembershipRole } from '@potencializador/domain';
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
  notAdministrator: 'No administras las personas de esta organización.',
  noOrganizations: 'Todavía no hay organizaciones.',
  noRoles: 'Sin roles',
};
