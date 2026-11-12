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
- [ ] T2 — Persistence and tenancy: schema (`organizations`, `persons`, `organization_memberships`), migrations, database roles, Row Level Security, scoped transaction, `INV-11` database tests. Specs: S3, S7. Route: inline. Risk: item 2 (security guard). Commit: —
- [ ] T3 — Sign-in: OpenID Connect port with Google and Microsoft adapters, sessions, invitation check, `/me`, sign-out. Specs: S4. Route: inline. Risk: item 2 (authentication). Commit: —
- [ ] T4 — Organizations and memberships API with authorization, `INV-11` API tests, super administrator bootstrap. Specs: S3, S5, S7. Route: inline. Risk: item 2 (permissions). Commit: —
- [ ] T5 — Web interface: sign-in, organizations, members. Specs: S6. Route: inline. Risk: none expected. Commit: —

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
