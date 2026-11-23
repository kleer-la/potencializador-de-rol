# Hypothesis of an experiment

Objective: every experiment has a field for its hypothesis, written when it is added and editable while it can be edited.
Branch: `feat/experiment-hypothesis`, from `feat/edit-focus-target` at `7ff7236` (PR #11, not merged yet: the edit form lives there). Delivery: one work-unit commit; push and merge are the user's decisions.
Test runner: `npm test` (Vitest; project `api` needs Docker), `npm run typecheck`, `npm run build --workspace @potencializador/web`.

## Specs

S1. Backlog (Planeado): "Necesitamos que cada experimento tenga un campo para escribir su hipótesis."
- An experiment has a hypothesis: free text, up to 2000 characters. Assumption: optional, as the expected result; existing experiments get an empty one.
- It is written when the experiment is added (`POST .../experiments`) and changed with the rest of its text (`PUT /api/boards/:boardId/experiments/:experimentId`), under the same rules: not once reviewed, not in a closed cycle.
- The board returns it with each experiment (`hypothesis`), in the current and the past cycles.

S2. Web: the forms to add and to edit an experiment have a "Hipótesis" field, first, before "Experimento" and "Resultado esperado" (user, 2026-11-23: "el campo de hipótesis debe ir antes que el de experimento"). An experiment with a hypothesis shows "Hipótesis: …".

## Tasks

- [x] T1 — Migration 0018 (column and grant), API input and board view, client, forms and experiment item, tests. Specs: S1–S2. Route: inline. Risk: item 1 (persisted format: new column on stored experiments, additive). Commit: `feat: add a hypothesis field to experiments`.

Route evidence: one behavior, about 120 changed lines; no writer reason.

## Log

L1 (2026-11-23, user, original request): "Necesitamos que cada experimento tenga un campo para escribir su hipótesis."

L2 (2026-11-23, context): pattern of migration `0015_experiment_observed_result.sql` (column `NOT NULL DEFAULT ''` plus column grant). Table-level `INSERT` on experiments exists since 0007.

L3 (2026-11-23, user correction): "el campo de hipótesis debe ir antes que el de experimento" — S2 rewritten; the hypothesis field goes first in both forms.

L4 (2026-11-23, T1 evidence): RED observed (route views without `hypothesis`, missing "Hipótesis" field and line), then GREEN: `npm test` 455 passed in 46 files, `npm run typecheck` clean, web build ok. The field-order assertion of L3 was written together with the reorder, so no separate RED for it. Local deployment rebuilt with migration 0018 applied.
