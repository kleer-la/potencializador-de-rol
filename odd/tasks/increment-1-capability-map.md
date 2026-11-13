# Increment 1 — Capability map: design, publish, grow

Objective: a map designer builds the capability map of a role (scale, dimensions, capabilities, tools, strategic objectives, bonus rules), publishes it, and from then on the map only grows. The Product Owner map of the example loads as data.
Branch: `feat/increment-1-capability-map`, from `main` at `dba9ba0`. Delivery: work-unit commits on the branch; no remote, so merge is the user's decision.
Test runner: `npm test` (Vitest; project `api` needs Docker, project `unit` does not). `npm run typecheck`.
Conceptual base: `docs/Potencializador de rol — Base conceptual del sistema.md` (called "the document" below).

## Specs

S1. Roles. Document §7: "Administrador de la organización | Crea roles, programas e inscripciones". Document §4.1: "`Role` | nombre, descripción | pertenece a una organización; tiene mapas".
- An administrator of the organization or a super administrator creates and lists roles of that organization.
- Every member of the organization lists its roles.

S2. Map content. Document §8, inside the MVP: "Editor del mapa: dimensiones, capacidades, herramientas, escala, dificultad, bonificaciones". Document §4.1:
- "`CapabilityMap` | versión, estado (borrador, publicado, archivado) | pertenece a un rol; tiene una escala, dimensiones y reglas de bonificación"
- "`Level` | orden, nombre, descripción, multiplicador, exige transferencia (sí/no) | pertenece a una escala"
- "`Dimension` | nombre, descripción, tipo (ciclo de trabajo, transversal), orden | pertenece a un mapa; tiene capacidades"
- "`Capability` | enunciado observable, dificultad (baja, media, alta), activa (derivado: está siendo usada en al menos un programa) | pertenece a una dimensión; usa herramientas; apunta a objetivos estratégicos"
- "`Tool` | nombre, descripción, enlace | pertenece a una organización; se asocia a capacidades"
- "`StrategicObjective` | nombre, descripción | pertenece a una organización; se vincula a capacidades"
- "`BonusRule` | nombre, puntos extra, condición exigida (texto) | pertenece a un mapa; se aplica mediante bonificaciones otorgadas"
- Document §1, principle 6: "Configuración como datos. Dimensiones, niveles, multiplicadores, dificultad y bonificaciones se configuran; no se programan." No level name, level count, multiplier, dimension or bonus is fixed in code.
- Assumption: difficulty is optional ("sin definir"), because the example map carries no difficulty.
- Assumption: "activa" is not stored or shown in this increment; programs do not exist yet.

S3. Life cycle. Document §6.3: "Mapa de capacidades | borrador → publicado → archivado". Document §6.1: "1. Diseñar el mapa. ... El mapa queda en borrador." and "2. Publicar el mapa. Lo existente queda congelado y disponible para programas; la versión solo admite agregar dimensiones y capacidades."
- A draft is freely edited: add, change, reorder and remove any content.
- Publishing requires, per the cardinalities of document §4.4: at least one level, at least one dimension, and at least one capability in every dimension. A refusal names what is missing.
- A published map can be archived. No other transition exists; an archived map changes no more.
- Assumption: versions of a role are numbered 1, 2, 3…; a role has at most one draft at a time; a new version starts as a draft copy of a published or archived version.

S4. Invariant 10. Document §5.1: "**Un mapa publicado solo crece.** Las dimensiones y capacidades existentes no se modifican ni se eliminan; esos cambios crean una versión nueva. Sí se pueden agregar dimensiones y capacidades nuevas en cualquier momento, y quedan disponibles para los tableros de los programas que usan ese mapa."
- In a published map: changing or removing a dimension, a capability, a level, a bonus rule, or the tools and objectives of an existing capability is refused. Adding a dimension or a capability (with its tools and objectives) is accepted.
- Enforced in the domain rules, through the API, and in the database itself, so no code path can break it.
- Assumption: levels and bonus rules of a published map are frozen too; the invariant names only dimensions and capabilities as what may be added.
- Assumption: tools and strategic objectives are catalogs of the organization and stay editable; renaming one changes how published maps show it.
- Tests are titled `INV-10`.

