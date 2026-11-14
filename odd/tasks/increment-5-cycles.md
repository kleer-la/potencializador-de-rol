# Increment 5 — Cycles, focuses and experiments

Objective: after the baseline, participant and panel plan an improvement cycle with a few focuses, each tested with at least one experiment in real work; the cycle starts when the panel agrees, and the experiments move through their states until they are reviewed.
Branch: `feat/increment-5-cycles`, from `main` at `efc2c57`. Delivery: work-unit commits; merge and push are the user's decisions.
Test runner: `npm test` (Vitest; project `api` needs Docker), `npm run typecheck`, `npm run build --workspace @potencializador/web`.
Conceptual base: `docs/Potencializador de rol — Base conceptual del sistema.md` ("the document").

## Specs

S1. Cycles. Document §3: "Ciclo | `Cycle` | Periodo de mejora con focos, experimentos y cierre." Document §4.2: "`Cycle` | número, fechas, estado | pertenece a un tablero; tiene focos". Document §6.3: "Ciclo | planeado → activo → cerrado".
- A cycle belongs to a board with a baseline; it has a number (1, 2, … per board), start and end dates, and a state.
- A new cycle starts "planeado". Assumption: a board has at most one cycle that is not closed.
- Closing a cycle takes a snapshot and compares it with the previous one (document §6.2 step 6); that belongs to increment 7. Here a cycle goes from "planeado" to "activo" only.

S2. Focuses. Document §3: "Foco | `Focus` | Capacidad priorizada para un ciclo." Document §4.2: "`Focus` | nivel objetivo | une un ciclo con una capacidad; tiene experimentos". Document §6.2 step 3: "**Selección de focos.** Participante y panel priorizan pocas capacidades para el ciclo."
- A focus is a capability on the board with a target level of the program's scale; a capability is a focus at most once per cycle.
- Assumption: the target level is above the capability's current level, and the capability already has a level (one added after the baseline gets its initial level first).

S3. Experiments. Document §3: "Experimento | `Experiment` | Acción concreta en el trabajo real para desarrollar un foco." Document §4.2: "`Experiment` | descripción, resultado esperado, estado, aprendizajes | pertenece a un foco". Document §6.3: "Experimento | planteado → en curso → revisado, con resultado: consolidó, no consolidó o descartado".
- An experiment has a description, an expected result, a state and learnings.
- It starts "planteado"; once the cycle is active it goes "en curso"; it ends "revisado" with a result (consolidó, no consolidó, descartado) and its learnings. Assumption: a "planteado" experiment can also be reviewed as "descartado" without running.
- Assumption: the review is recorded by a panel member (document §6.2 step 5: "En cada sesión se revisan los experimentos, se registran hechos y aprendizajes"). Mentoring sessions and evidence come in increment 6.

S4. Invariant 8. Document §5.1: "**Focos acotados.** Un ciclo no admite más focos que el máximo del programa, y cada foco tiene al menos un experimento." User, 2026-11-13: "El máximo de focos por ciclo puede ser 3 pero debe ser configurable." (`programs.max_focuses`).
- A cycle never holds more focuses than the program's maximum, in the database as well.
- Assumption: while the cycle is "planeado" a focus may still lack its experiment; the cycle starts only when it has at least one focus and every focus has at least one experiment. Once active, a focus never loses its last experiment, and experiments are not deleted (discarding is a result).
- Tests are titled `INV-8`.

S5. Board state. Document §6.3: "Tablero | sin iniciar → autoevaluado → calibrado (con línea base) → en ciclo ⇄ entre ciclos → cerrado".
- Starting a cycle moves the board from "calibrado" (or "entre ciclos") to "en ciclo".

S6. Who does what. Document §7: the participant "propone focos, registra experimentos"; the leader "acuerda focos"; the mentor "conduce las mentorías". Invariant 9: "Un tablero lo ven su dueño y su panel."
- The owner and their panel plan the cycle: create it, add and remove focuses, add experiments, while it is "planeado"; they add experiments and start running them while it is "activo".
- Assumption: starting the cycle is the panel's agreement, so only a panel member starts it. Only a panel member records a review.
- Nobody outside the owner and their panel sees or changes any of it, in the API or the database. Invariant 11: new tables have `organization_id` and Row Level Security; tests titled `INV-11`.

S7. Web interface (Spanish, design system).
- On a board with a baseline, owner and panel see the current cycle: number, dates, state, its focuses (capability, current level, target level) with their experiments, and how many focuses remain of the program's maximum.
- They can create a cycle, add or remove a focus, and add an experiment; a panel member can start the cycle (with confirmation) and record a review (result and learnings); owner or panel can mark an experiment "en curso".

