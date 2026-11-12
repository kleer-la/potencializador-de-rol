# Increment 0 — Skeleton: containers, sign-in, organizations, isolation

Objective: a dockerized web application where an invited person signs in with Google or Microsoft, a super administrator creates client organizations, and no data of one organization is visible from another.
Branch: `feat/increment-0-skeleton`. Delivery: work-unit commits on the branch; no remote exists, so merge is the user's decision and no pull request is planned.
Test runner: `npm test` (Vitest) at the repository root. Integration tests need a running Docker daemon (PostgreSQL through Testcontainers).

## Specs

S1. Containers and web. User: "Quiero que esté dockerizado y funcione en web".
- `docker compose up --build` starts `db`, `api` and `web`.
- `GET /api/health` through the `web` container answers `200` with `{"status":"ok"}` only when the API reaches the database.
- The web page loads in a browser at the published `web` port.

S2. Approved stack. User: "Apruebo el stack." Recorded in `docs/Potencializador de rol — Base conceptual del sistema.md` §9.2: "Monolito modular con arquitectura hexagonal, TypeScript de punta a punta: Fastify, Zod y Drizzle en la API; React y Vite en la web; PostgreSQL con aislamiento por organización; todo en contenedores con Docker Compose".
- Domain rules live in a package with no framework or database import.
- Identifiers in English, interface text in Spanish (document §3: "Estos términos deben usarse igual en conversaciones, interfaz y código").

S3. Isolation by organization. Document §5.1 invariant 11: "El sistema aloja varias organizaciones y ningún dato de una es visible desde otra. Los mapas plantilla son de la firma de mentores, no de las organizaciones cliente. La única excepción son las personas de la firma de mentores: son superadministradoras, crean las cuentas de las organizaciones cliente y pueden administrar dentro de ellas cuando se requiere por soporte."
- Every organization-owned table carries `organization_id` and a PostgreSQL Row Level Security policy.
- The API connects with a database role that is not the table owner and cannot bypass Row Level Security.
- Test `INV-11`: with two organizations in one database, a request scoped to organization A reads zero rows of organization B and cannot insert or update rows of organization B, at the database level and through the API.
- Test `INV-11`: a super administrator reads and administers both organizations.

S4. Sign-in. User: "método de autenticación me gustaría que diera la opción con cuentas de google o de microsoft" and "Sólo Google y Microsoft por el momento para delegar en ellos temas de autenticación."
- Sign-in only through Google or Microsoft (OpenID Connect). The system stores no passwords.
- Assumption: access is by invitation. A person signs in only if a `Person` with that verified email exists; otherwise the answer is a refusal and no account is created.
- Assumption: on first sign-in the provider account (provider + subject) is bound to the `Person`; later sign-ins match on that binding, not on email.
- `GET /api/me` returns the signed-in person, whether the person is super administrator, and the person's organization memberships; `401` without a session.
- Sign-out ends the session.

S5. Super administrator and memberships. User: "La persona de la firma es super administrador. Crea cuentas para organizaciones clientes y debería poder administrar dentro de ellas también si se requiere por soporte". User on organization-level roles: "Agrégala" (`OrganizationMembership`: administrator, map designer).
- A super administrator creates organizations and lists all of them.
- A super administrator or an administrator of the organization invites persons to it with a membership role (`administrator`, `map_designer`) and lists its members.
- A person who is neither gets `403` on those operations for that organization, and sees only the organizations where the person has a membership.
- Assumption: the first super administrators are created from the `SUPER_ADMIN_EMAILS` environment variable.

S6. Web interface (Spanish).
- Sign-in page with "Continuar con Google" and "Continuar con Microsoft".
- After sign-in: the person's name, organizations, and sign-out.
- Super administrator: create an organization. Super administrator or organization administrator: invite and list members.

S7. Automated coverage. User: "Las invariantes de la sección 5.1 deben quedar cubiertas por pruebas automatizadas."
- This increment covers invariant 11 only (S3). Each test title starts with `INV-11`.

