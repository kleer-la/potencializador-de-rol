# Increment 2 — Programs, enrollments, panels and boards

Objective: an administrator creates a program on a published map, a map designer chooses its base selection of capabilities, people are enrolled with their panel, and each participant gets a board that only they and their panel can see.
Branch: `feat/increment-2-programs-and-boards`, from `main` at `37523b1`. Delivery: work-unit commits on the branch; merge and push are the user's decisions.
Test runner: `npm test` (Vitest; project `api` needs Docker), `npm run typecheck`, `npm run build --workspace @potencializador/web`.
Conceptual base: `docs/Potencializador de rol — Base conceptual del sistema.md` ("the document"). Design system: `apps/web/src/design-system/` (Board component of the artifact).

## Specs

S1. Program. Document §4.2: "`Program` | nombre, fechas, máximo de focos por ciclo, roles obligatorios del panel | usa una versión publicada del mapa de un rol; tiene la selección base de capacidades para todos sus participantes". Document §7: "Administrador de la organización | Crea roles, programas e inscripciones".
- An administrator of the organization or a super administrator creates a program on a published map version of one of its roles, with name, start and end dates, maximum focuses per cycle, and the mandatory panel roles.
- Only a published version can be used. An archived version keeps serving the programs that already use it.
- User (2026-11-13): "de los 3 roles del panel se requiere como obligatorio al menos 1. El máximo de focos por ciclo puede ser 3 pero debe ser configurable."
  - A program marks at least one of the three panel roles as mandatory; refusing none is enforced in the API and the database. Assumption: by default the three are marked.
  - The maximum of focuses per cycle defaults to 3 and is set when creating the program and changed later by an administrator.
  - An administrator changes the program's name, dates, maximum of focuses and mandatory roles; its map never changes.

S2. Base selection. Document §6.1 step 3: "El diseñador del mapa selecciona, de la versión elegida, las capacidades que cubrirán a todos los participantes del programa." User: "Las verdes son las priorizadas para la organización y programa de ejemplo."
- A map designer of the organization or a super administrator sets the base selection from the capabilities of the program's map version.
- Capabilities added later to the published map can be added to the selection.
- Assumption: changing the base selection affects only boards created afterwards; existing boards keep their own selection (invariant 1 lets the panel adjust each one).

S3. Enrollment. Document §4.2: "`Enrollment` | papel en el programa (participante, líder, especialista, mentor, administrador) | une una persona con un programa".
- An administrator or a super administrator enrolls persons of the organization in a program with one or more roles: participant, leader, specialist, mentor.
- User decision (2026-11-13, answer "1"): a person of the mentoring firm (Kleer) is enrolled in the client's program like any panel member, with role leader, specialist or mentor, never participant.
- Assumption: the role "administrador" of the document is not stored per program; organization administrators already administer every program of their organization.

S4. Panel. Document §4.2: "`PanelAssignment` | — | asigna líder, especialista y mentor a un participante". Document §9.3 left its attributes open; decided here as an assumption: a panel assignment names the participant's enrollment, the panel member's enrollment, and the role (leader, specialist, mentor) that member plays for that participant. A participant may have several members per role. The panel member must be enrolled in the same program with that role.
- An administrator or a super administrator assigns and removes panel members.

S5. Board and invariant 1. Document §5.1: "**Una ubicación por capacidad.** En un tablero, cada capacidad seleccionada para el participante está en exactamente un nivel o sin ubicar. Sin ubicar es un estado válido en cualquier momento y suma cero al puntaje. Cada tablero parte de la selección base del programa, tomada del conjunto del mapa; cualquier integrante del panel puede agregarle capacidades en cualquier momento, y quitarle solo antes de fijar la línea base."
- Enrolling a person as participant creates their board, with one placement per capability of the base selection, all unplaced.
- A capability appears at most once on a board, and only capabilities of the program's map version can be placed.
- A panel member of that participant (or a super administrator who is on that panel) adds capabilities at any time and removes them while the board has no baseline. Each placement records who added it and when.
- Tests are titled `INV-1`.

