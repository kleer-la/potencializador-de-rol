/** SQL states the API translates into answers. */
export const UNIQUE_VIOLATION = '23505';
/** Raised by the invariant 10 guard of migration 0003. */
export const INVARIANT_10_VIOLATION = 'PM010';

/** Drizzle wraps the driver error; the PostgreSQL code is somewhere in the cause chain. */
export function postgresCode(error: unknown): string | undefined {
  for (let current = error; current instanceof Error; current = current.cause) {
    const code = (current as { code?: unknown }).code;
    if (typeof code === 'string') return code;
  }
  return undefined;
}

/** Name of the violated constraint, when the error carries one. */
export function postgresConstraint(error: unknown): string | undefined {
  for (let current = error; current instanceof Error; current = current.cause) {
    const constraint = (current as { constraint?: unknown }).constraint;
    if (typeof constraint === 'string') return constraint;
  }
  return undefined;
}