## Tasks

- [x] T1 — Scaffold: npm workspaces, TypeScript, Vitest, API `/health`, web shell, Dockerfiles, Compose. Specs: S1, S2 (domain package deferred to T2, its first user). Route: inline. Risk: item 5 (dependencies, environment). Commit: `feat: scaffold dockerized api and web` (see L5).
- [x] T2 — Persistence and tenancy: schema (`organizations`, `persons`, `organization_memberships`), migrations, database roles, Row Level Security, scoped transaction, `INV-11` database tests. Specs: S3 (database level; API level is T4), S7. Route: inline. Risk: item 2 (security guard). Commit: `feat: isolate organizations with row level security` (see L8).
- [x] T3 — Sign-in: OpenID Connect port with Google and Microsoft adapters, sessions, invitation check, `/me`, sign-out. Specs: S4. Route: inline. Risk: item 2 (authentication). Commit: `feat: sign in with google or microsoft` (see L11). Not proven: a real sign-in round trip, which needs the user's provider credentials.
- [x] T4 — Organizations and memberships API with authorization, `INV-11` API tests, super administrator bootstrap, domain package. Specs: S2 (domain package), S3, S5, S7. Route: inline. Risk: item 2 (permissions). Commit: `feat: administer organizations and members` (see L13).
- [x] T5 — Web interface: sign-in, organizations, members. Specs: S6. Route: inline. Risk: none (new interface code over existing API; no shared code changed). Commit: `feat: web interface for sign-in, organizations and members` (see L15).

Route evidence: tasks depend on each other in sequence (T2 needs T1, T3 and T4 need T2, T5 needs T3 and T4), so no parallel writer applies; the parent writes inline.
Forecast: about 1,500 authored changed lines, generated files excluded. No remote and no pull requests, so slices are the five work-unit commits above.

## Log

L1 (2026-11-12, user, original request): "Sólo Google y Microsoft por el momento para delegar en ellos temas de autenticación.
Vamos con el siguiente paso. Decide cuándo usar Spec Driven Development porque quiero orden en este desarrollo, usa las capacidades de gentleman-ai para esto"

L2 (2026-11-12, context): "siguiente paso" is increment 0 of the plan the user approved earlier: "Esqueleto: compose, CI, autenticación, organizaciones, RLS", covering invariant 11. Continuous integration is left out of this increment because the repository has no remote; `npm test` is the single entry point a pipeline will call later.

L3 (2026-11-12, decision): installed gentle-ai 4.2.0 has no separate spec-driven command; its spec mechanism is this feature document (numbered specs, tasks, log) plus receipt-driven review, which is on (global). Rule adopted: every increment of the build plan gets a feature document before its first code; small corrections do not.

L4 (2026-11-12, environment): Node 22.22.3, npm 10.9.8, Docker 29.7.2, Compose 5.4.0. pnpm is not installed, so the monorepo uses npm workspaces.

L5 (2026-11-12, T1 evidence): RED observed (`app.test.ts` failed, `./app.ts` missing), then GREEN: `npm test` 2 passed; `npm run typecheck` clean. Compose probe on a throwaway project (`WEB_PORT=18080`): `GET /api/health` through `web` returned `200 {"status":"ok"}`; with `db` stopped `503 {"status":"unavailable"}`; with `db` restarted `200` again; page title served; API process runs as user `node`. Two defects found by the probe and fixed: the web image did not copy `tsconfig.base.json`; the API process exited when an idle database connection dropped (no `error` listener on the pool).

L6 (2026-11-12, limitation): writing `.env.example` is denied by the session permission settings, so the environment variables are documented in `README.md` instead.

L7 (2026-11-12, T1 review): native review of commit 7293f82 (lenses risk, resilience; consent granted by the user) ended `approved` and was acknowledged; no blocking finding. Four informational resilience findings were fixed in a follow-up commit: restart policy on the three services, a pool-wide `query_timeout`, per-request DNS resolution of the API upstream in nginx, and a guarded shutdown. Probe after the fix: health `200` after recreating the `api` container without restarting `web`, and `200` again after the API process exited (restart count 1).

