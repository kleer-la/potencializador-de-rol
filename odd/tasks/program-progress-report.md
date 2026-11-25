# A program leader reads a progress report of every participant

Objective: a leader enrolled in a program sees, in one simple view, how far each participant of that program moved from their own baseline.
Branch: `feat/program-progress-report`, from `main` at `d631642`. Delivery: work-unit commits; merge, push and deploy are the user's decisions.
Test runner: `npm test` (Vitest; project `api` needs Docker), `npm run typecheck`.

## Specs

S1. User's request: "Como líder o superadministrador quiero visualizar un informe del progreso de todos los participantes de un programa, para conocer su avance respecto a su línea base de ellos en una vista simple de leer"

S2. User decision (2026-11-25), superadministrator: "Superadmin solo si inscrito" — the superadministrator sees the report only when enrolled as leader in that program; no new rule for the superadministrator.

S3. User decision (2026-11-25), figures: "Solo avance propio" — "Por participante: cambio vs su línea base (+puntos y %), estado del tablero y ciclo actual. Sin puntajes absolutos, para no invitar a comparar." The report is ordered alphabetically, never by score (invariant 9 and principle 3).

S4. Rules (assumptions derived from S1-S3, not stated by the user):
- Who: a person with an enrollment of role `leader` in the program, on its panel or not. Anyone else gets no report of that program.
- Rows: every participant board of the program, ordered by participant name.
- Change: today's score minus the baseline score, the same figures as the board's evolution. Percent: change divided by the baseline score, times 100; none when the baseline score is 0. A board without a baseline shows no change.
- Current cycle: the latest non-closed cycle (number and state), or none.
- The response carries no absolute score, no maximum and no breakdown.
- `GET /api/program-reports` returns one report per program the person leads that has at least one board (a program without boards has nothing to report). The web shows them in the boards page as "Informe de mis programas".
- The conceptual base records the amendment of invariant 9.

S5. User's request (2026-11-25): "Quiero que haya una especie de acordeón en cada uno de los participantes y que cuando abra el acordeón se muestren todas las capacidades observables, obviamente en cada uno, cada una agrupada, en sus agrupaciones, y que me muestre en qué estado está cada una de esas capacidades observables. Entonces, cada uno de los participantes funciona como el encabezado del acordeón y si yo lo abro se me muestran las capacidades observables de ese participante y en qué estado se encuentra cada una de ellas."
Assumptions: "estado" of a capability is its current level on the board ("Sin ubicar" when unplaced); "agrupaciones" are the map's dimensions, in map order; only the capabilities on that board. The capabilities load when the accordion opens, from `GET /api/boards/:boardId`, which a program leader already reads.

S6. User's request (2026-11-25): "Me gustaría que la visual del informe sin ningún acordeón desplegado parezca una tabla, como estaba antes. que queden alineados verticalmente los campos. adicionalmente me gustaría que al desplegar un acordeón, se visualice también como tabla con columnas alineadas y que cada los estados muestren el número del nivel. Incluye la línea base como columna"
Assumptions: the report is one table, one row per participant, whose first cell opens and closes it; the open participant shows, below their row, one table with dimension rows as group headers and the columns "Capacidad observable", "Línea base", "Estado actual", aligned across dimensions. A level shows as "<position> · <name>" (for example "1 · Principiante"); no baseline entry shows "—".

S7. User's request (2026-11-25): "súbele el tamaño a la letra de los agrupadores, que quede un poco más grande que la de las capacidades observables.
Resalta suavemente con verde las capacidades donde hubo cambios en positivo"
Assumptions: "agrupadores" are the dimension rows; a positive change is a current level above the baseline level on the scale; a capability without a baseline entry or unplaced today is not highlighted.

S8. User's request (2026-11-25): "en la vista consolidada me gustaría añadir información de la cantidad de experimentos finalizados"
Assumptions: "vista consolidada" is the participants table; a finished experiment is a reviewed one ("Revisado"), counted across every cycle of the board; the column is "Experimentos finalizados".

S9. User's request (2026-11-25): "incluye también experimentos en progreso"
Assumption: a separate column "Experimentos en curso" (state `in_progress`, "En curso"), across every cycle of the board, next to "Experimentos finalizados".

## Tasks