S8. Automated coverage. User: "Las invariantes de la sección 5.1 deben quedar cubiertas por pruebas automatizadas." This increment covers invariant 8 and extends 9 and 11.

## Tasks

- [x] T1 — Domain rules: who plans and who starts a cycle, focus limit and target level, what blocks the start, experiment transitions. Specs: S1–S4, S6, S8. Route: inline. Risk: none (new pure code). Commit: `feat: domain rules of cycles, focuses and experiments` (see L4).
- [x] T2 — Persistence: cycles, focuses, experiments; start function; guards (invariant 8, transitions, one open cycle); Row Level Security. Specs: S1–S6, S8. Route: inline. Risk: item 1 (schema), item 2 (access rules). Commit: `feat: store cycles, focuses and experiments under invariant 8` (see L5).
- [x] T3 — API: cycle with the board, create cycle, focuses, experiments, start, experiment progress and review. Specs: S1–S6. Route: inline. Risk: item 2 (permissions). Commit: `feat: cycles, focuses and experiments through the board API` (see L7).
- [x] T4 — Web: current cycle on the board. Specs: S7. Route: inline. Risk: none (interface over the API). Commit: `feat: cycles, focuses and experiments in the web interface` (see L8).

Route evidence: each task builds on the previous one; no parallel writer applies.
Forecast: about 2,200 authored changed lines.

## Log

L1 (2026-11-13, user, original request): "Adelante" — answer to: "Siguiente en el plan: incremento 5, ciclos, focos y experimentos (invariante 8 ...). Cuando quieras, armo su documento de especificación primero."

L2 (2026-11-13, context): row 5 of the approved build plan, covering invariant 8. Migrations up to 0006 are on `main`; this increment adds migration 0007 and edits none. `programs.max_focuses` exists since migration 0004 (default 3, configurable 1 to 20).

L3 (2026-11-13, assumptions): those marked in S1–S4 and S6 were taken without asking; each can change later without redoing the rest. Mentoring sessions and evidence go to increment 6, closing a cycle with its snapshot to increment 7.

L4 (2026-11-13, T1 evidence): RED observed (`cycle.ts` missing), then GREEN: unit project 100 passed, `npm run typecheck` clean. Rules: `canPlanCycle` (owner or panel, after the baseline), `canStartCycle` and `canReviewExperiment` (panel), `remainingFocuses`, `startBlockers` (no focus, too many, focuses without experiment), `isValidTarget` (above a current level), `canMoveExperiment` (planned → in progress → reviewed with result, only in an active cycle; a planned one only as discarded).

L5 (2026-11-13, T2 evidence and decisions): RED observed (`relation "cycles" does not exist`), then GREEN: 7 storage tests (titled `INV-8`, `INV-9`, `INV-11`) and the whole suite, 312 passed in 33 files; `npm run typecheck` clean. Mutation check on migration 0007: dropping the focus maximum, the "every focus has an experiment" check of the start, or the panel check of a review each failed its test. All restored.
- Migration `0007_cycles_focuses_experiments.sql`: `cycles` (number per board set by the guard, at most one not closed per board, `cycles_one_open_per_board`), `focuses` (one per capability and cycle), `experiments` (state and result consistent by a check). All with `organization_id`, composite foreign keys and Row Level Security for owner and panel; no super administrator clause.
- The owner and the panel write these rows directly under the policies; column grants keep `cycles.state`, `started_at` and who reviewed an experiment out of the API role's reach. `app_start_cycle(cycle)` starts a planned cycle for a panel member and moves the board to `in_cycle`.
- Guards: a cycle needs an open board with a baseline; dates change only while planned; planned → active → closed only. Focuses change only while the cycle is planned, aim above the current level of a placed capability, and never exceed the program's maximum (the cycle row is locked while counting). Experiments join a planned or active cycle, move only while it is active, are reviewed (with a result, by a panel member) for good, and are not deleted once the cycle started. SQL states `PM008` (invariant 8) and `PM050` (state).

L6 (2026-11-13, review of T1 and T2): native review of commits `4515943` and `a63d1f8` (escalated for item 2, access rules; lenses risk, reliability; consent granted by the user) ended `approved` and was acknowledged. Handled in a follow-up commit (`npm test` 312 passed):
- The experiment guard read the cycle without locking it, so deleting a focus's only experiment could interleave with the start and leave an active cycle with a focus without experiment (invariant 8). It now locks the cycle, as the focus guard and the start function do. A race; no deterministic test.
- The lookups `app_board_of_cycle` and `app_board_of_focus` answered for any organization; they now answer only inside the organization in scope.
- Added storage cases for two guards no test reached: an experiment does not move in a planned cycle, and the dates of an active cycle do not change. Mutation check: removing either guard fails its case.