L8 (2026-11-12, T2 evidence): RED observed (suite could not load: `migrate.ts`, `schema.ts`, `scoped-transaction.ts` missing), then GREEN: `npm test` 11 passed (9 titled `INV-11`), `npm run typecheck` clean. Mutation check on the migration: making `persons` readable by everyone failed 4 tests; deriving super administrator without the `organization_id IS NULL` condition failed 4 tests; both restored. Compose probe: `migrate` applied `0001_identity_and_organizations.sql`, a second run reported `no pending migrations`, the API connected as `potencializador_app`, 12 policies and Row Level Security enabled on the three tables, health `200`.

L9 (2026-11-12, T2 decisions):
- A person with `organization_id` null belongs to the mentoring firm and is super administrator (document §4.2). The database derives it from the stored person through `app_is_super_admin()`; the application cannot claim it with a setting.
- `app.organization_id` is trusted by the database: the application sets it only after authorizing the person for that organization (T4).
- SQL files are the source of truth for structure and policies; `schema.ts` is the typed view Drizzle queries use. A small runner applies them, so drizzle-kit is not a dependency.
- Row Level Security is enabled but not forced: the owner role runs migrations only, and `app_is_super_admin()` must read `persons` as owner.
- The domain package of S2 moves to T4, where the first domain rule (who may administer an organization) appears.
- `npm audit`: one moderate advisory (glob, through testcontainers → archiver). Development dependency only; it is not in the production images. Left as is: the offered fix downgrades testcontainers two majors.
- The follow-up commit ca60876 (24 lines) was assessed `under_budget`, so it carries no review of its own.

L10 (2026-11-12, T2 review): native review of commit e3c615e (lenses risk, reliability; consent granted by the user) ended `approved` and was acknowledged; no blocking finding. Informational findings and what was done in a follow-up commit:
- A scope of organization A could create a membership of A for a person of organization B. Fixed structurally: composite foreign key `(person_id, organization_id)` to `persons`; RED observed, then GREEN with a new `INV-11` test. Consequence: persons of the mentoring firm hold no memberships; they are super administrators.
- The migration runner had no tests. Added: name order, second run applies nothing, a failing file rolls back completely.
- The database setup ran for every test. Vitest now has two projects: `api` (needs Docker) and `unit` (does not).
- Read assertions depended on exact table contents of a shared database. They now assert ownership.
- Open for T4: the email is unique across organizations, so an invitation that repeats an email of another organization must answer without revealing that the email exists elsewhere.
Checks after the fix: `npm test` 14 passed, `npm run typecheck` clean.

L11 (2026-11-12, T3 evidence and decisions): RED observed (sign-in suites failed: routes and claim mapping missing), then GREEN: `npm test` 36 passed, `npm run typecheck` clean. Compose probe without credentials: both migrations applied, `/api/auth/providers` `{"providers":[]}`, `/api/me` `401`, unconfigured provider `404`, warning logged. Smoke test of the real adapter with placeholder credentials: discovery and authorization URL build for Google and for Microsoft `common` (PKCE, state and nonce present). Not proven: the token exchange with real credentials.
- Library: openid-client 6 (handles the Microsoft multi-tenant issuer).
- Microsoft's claims reference says the `email` claim "isn't guaranteed to be correct" and must never be used for authorization. So for Microsoft the email counts only with the optional claim `xms_edov` true; otherwise a first sign-in is refused. Whether `xms_edov` is emitted for the user's tenant must be checked with a real app registration.
- Identity key is issuer + subject. A person may have several provider accounts.
- `sessions` and `person_identities` are read before a person is known, so the API role has no privilege on them and uses four SECURITY DEFINER functions.
- Session: 32 random bytes in an HttpOnly, SameSite=Lax cookie (`Secure` when `PUBLIC_URL` is https); the database stores its SHA-256. Default lifetime 12 hours (assumption).
- State-changing requests whose `Origin` differs from `PUBLIC_URL` get `403`.