- [x] T1 — Domain `progressAgainstBaseline`, API `GET /api/program-reports`, web report, conceptual base amendment, tests. Specs: S1-S4. Route: inline (one behavior; no writer reason). Risk: none (reads through existing Row Level Security; no migration, no policy change). Commit: feat: add program progress report for leaders (user tested 2026-11-25).

- [x] T2 — Accordion per participant with the capabilities by dimension and their level. Specs: S5. Route: inline (web only). Risk: none. Commit: feat: add program progress report for leaders (user tested 2026-11-25).
- [x] T3 — Report as an aligned table with expandable rows; level numbers; baseline column. Specs: S6. Route: inline (web only). Risk: none. Commit: feat: add program progress report for leaders (user tested 2026-11-25).
- [x] T4 — Larger dimension rows; soft green on capabilities above their baseline. Specs: S7. Route: inline (web only). Risk: none. Commit: feat: add program progress report for leaders (user tested 2026-11-25).
- [x] T5 — Finished experiments per participant (API field `finishedExperiments`, web column). Specs: S8. Route: inline. Risk: none. Commit: feat: add program progress report for leaders (user tested 2026-11-25).
- [x] T6 — Experiments in progress per participant (API field `experimentsInProgress`, web column). Specs: S9. Route: inline. Risk: none. Commit: feat: add program progress report for leaders (user tested 2026-11-25).

## Log

L1 (2026-11-25, user, original request): see S1.

L2 (2026-11-25, user decisions): see S2 and S3.

L3 (2026-11-25, analysis): leaders already read every board of their program (migration 0012, `app_reads_board`). The report reuses `app_my_boards()` to find the boards and `readProgress` in `boards.routes.ts` for the figures, so no migration and no policy change. Led programs come from the person's own `leader` enrollments.

L4 (2026-11-25, T1 evidence): domain RED (2 failing, missing function) then GREEN. API test written before the route but first run after it; RED confirmed by stashing the route (5 failing with 404), GREEN 5/5. Web RED (1 failing) then GREEN. `npm run typecheck` clean; `npm test` 483 tests: one App test failed only for the new unexpected request, fixed by adding the route to its fake backend; web project then 115/115. Seeding note: after the baseline a placement level changes only through a level change (invariant 4 trigger) and a cycle is inserted `planned`.

L5 (2026-11-25, behavior note): the boards page now loads the boards and the reports together; if the report request fails, the page shows the retry message.

L6 (2026-11-25, user, change request): see S5.

L7 (2026-11-25, T2 evidence): web RED (2 failing) then GREEN. Each participant is a `<details>` accordion; its summary carries name, status, cycle and progress; opening it loads `GET /api/boards/:boardId` once and shows one table per dimension (map order) with each capability on the board and its level or "Sin ubicar". A mistaken `prettier --write` with default options reformatted whole files; the repository has no formatter configuration, so those files were restored from `HEAD` and only the intended edits reapplied. `npm run typecheck` clean; `npm test` 484 passed in 50 files.

L8 (2026-11-25, user, change request): see S6.

L9 (2026-11-25, T3 evidence): web RED (2 failing) then GREEN. The report is one table again; each participant's name is a button (`aria-expanded`) that opens a detail row with one capabilities table: dimension rows as group headers, columns "Capacidad observable", "Línea base", "Estado actual"; levels as "<position> · <name>". The arrow is drawn by CSS so cells hold only text. `npm run typecheck` clean; web project 116 passed.

L10 (2026-11-25, user, change request): see S7.

L11 (2026-11-25, T4 evidence): web RED (1 failing) then GREEN. Dimension rows use 700 17px (capabilities 15px); rows whose current level position is above the baseline level position get `report-improved`, a 12% mix of `--success` (works in both themes). `npm run typecheck` clean; web project 116 passed.

L12 (2026-11-25, user, change request): see S8.

L13 (2026-11-25, T5 evidence): API RED (missing `finishedExperiments`) then GREEN; web table gains the column "Experimentos finalizados". Seeding gotchas: a published map refuses new levels (invariant 10); a focus needs a target above the current level; experiments only move in an active cycle by a panel member, so the test starts the cycle and reviews one experiment through the real routes.

L14 (2026-11-25, user, change request): see S9.

L15 (2026-11-25, T6 evidence): API and web RED (4 failing) then GREEN. One grouped count by state gives both columns. `npm run typecheck` clean; `npm test` 484 passed in 50 files.