S5. Permissions. Document §7: "Diseñador del mapa | Crea y publica versiones del mapa de capacidades; define la selección base de cada programa | Mapas de su organización". User: "La persona de la firma es super administrador. Crea cuentas para organizaciones clientes y debería poder administrar dentro de ellas también si se requiere por soporte".
- A map designer of the organization or a super administrator creates, edits, publishes and archives maps, and maintains tools and strategic objectives.
- Every member of the organization reads its maps; anyone else gets the same refusal as for an organization that does not exist.

S6. Isolation. Document §5.1 invariant 11. Every new table has `organization_id` and Row Level Security; tests titled `INV-11` cover the new tables at the database level and through the API.

S7. Example map. User: "Adjunto el mapa de ejemplo" and "Las verdes son las priorizadas para la organización y programa de ejemplo." Document §10: "Cargar el mapa de los Product Owners como datos de prueba, para validar el modelo genérico contra el caso real."
- The Product Owner map of the attached PDF is a data file in the repository: 9 dimensions (5 of work cycle: Entender, Descubrir, Priorizar, Crear, Adaptar / Impactar; 4 transversal: Autonomía, Liderazgo, Complejidad de problemas, Comunicación), 55 capabilities, their tools, the scale 0 to 4 of document §2, and the bonus rule for AI with transfer.
- A map designer imports a map from that format into a role as a draft; nothing in the code is specific to Product Owners.
- The file keeps which capabilities are green (prioritized); the import ignores it until programs exist (increment 2).
- Assumption: capability and tool texts are transcribed as written; the asterisks on some tools are kept because their meaning is undefined (document §9.3).

S8. Web interface (Spanish, terms of document §3). Roles of an organization; versions of a role's map with their state; the map as dimensions with their capabilities; editing in draft; scale, bonus rules, tools and objectives; publish and archive with confirmation; in a published map only "add" actions are offered; import of a map file.

S9. Automated coverage. User: "Las invariantes de la sección 5.1 deben quedar cubiertas por pruebas automatizadas." This increment covers invariant 10 and extends invariant 11.

## Tasks

- [x] T1 — Domain rules: map life cycle, publish requirements, what a published map accepts, permissions. Specs: S3, S4, S5, S9. Route: inline. Risk: none (new pure code in `packages/domain`; existing policy functions unchanged). Commit: `feat: domain rules of the capability map` (see L4).
- [x] T2 — Persistence: migration for roles, maps and content, Row Level Security, database guard of invariant 10, tests. Specs: S2, S4, S6, S9. Route: inline. Risk: item 2 (security guard) and item 1 (schema). Commit: `feat: store capability maps and guard invariant 10` (see L5).
- [x] T3 — API for roles, tools and strategic objectives. Specs: S1, S2, S5, S6. Route: inline. Risk: item 2 (permissions); item 3 (shared code: the access checks of the organizations routes moved to `access/organization-access.ts`). Commit: `feat: roles and catalogs of an organization` (see L7).
- [ ] T4 — API for maps: draft editing, publish, grow, new version, archive, import. Specs: S2, S3, S4, S5, S6. Route: inline. Risk: item 2 (permissions). Commit: —
- [ ] T5 — Product Owner map as data, loaded through the import. Specs: S7. Route: inline. Risk: none expected. Commit: —
- [ ] T6 — Web interface: roles and map editor. Specs: S8. Route: inline. Risk: none expected. Commit: —

Route evidence: each task builds on the previous one (T2 on T1, T3 and T4 on T2, T5 on T4, T6 on T3 to T5), so no parallel writer applies.
Forecast: about 3,500 authored changed lines. No remote and no pull requests; slices are the work-unit commits.

## Log

L1 (2026-11-12, user, original request): "Inicia"

L2 (2026-11-12, context): the request answers the question "¿Empiezo incremento 1 ahora, o prefieres probar primero ingreso real con Google y Microsoft?". Increment 1 is row 1 of the build plan the user approved: "Mapa: editor, escala, publicar, solo-agregar. Carga del mapa de PO", covering invariant 10.

L3 (2026-11-12, decisions before code): the assumptions marked in S2, S3, S4 and S7 were taken without asking, because the document leaves them open and each can be changed later without redoing the rest. They are reported to the user with this document.

