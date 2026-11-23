# A cycle closes only with every experiment reviewed

Objective: closing an improvement cycle is refused while any of its experiments is not reviewed, naming them, so no experiment stays planned or in progress forever in a closed cycle.
Branch: `feat/close-cycle-reviewed`, from `feat/capability-marks` at `4ce1355` (not merged yet: the local deployment needs both). Delivery: one work-unit commit; push and merge are the user's decisions.
Test runner: `npm test` (Vitest; project `api` needs Docker), `npm run typecheck`, `npm run build --workspace @potencializador/web`.

## Specs

S1. User decision (2026-11-23): "sí, bloquea el cierre hasta que todo esté revisado"
- `POST /api/boards/:boardId/cycles/:cycleId/close` answers 422 `{ error: 'cannot_close', unreviewed: [experimentId, ...] }` while any experiment of the cycle is `planned` or `in_progress`, in focus then creation order. The database function `app_close_cycle` repeats the check under its lock (PM008, answered as 409 `cycle_changed`).
- A planned experiment that never ran can be reviewed as discarded (existing rule), so the panel can always close.
- Cycles already closed keep their experiments as they are (no data change).

S2. Web: the close confirmation says every experiment must be reviewed; a refused close lists the experiments still to review, by description and capability, as the start refusal does.

## Tasks

- [x] T1 — Domain rule, migration 0021 (`app_close_cycle` check), route, web refusal and prompt, tests (new and existing fixtures that closed cycles with unreviewed experiments). Specs: S1–S2. Route: inline. Risk: none (the close-cycle contract change is the requested one; recalibration and board closing untouched). Commit: `feat: close a cycle only once every experiment is reviewed`.

Route evidence: one behavior, about 150 changed lines; no writer reason.

## Log

L1 (2026-11-23, context): `app_close_cycle` (0009:179) only checks panel and active state; `experiments_closed_cycle` (0009:115) freezes experiments of a closed cycle, so unreviewed ones stayed planned or in progress forever, and their WIP mark stayed on (advisory of capability-marks L8).

L2 (2026-11-23, user decision): "sí, bloquea el cierre hasta que todo esté revisado"

L3 (2026-11-23, T1 evidence): RED observed (API route and SQL function: 2 failed; web: 2 failed), then GREEN: `npm test` 472 passed in 49 files, `npm run typecheck` clean, web build ok. The existing closing test that pinned a planned experiment inside a closed cycle now reviews both experiments first. Message `cycle_changed` made generic ("mientras se guardaba"), since closing now answers it too.
