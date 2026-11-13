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
- [ ] T2 — Persistence: cycles, focuses, experiments; start function; guards (invariant 8, transitions, one open cycle); Row Level Security. Specs: S1–S6, S8. Route: inline. Risk: item 1 (schema), item 2 (access rules).
- [ ] T3 — API: cycle with the board, create cycle, focuses, experiments, start, experiment progress and review. Specs: S1–S6. Route: inline. Risk: item 2 (permissions).
- [ ] T4 — Web: current cycle on the board. Specs: S7. Route: inline. Risk: none (interface over the API).

Route evidence: each task builds on the previous one; no parallel writer applies.
Forecast: about 2,200 authored changed lines.

## Log

L1 (2026-11-13, user, original request): "Adelante" — answer to: "Siguiente en el plan: incremento 5, ciclos, focos y experimentos (invariante 8 ...). Cuando quieras, armo su documento de especificación primero."

L2 (2026-11-13, context): row 5 of the approved build plan, covering invariant 8. Migrations up to 0006 are on `main`; this increment adds migration 0007 and edits none. `programs.max_focuses` exists since migration 0004 (default 3, configurable 1 to 20).

L3 (2026-11-13, assumptions): those marked in S1–S4 and S6 were taken without asking; each can change later without redoing the rest. Mentoring sessions and evidence go to increment 6, closing a cycle with its snapshot to increment 7.

L4 (2026-11-13, T1 evidence): RED observed (`cycle.ts` missing), then GREEN: unit project 100 passed, `npm run typecheck` clean. Rules: `canPlanCycle` (owner or panel, after the baseline), `canStartCycle` and `canReviewExperiment` (panel), `remainingFocuses`, `startBlockers` (no focus, too many, focuses without experiment), `isValidTarget` (above a current level), `canMoveExperiment` (planned → in progress → reviewed with result, only in an active cycle; a planned one only as discarded).
