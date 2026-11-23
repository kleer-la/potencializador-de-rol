# Edit the target level of a focus

Objective: owner and panel change the target level of a focus while its cycle is planned or active; adding and removing focuses stays limited to a planned cycle.
Branch: `feat/edit-focus-target`, from `main` at `4cc9072`. Delivery: one work-unit commit; push and merge are the user's decisions.
Test runner: `npm test` (Vitest; project `api` needs Docker), `npm run typecheck`, `npm run build --workspace @potencializador/web`.

## Specs

S1. Backlog (Planeado): "Que se puedan modificar los focos de un ciclo. Permitamos esa posibilidad. Y también dejar abierta la cantidad de focos." The open number of focuses is already done (`focuses-above-recommended`). User, 2026-11-23, choice: "Editar nivel en ambos" — "Cambiar solo nivel objetivo, en planeado y activo. Agregar/quitar sigue solo en planeado."
- The target level of a focus changes while its cycle is planned or active. It never changes in a closed cycle.
- The new target keeps the existing rule: a level of the program map, above the capability's current level.
- A focus never changes cycle or capability. Adding and removing focuses stays limited to a planned cycle.
- Assumption: who changes the target is who plans the cycle (owner and panel, `canPlanCycle`), in both states.

S2. API: `PATCH /api/boards/:boardId/cycles/:cycleId/focuses/:focusId` {targetLevelId}: `200`; `403 forbidden`; `422 invalid_target`; `409 cycle_closed`; `404` for a focus of another cycle or board.

S3. Web: on a focus card of a planned or active cycle, owner and panel see "Cambiar objetivo", choose a level above the current one, and save.

S4. User, 2026-11-23: "y también puedo cambiar los experimentos dentro de ese ciclo?" — answer "si" to: "editar descripción y resultado esperado mientras el experimento no esté revisado y el ciclo no esté cerrado".
- Owner and panel edit the description and the expected result of an experiment while it is not reviewed and its cycle is not closed. Same limits as adding one (description 1 to 2000 characters, expected result up to 2000).
- `PUT /api/boards/:boardId/experiments/:experimentId` {description, expectedResult}: `200`; `403 forbidden`; `409 experiment_final` (reviewed); `409 cycle_closed`; `400 invalid_request`; `404` for an experiment of another board.
- Web: an "Editar" action on each experiment that is not reviewed opens a form with both fields, "Guardar" and "Cancelar".
- Experiments are still not deleted once the cycle started (invariant 8); no change there.

## Tasks

- [x] T1 — Migration 0017 (guard lets the target change while active), route, client, focus card, tests. Specs: S1–S3. Route: inline. Risk: item 1 (guard of stored focuses), item 2 (guard). Commit: `feat: edit focus targets and experiments during a cycle` (T1 and T2 together; they share route, client and focus card files).
- [x] T2 — Edit the text of an experiment: route, client, experiment item, tests; no migration (grant and guard of 0007 and 0009 already allow it). Specs: S4. Route: inline. Risk: item 2 (permissions of a new write route). Commit: `feat: edit focus targets and experiments during a cycle` (T1 and T2 together; they share route, client and focus card files).

Route evidence: one behavior, about 200 changed lines; no writer reason.

## Log

L1 (2026-11-23, user, original request): "Quiero que se puedan modificar los focos de un ciclo"

L2 (2026-11-23, context): grant `UPDATE (target_level_id) ON focuses` and policy `focuses_update` exist since migration 0007; only `guard_focus()` (last defined in 0016) refuses every change outside a planned cycle.

L3 (2026-11-23, T1 evidence): RED observed (storage, route and web tests failing on `the focuses of a cycle change only while it is planned`, `404` and the missing control), then GREEN: `npm test` 451 passed in 46 files, `npm run typecheck` clean, web build ok.
- Migration `0017_focus_target_while_active.sql` redefines `guard_focus()`: insert and delete only while planned; update (target level) while planned or active, refused once closed (`PM050`); `created_by` and `created_at` kept on update. Changing the capability stays out of reach by the column grant (`permission denied`).
- `PATCH .../cycles/:cycleId/focuses/:focusId` {targetLevelId}: `200`; `403 forbidden`, `404`, `409 cycle_closed`, `422 invalid_target`, `400 invalid_request`.
- Web: "Cambiar objetivo" select and "Guardar objetivo" on each focus of a planned or active cycle, when more than one level lies above the current one. The start confirmation and the `cycle_not_planned` message now say focuses are no longer added or removed.

L4 (2026-11-23, user): "y también puedo cambiar los experimentos dentro de ese ciclo?" then "si" (see S4).

L5 (2026-11-23, T2 evidence): RED observed (route `404`, closed cycle `404` instead of `409 cycle_closed`, missing "Editar" button), then GREEN: `npm test` 454 passed in 46 files, `npm run typecheck` clean, web build ok.
- `PUT /api/boards/:boardId/experiments/:experimentId` reuses `experimentInput` (same limits as adding one); `404` before `403`, as the other experiment route; database `PM050` maps to `experiment_final`.
- Web: "Editar «description»" on every experiment not reviewed of a planned or active cycle; the form has "Experimento", "Resultado esperado", "Guardar" and "Cancelar"; new message `experiment_final`.