S6. Who sees a board, invariant 9. Document §5.1: "**Sin comparación entre personas.** No existen rankings ni vistas que ordenen participantes por puntaje. Un tablero lo ven su dueño y su panel." Document §7: the administrator sees "Configuración y estado de avance del proceso, no el contenido de los tableros". Document §9.1: "El superadministrador ve dentro de una organización lo mismo que su administrador; no ve el contenido de los tableros salvo que esté inscrito en el panel".
- The content of a board (its placements) is visible only to its owner and to the members of their panel, enforced in the database as well as in the API.
- An administrator and a super administrator see each board's existence and state, not its content.
- No endpoint returns placements of more than one board, and no endpoint orders participants by any measure.
- Tests are titled `INV-9`.

S7. Isolation. Document §5.1 invariant 11. Every new table has `organization_id` and Row Level Security; a firm person enrolled in a client program acts inside that organization only through their enrollment. Tests titled `INV-11`.

S8. Web interface (Spanish, design system).
- Administrators: programs of a role (create; enroll persons; assign panels). Map designers: base selection.
- Everyone: "Mis tableros" (the person's own boards) and "Tableros que acompaño" (boards where they are on the panel).
- The board uses the design system's Board: capabilities in rows by dimension, a column "Sin ubicar" and one column per level of the scale. Panel members add and remove capabilities from it.

S9. Automated coverage. User: "Las invariantes de la sección 5.1 deben quedar cubiertas por pruebas automatizadas." This increment covers invariants 1 and 9 and extends 11.

## Tasks

- [x] T1 — Domain rules: enrollment roles, who sees and who adjusts a board, selection rules. Specs: S3, S4, S5, S6, S9. Route: inline. Risk: none (new pure code). Commit: `feat: domain rules of programs and boards` (see L4).
- [x] T2 — Persistence: programs, base selection, enrollments, panel assignments, boards, placements; Row Level Security with the board visibility rule; database guards of invariants 1 and 9. Specs: S1–S7, S9. Route: inline. Risk: item 1 (schema), item 2 (access rules). Commit: `feat: store programs and boards with invariants 1 and 9` (see L5).
- [x] T3 — API: programs, base selection, enrollments, panel. Specs: S1–S4, S7. Route: inline. Risk: item 2 (permissions). Commit: `feat: administer programs, enrollments and panels` (see L7). Reopened by L12 and closed by L13.
- [x] T4 — API: boards (mine, accompanied, one board, add and remove capabilities). Specs: S5, S6, S7. Route: inline. Risk: item 2 (permissions). Commit: `feat: boards for their owner and panel` (see L8).
- [x] T5 — Web: programs, selection, enrollments and panels; my boards; the board. Specs: S8. Route: inline. Risk: none (interface over the existing API). Commit: `feat: programs and boards in the web interface` (see L10). Reopened by L12 and closed by L13.

Route evidence: each task builds on the previous one; no parallel writer applies.
Forecast: about 3,500 authored changed lines.

## Log

L1 (2026-11-13, user, original request): "1" — answer to: "¿Cómo quieres que entre el mentor de Kleer al panel: inscrito en el programa del cliente (1) o con otro correo dentro de la organización cliente (2)?", after the proposal to continue with increment 2 ("Listo, ya validé. Vamos bien. ¿Con qué seguimos?").

L2 (2026-11-13, context): increment 2 is row 2 of the approved build plan: "Programa, inscripción, panel, tablero con selección base y ajuste", covering invariants 1 and 9. The user validated increment 0 and 1 with a real Google sign-in before this.

L3 (2026-11-13, decisions before code): the assumptions marked in S1–S4 were taken without asking; each can change later without redoing the rest. A baseline does not exist yet (increment 4), so in this increment every board is "sin línea base" and removals are always allowed to its panel.

L4 (2026-11-13, T1 evidence): RED observed (`program.ts` missing), then GREEN: unit project passes (domain tests titled `INV-1` and `INV-9` included), `npm run typecheck` clean. Rules: `canEnrollAs` (a firm person is never a participant), `canSeeBoardContent` (owner or panel), `canAdjustSelection` (panel only; removal only before a baseline), `missingPanelRoles`.

L5 (2026-11-13, T2 evidence and decisions): RED observed (`relation "programs" does not exist`), then GREEN: 17 storage tests (titled `INV-1`, `INV-9`, `INV-11`) and the whole suite, 184 passed in 19 files; `npm run typecheck` clean. Mutation check on migration 0004: a super administrator clause on reading placements failed the `INV-9` reading test; removing the baseline guard failed the `INV-1` removal test; letting the owner write placements failed the `INV-9` writing test. All three restored.
- Migration `0004_programs_and_boards.sql`: six tables with `organization_id`, composite foreign keys and Row Level Security. `levels` gains `UNIQUE (id, organization_id)` so placements can reference a level of the same organization; migration 0003 is not edited.
- Placements have their own policies with no super administrator clause: read by owner or panel, written by the panel only, always inside the organization in scope.
- A firm person enrolled in a program of the organization is visible by name there (`persons_select_enrolled`), so panels can show a Kleer mentor.
- Guards: a program uses a published map and never changes it; the base selection and placements take only capabilities (and levels) of that map; a firm person is never a participant; a person of another organization is never enrolled; a panel member is enrolled in the same program with that role and is not the participant; a board belongs to a participant enrollment and takes program and owner from it; who added a placement and when never change; no placement leaves a board with a baseline (SQL state `PM001`).

L6 (2026-11-13, review of T1 and T2): native review of commits 09f6fc4 and 0527816 (lenses risk, reliability; consent granted by the user) ended `approved` and was acknowledged, with findings that this follow-up fixes (RED observed for each: 6 failing tests, then GREEN):
- Invariant 9 had a hole in the database: any person in the organization's scope could write enrollments, panel assignments and boards. A participant could enroll themself as leader, join another participant's panel and read their board, or delete a board. Writes now need an administrator of the organization in scope (base selection: a map designer); boards are created only by `app_create_board`, which also inserts the placements of the base selection. Mutation check: opening the writes again fails 4 tests.
- A board with a baseline could be deleted (directly or by deleting its enrollment), and its baseline cleared. Both are refused now (`PM001`).
- `added_by` was whatever the caller sent; it is now the person acting, and `added_at` the time of the insert.
- An enrollment's role could change after its board or panel existed; it never changes now.
- The visibility of persons enrolled in a program is limited to people of the mentoring firm (people of the organization were already visible); a firm person not enrolled stays invisible. Email remains visible with the name (recorded, not changed).
- Tests: the level test now asserts stored values; the immutability of who added and when is tested; cleanup of a baseline in tests skips the triggers, which only the superuser can.
Checks: `npm test` 189 passed, `npm run typecheck` clean. Migration 0004 was edited instead of adding 0005: it is only on this unmerged branch and was applied only to throwaway test databases.

L7 (2026-11-13, T3 evidence and decisions): RED observed (12 failing, routes missing), then GREEN: `npm test` 201 passed in 20 files, `npm run typecheck` clean.
- Endpoints under `/api/organizations/:organizationId/programs`: `GET` (members), `POST` (administrators), `GET :programId` (administrators and map designers: program, selection, enrollments with names and emails, panels, each board's id and state, mandatory panel roles still missing per participant; no board content), `PUT :programId/selection` (map designers), `POST :programId/enrollments` (by email, one or several roles; a participant gets their board with the base selection), `DELETE :programId/enrollments/:enrollmentId`, `POST :programId/panel`, `DELETE :programId/panel/:participant/:member/:role` (administrators).
- Enrolling by email: the database function `app_find_enrollable_person` (added to migration 0004) finds a person of the organization or of the mentoring firm; an unknown email and a person of another organization both answer `404 person_not_found`.
- Answers: `409 map_not_published`, `400 unknown_reference`, `400 firm_person_cannot_participate`, `400 invalid_panel`, `409 baseline_set`.

L8 (2026-11-13, T4 evidence and decisions): RED observed (6 failing, routes missing), then GREEN: `npm test` 207 passed in 21 files, `npm run typecheck` clean.
- Endpoints under `/api/boards`, not under an organization: a participant may hold no organization role and a Kleer mentor belongs to none. `GET /api/boards` lists `mine` and `accompanied` (organization, program, owner's name, state, the viewer's panel roles; no content). `GET /api/boards/:boardId` returns the scale, dimensions and capabilities of the program's map, the placements, and what the viewer may do. `POST /api/boards/:boardId/capabilities` and `DELETE .../capabilities/:capabilityId` for the panel.
- Two database functions added to migration 0004: `app_my_boards()` and `app_board_organization(board)`, which answers only to the board's owner or panel. Anyone else, administrators and super administrators off the panel included, gets the same `404` as for a board that does not exist.
- Answers: `403 forbidden` (not on the panel), `409 already_on_board`, `400 unknown_reference`, `409 baseline_set`.

L9 (2026-11-13, review of the database fix, T3 and T4): native review of commits 8628ef4 to a454406 (lenses risk, reliability; consent granted by the user) ended `approved` and was acknowledged; no blocking finding. Handled in a follow-up commit:
- Creating a program mapped every check violation to `map_not_published`. The route now checks the map's state itself; other failures are no longer mislabeled. RED not observed separately: the behavior was correct for the tested case.
- Repeated mandatory panel roles were accepted; now `400` (RED observed, then GREEN).
- Added the route test for removing a participant: `204` with their board before the baseline, `409 baseline_set` after it (passed at once: it pins the cascade through the guard).
Checks: `npm test` 208 passed, `npm run typecheck` clean.

L10 (2026-11-13, T5 evidence and decisions): RED observed (the two new containers missing), then GREEN: `npm test` 218 passed in 23 files, `npm run typecheck` clean, `npm run build` clean.
- The top bar gains "Tableros" and "Organizaciones". A person with no organization role and no super administrator rights (a participant, typically) lands on "Tableros".
- An organization gains the tab "Programas" for administrators and map designers: create a program on a published version, choose the base selection (map designers), enroll by email with roles, see each board's state, assign and remove panel members with the mandatory roles still missing.
- The board is a table: capabilities in rows grouped by dimension, a column "Sin ubicar" and one per level, colored with the design system's level ramp. Only capabilities on the board appear; the panel adds the others and removes with confirmation; the owner reads that the panel decides.
- Compose probe with the Product Owner map: program with the 15 prioritized capabilities as base selection; participant, leader and a Kleer mentor enrolled; panel missing "specialist" as expected; the mentor saw the board with 15 placements and add and remove rights; a super administrator off the panel got `404`. Real browser check as the mentor on `127.0.0.1` (the browser holds the user's real session cookie for `localhost`, which the probe must not touch): 7 dimensions, 15 capabilities under "Sin ubicar", level columns colored.

L11 (2026-11-13, review of the whole branch): at the stop hook's request, a native review of the branch against `main` (lens reliability; consent granted by the user) ended `approved` and was acknowledged. Handled in a follow-up commit:
- "Mis tableros" kept showing the failure after a failed load; it now offers "Reintentar" and clears the failure on the next load (RED observed, then GREEN).
- Added route tests for removing a capability: `403` off the panel, `404` for a capability not on the board, `401` without a session (passed at once; they pin the refusal order).
Checks: `npm test` 220 passed, `npm run typecheck` clean.

L12 (2026-11-13, user correction, verbatim): "de los 3 roles del panel se requiere como obligatorio al menos 1. El máximo de focos por ciclo puede ser 3 pero debe ser configurable." S1 rewritten; T3 and T5 reopened for: at least one mandatory role, and editing the program's settings.

L13 (2026-11-13, L12 implemented): RED observed (3 API and storage tests, 2 interface tests), then GREEN: `npm test` 223 passed in 23 files, `npm run typecheck` clean.
- Database: `mandatory_panel_roles` must hold at least one role (check constraint in migration 0004, still unmerged).
- API: creating a program requires at least one mandatory role; `PATCH /api/organizations/:organizationId/programs/:programId` (administrators) changes name, dates, maximum of focuses and mandatory roles; the map cannot be changed; dates must stay in order.
- Interface: creating a program shows "Máximo de focos por ciclo" (3 by default) and "Roles obligatorios del panel" (the three by default); the program view has "Configuración del programa" to change them. The last mandatory role cannot be unchecked, and the form says so.

L14 (2026-11-13, independent verification at feature end): a separate verifier worked on a scratch copy of head 0966ae6 against baseline 37523b1. `npm test` (218) and `npm run typecheck` passed. Verdicts: S1 to S9 pass (S8 at source level). Blockers: none. Off-panel people (administrator, designer, other participant, super administrator, a specialist of another panel, people of another organization) got the same `404` as a random id on read and write, and read 0 placements in SQL as the API role. Advisories recorded, not changed:
- The placements of the base selection record the enrolling administrator as who added them.
- An administrator can delete a board in SQL before its baseline, leaving the enrollment without a board; no endpoint does it.
- An administrator can set `baseline_set_at` from empty to a date in SQL; increment 4 (calibration and baseline) must take over who sets it.
- Map designers also see each board's state in the program view.