L4 (2026-11-12, T1 evidence): RED observed (`capability-map.ts` missing; `canDesignMaps is not a function`), then GREEN: unit project 29 passed, `npm run typecheck` clean. Rules: `canApplyChange`, `canTransition`, `canStartNewVersionFrom`, `publishObstacles`, and the policies `canDesignMaps` and `canReadOrganization`. An administrator who is not map designer does not design maps.

L5 (2026-11-13, T2 evidence and decisions): RED observed (`relation "roles" does not exist`), then GREEN: `npm test` 106 passed in 12 files, `npm run typecheck` clean. Mutation check on the guard: letting links be added to any published capability failed 2 tests; treating published maps like drafts failed 5; both restored.
- Migration `0003_capability_maps.sql`: ten tables, each with `organization_id`, one Row Level Security policy and composite foreign keys to its parent, so content cannot hang from another organization.
- Invariant 10 is enforced by triggers that apply to every database role, the owner included. A published map refuses update and delete of levels, bonus rules, dimensions, capabilities and their links; it accepts new dimensions and capabilities; tools and objectives of a new capability are accepted only in the transaction that created it. An archived map refuses everything. A map moves only draft → published → archived, records `published_at` and `archived_at`, and only a draft can be deleted (with its content).
- One draft per role (partial unique index). Positions are deferred unique constraints, so reordering within one transaction works.
- Refusals carry SQL state `PM010` and start with `invariant 10:`; the API maps them in T4.
- Tests settle every refused attempt together (`Promise.allSettled`): awaiting them one by one left rejections unhandled.

L6 (2026-11-13, review of T1 and T2): native review of commits fa9887a to 9e901d2 (lenses risk, reliability; consent granted by the user) ended `approved` and was acknowledged; no blocking finding. Informational findings fixed in a follow-up commit, each with RED then GREEN (3 new tests):
- A map could be inserted already published or archived, skipping the draft state. The guard now runs on insert too: a map is born a draft with no life-cycle dates.
- `created_at`, `published_at` and `archived_at` could be overwritten by an update that kept the status. The guard now keeps them; only a transition sets them.
- Content inserted under a map of another organization failed with an `invariant 10` message for published or archived maps and with a foreign key error for drafts, which revealed the other map's state. The state lookup now ignores parents of another organization, so every case ends in the same foreign key error.
Migration 0003 was edited instead of adding 0004: it exists only on this unmerged branch and was applied only to throwaway test databases.
Not changed: inserting a link whose capability and tool both belong to another organization and are already linked fails with a duplicate key error; it needs two random identifiers of the other organization.
Checks: `npm test` 109 passed, `npm run typecheck` clean.

L7 (2026-11-13, T3 evidence and decisions): RED observed (14 failing, routes missing), then GREEN: `npm test` 123 passed in 13 files, `npm run typecheck` clean.
- Endpoints under `/api/organizations/:organizationId`: `roles` (GET members, POST administrators), `tools` and `strategic-objectives` (GET members; POST and PATCH map designers). A repeated name, ignoring case, answers `409 name_taken`. A tool link must be http or https.
- The access checks of the organizations routes moved to `apps/api/src/access/organization-access.ts` and are shared by every route that works inside an organization. The existing 16 organizations tests pass unchanged; behavior is the same, including 404 for a super administrator on an organization that does not exist.
- A change through PATCH touches only the fields it names. The first version reused the creation schema, whose defaults erased the tool link; the test caught it.

L8 (2026-11-13, review of the guard fix and T3): native review of commits 8733edd and 306782e (lenses risk, reliability; consent granted by the user) ended `approved` and was acknowledged; no blocking finding. Handled in a follow-up commit (RED then GREEN, 2 new test runs):
- An empty PATCH answered `500`; a change must now name at least one field, otherwise `400`.
- Added tests for a malformed entry id and for a rename to a taken name (`409`).
- Recorded, not changed: since the access checks moved to the shared helper, a super administrator who sends an invalid body for an organization that does not exist gets `404` before `400`. Organizations cannot be deleted, so the separate existence check cannot race.
Checks: `npm test` 125 passed, `npm run typecheck` clean.
