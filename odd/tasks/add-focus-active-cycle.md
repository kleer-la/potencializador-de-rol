# Add focuses to an active improvement cycle

Objective: owner and panel add focuses to an improvement cycle that already started, not only while it is planned.
Branch: `feat/add-focus-active-cycle`, from `main` at `0a2cf73`. Delivery: one work-unit commit; merge, push and deploy are the user's decisions.
Test runner: `npm test` (Vitest; project `api` needs Docker), `npm run typecheck`.

## Specs

S1. User's request (backlog, docs/Backlog.md): "Quiero poder agregar focos a un ciclo de mejora iniciado"

S3. User's follow-up: "quiero poder quitar un foco agregado durante el ciclo mientras no tenga experimentos"
- In an active cycle a focus without experiments can be removed (only a focus added during the cycle can lack one: every focus had an experiment at start and experiments are not deleted while active). A focus with experiments answers `409 focus_has_experiments`. A closed cycle answers `409 cycle_closed`.
- The web shows "Quitar" on such a focus in an active cycle.

S2. Rules (assumptions derived from S1, not stated by the user):
- A focus is added while its cycle is planned or active, never once it is closed. Same validation as today: a placed capability, a target above its current level, one focus per capability.
- Removing a focus: see S3 (superseded the first assumption that an active cycle keeps every focus).
- Adding to a closed cycle answers `409 cycle_closed`.
- The web shows "Nuevo foco" (with the recommended-number warning) in an active cycle too; the start prompt and the refusal copy stop saying focuses are not added during the cycle.
- The database guard (`guard_focus`) enforces the same rule.

## Tasks

- [x] T2 — Remove a focus without experiments from an active cycle (migration 0023, DELETE route, web, copy, tests, conceptual base). Specs: S3. Route: inline. Risk: item 1 (same `guard_focus` migration). Commit: the one that adds this document (see Log L5).
- [x] T1 — Migration 0023, API route, web form and copy, tests, conceptual base. Specs: S1-S2. Route: inline (one understood behavior; no writer reason). Risk: item 1 (migration replaces `guard_focus`; no stored data changes). Commit: the one that adds this document (see Log L5).

## Log

L1 (2026-11-23, user): "Quiero poder agregar focos a un ciclo de mejora iniciado"

L2 (2026-11-23): RED observed (API: adding to an active cycle answered `cycle_not_planned`, closed cycle did not answer `cycle_closed`; storage: guard raised PM050 before the uniqueness check; web: no "Nuevo foco" in an active cycle, old start prompt). GREEN: migration 0023 lets `guard_focus` insert while planned or active and delete only while planned; the POST route answers `cycle_closed` for a closed cycle; `NewFocus` shows for any open cycle; start prompt, `cycle_not_planned` copy and empty-experiments hint updated; conceptual base invariant 8 updated. `npm run typecheck` clean, `npm test` 49 files / 474 tests passed.

L3 (2026-11-23, user): "quiero poder quitar un foco agregado durante el ciclo mientras no tenga experimentos"

L4 (2026-11-23): RED observed (API: delete in active cycle answered `cycle_not_planned`; web: no "Quitar" on an experiment-less focus of an active cycle). GREEN: `guard_focus` (still migration 0023, uncommitted) deletes while planned, or while active without experiments (PM051); the DELETE route answers `focus_has_experiments` (PM051, or PM008 when an experiment joined in between and the cascade hits its guard) and `cycle_closed` for a closed cycle. `npm run typecheck` clean, `npm test` 49 files / 474 tests passed.

L5 (2026-11-23, user): "funciona, haz commit" — verified on the local stack after rebuilding (migration 0023 applied); committed as one work unit.