L7 (2026-11-13, T3 evidence): RED observed (4 of 6 route tests failing), then GREEN: `npm test` 318 passed in 34 files, `npm run typecheck` clean.
- `GET /api/boards/:boardId` adds `cycle` (the cycle not closed: number, dates, state, `startedAt`, `maxFocuses`, focuses in map order with their experiments; `null` if none) and `viewer.canPlanCycle`, `viewer.canStartCycle`, `viewer.canReviewExperiments`. One existing test compared `viewer` whole and now includes the three fields.
- `POST /api/boards/:boardId/cycles` {startsOn, endsOn}: `201`; `409 no_baseline`, `409 cycle_open`, `400 invalid_request` (end before start).
- `POST .../cycles/:cycleId/focuses` {capabilityId, targetLevelId}: `201`; `422 invalid_target` (not above the current level, capability unplaced or off the board, level of another map), `409 already_focus`, `422 too_many_focuses` with `maxFocuses`, `409 cycle_not_planned`. `DELETE .../focuses/:focusId`: `204`; `409 cycle_not_planned`.
- `POST .../focuses/:focusId/experiments` {description, expectedResult}: `201`; `409 cycle_closed`.
- `POST .../cycles/:cycleId/start` (panel): `200`; `403 forbidden`, `409 cycle_not_planned`, `422 cannot_start` with `noFocus`, `tooMany` and `withoutExperiment`; `409 cycle_changed` if the database check fails after the API's.
- `PATCH /api/boards/:boardId/experiments/:experimentId` {state: "in_progress"} (owner or panel) or {state: "reviewed", result, learnings} (panel): `200`; `403 forbidden`, `409 invalid_transition`, `400 invalid_request`.
- Anything of another board answers `404`.

L8 (2026-11-13, T4 evidence): RED observed (5 interface tests failing), then GREEN: `npm test` 323 passed in 35 files, `npm run typecheck` and `npm run build` clean.
- On a board with a baseline, owner and panel see "Ciclo de mejora". Without a cycle: "Inicio", "Fin" and "Crear ciclo". With one: "Ciclo N · Planeado/Activo", its dates, "N de M focos", and a card per focus (current level and target level) with its experiments (state, result, expected result, learnings).
- While planned: "Nuevo foco" offers only placed capabilities that can still rise and only levels above the current one; "Quitar" a focus with confirmation; "Agregar experimento" per focus. A panel member sees "Iniciar ciclo" with confirmation; a refused start lists what is missing (no focus, too many, the focuses without experiment).
- While active: focuses stay; experiments can be added; owner or panel "Marcar en curso"; a panel member "Registrar revisión" with result (only "Descartado" for one that never ran) and learnings.
- Existing interface test fixtures gained the new board fields; their assertions did not change.

L9 (2026-11-13, independent verification at `e1a6115`, baseline `efc2c57`): S1–S8 PASS, no blockers; `npm test` 323 passed, `npm run typecheck` and `npm run build` clean in a scratch copy. Probes through the API and SQL as the API role confirmed invariant 8 (the maximum holds under six concurrent inserts; 15 races of "delete the last experiment" against "start" never left a focus without experiment), one open cycle under six concurrent creations, numbering 1 then 2, focus targets, experiment transitions, invariants 9 and 11; refused commands left the data unchanged; earlier endpoints answer as at the baseline apart from the new fields of L7. Advisories: a repeated focus on a full cycle answered `too_many_focuses` (handled below); the cycle lookups revealed a board id inside the organization (handled below); the owner can edit an experiment's text by direct SQL before its review (no route does it); a start refused for the board's state would answer `cycle_not_planned` (not reachable in this increment).

L10 (2026-11-13, review of T3 and T4; consent granted by the user): native review ended `approved` and was acknowledged. Handled in a follow-up commit, RED observed for the repeated focus (`too_many_focuses` instead of `already_focus`), then GREEN (`npm test` 323 passed, `npm run typecheck` clean):
- A repeated focus is named `409 already_focus` even on a full cycle.
- `app_board_of_cycle` and `app_board_of_focus` now answer only to people who see the board.
- Added route cases: a target level of another map (`422 invalid_target`), deleting a focus that is not of the cycle (`404`).
- The review warned that migration 0007 was edited after its first commit. It exists only on this branch and has run only in throwaway test databases; no shared or user database has applied it. Once merged it is never edited again.

L11 (2026-11-13, review of the whole increment; consent granted by the user): native review ended `approved` and was acknowledged. Handled, RED observed for the start on a closed board (answered `cycle_not_planned`), then GREEN (`npm test` 324 passed, `npm run typecheck` clean):
- Starting a cycle on a board that is not "calibrado" or "entre ciclos" answers `409 board_not_ready` instead of a cycle-state error.
- Added an interface test: a refused focus shows its message, and a successful change reloads the board.