L12 (2026-11-12, T3 review): native review of commits beca264 and 5cf57e9 (lenses risk, reliability; consent granted by the user) ended `approved` and was acknowledged; no blocking finding. Fixed in a follow-up commit, each with RED then GREEN:
- Migration 0001 had been edited in place (the membership foreign key). No database had applied it outside throwaway test containers, so the edit stands; the runner now stores a checksum per file and refuses to run when an applied file changed.
- A session lookup that fails (database down) answered `500`; it now answers `503`, and `/api/health` no longer goes through the session lookup.
- A database failure in the sign-in callback now ends in the `sign_in_failed` redirect and clears the start cookie.
- Added the test for a provider that cannot be reached when sign-in starts.
- `PUBLIC_URL` is required by the API; Compose supplies the default, and the README now says so for local development.
Checks: `npm test` 41 passed, `npm run typecheck` clean.

L13 (2026-11-12, T4 evidence and decisions): RED observed (13 failing: domain policy and routes missing; then bootstrap module missing), then GREEN: `npm test` 63 passed (20 titled `INV-11`), `npm run typecheck` clean. Compose probe with `SUPER_ADMIN_EMAILS` holding two emails: both created as persons of the firm, lowercased; second run created none; `/api/organizations` without session `401`; the API image runs with the domain package.
- Authorization is decided by the domain policy (`packages/domain`, no framework import) before any transaction; Row Level Security stays as the second barrier.
- A member gets the same `403` for another organization and for one that does not exist. A super administrator gets `404` for one that does not exist.
- Inviting: creates the person in the organization when the email is new, adds the role when the person is already there, and is safe to repeat. An email that belongs elsewhere answers `409 invitation_not_possible` and changes nothing. Residual leak, accepted: the administrator can infer that the email exists somewhere in the system; avoiding it would need emails unique per organization, which breaks sign-in by email.
- `SUPER_ADMIN_EMAILS` never promotes a person of a client organization; it logs a count, not the emails.
- The members list returns every person of the organization, with or without roles.

L14 (2026-11-12, T4 review): native review of commits bc99526 and b124a96 (lenses risk, reliability; consent granted by the user) found one blocking defect: the migration runner failed on a database whose `schema_migrations` table was created before checksums existed (`column "checksum" does not exist`), so an existing Compose volume could not start. Corrected in commit ad2b099 (RED reproduced with that exact error, then GREEN): the column is added to an existing table and files applied earlier adopt their current checksum. The targeted validation passed; the review ended `approved` and was acknowledged.
Informational findings handled in a follow-up commit:
- Concurrent invitations of the same new email to one organization could answer a misleading `409`. The insert now ignores the conflict and looks the person up again; a new test sends four at once. RED was not observed separately for this test: it was written together with the fix.
- `SUPER_ADMIN_EMAILS` is validated before migrating.
- Not changed, accepted and recorded in L13: the invitation endpoint lets an administrator infer that an email exists somewhere in the system. No rate limit exists yet.
Checks: `npm test` 65 passed, `npm run typecheck` clean.

L15 (2026-11-12, T5 evidence and decisions): RED observed (11 interface tests failing against the shell), then GREEN: `npm test` 76 passed in 10 files, `npm run typecheck` clean. Compose probe through the `web` container with a session inserted for a super administrator: page, script and stylesheet served; `/api/me` reported super administrator; organization created; member invited (`201`) and listed; a request with another `Origin` got `403`; sign-out `204` and `/api/me` `401` afterwards.
- Presentational components in `apps/web/src/components`, containers in `apps/web/src/containers`, all interface text in `copy.ts`.
- The interface offers actions with the same domain policy the API enforces (`@potencializador/domain`); the API stays the authority.
- No router or data-fetching library yet: one screen, plain hooks. Revisit when the map editor arrives.
- Not proven: the interface in a real browser, and a real provider sign-in; both need the user's provider credentials.
