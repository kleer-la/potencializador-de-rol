# Marks on the capabilities of a board

Objective: the owner and the panel mark capabilities of a board as candidates for the short/medium term and as work in progress (WIP), from a catalog of marks that can grow.
Branch: `feat/capability-marks`, from `main` at `6e52cc0`. Delivery: one work-unit commit; push and merge are the user's decisions.
Test runner: `npm test` (Vitest; project `api` needs Docker), `npm run typecheck`, `npm run build --workspace @potencializador/web`.

## Specs

S1. Backlog (To Do): "Quiero que se puedan marcar ciertas capacidades observables, como candidatas a ser trabajadas en en corto/mediano plazo. Con algún tipo de etiqueta, estrella, tag o similar."
- A capability on a board (a placement) can carry the mark `candidate`, shown as "★ Candidata".

S2. Backlog (To Do): "Y quiero otro tipo de marca (por capacidad observable) que indique que está WIP (se le está trabajando en este momento). Puede que a futuro aparezcan nuevas marcas/etiquetas."
- A capability on a board can carry the mark `wip`, shown as "WIP". Marks are independent: one capability may carry both.
- Marks come from one catalog (`candidate`, `wip`) kept in the domain package and in a database CHECK; a new mark is one more catalog entry plus its label.

S3. User decision (2026-11-23): "participante y panel, pero la de WIP no se debería poder quitar si algún experimento está trabajándose para mejorar esa capacidad observable".
- The owner and their panel put and take off marks; a program leader who only reads the board and anyone else cannot. Everyone who reads the board sees them.
- The `wip` mark cannot be taken off while an experiment in state `in_progress` belongs to a focus on that capability in a cycle of the board that is not closed. Refusal: 409 `wip_in_progress`, also enforced by a database guard.
- Assumption: marks can change in any board status except `closed` (the board is read-only once closed, as everything else).

S4. API: `PUT /api/boards/:boardId/capabilities/:capabilityId/marks/:mark` puts a mark (idempotent, 204); `DELETE` on the same path takes it off (204, idempotent). 404 when the capability is not on the board, 400 for an unknown mark, 403 for someone who is not the owner or on the panel. The board returns `marks` with each placement and `viewer.canMark`.

S5. Web: on the board table, each capability shows its marks as tags and, for those who can mark, toggle buttons "★ Candidata" and "WIP" (`aria-pressed`). The WIP toggle is disabled while it cannot be taken off, with the reason "Hay un experimento en curso para esta capacidad".

## Tasks

- [x] T1 — Migration 0019 (table, RLS, guard), domain catalog and permission, API routes and board view, client, board table toggles, tests. Specs: S1–S5. Route: inline. Risk: item 2 (new write policy on a board); the new table is additive. Commit: `feat: mark capabilities of a board as candidate or WIP`.

Route evidence: one behavior, about 300 changed lines; no writer reason.

## Log

L1 (2026-11-23, user, original request): "Quiero que se puedan marcar ciertas capacidades observables, como candidatas a ser trabajadas en en corto/mediano plazo. Con algún tipo de etiqueta, estrella, tag o similar. Y quiero otro tipo de marca (por capacidad observable) que indique que está WIP (se le está trabajando en este momento). Puede que a futuro aparezcan nuevas marcas/etiquetas."

L2 (2026-11-23, user decision on who marks): "participante y panel, pero la de WIP no se debería poder quitar si algún experimento está trabajándose para mejorar esa capacidad observable".

L3 (2026-11-23, context): a card is a `placements` row (board + capability, unique). Read policies use `app_reads_board` since 0012 (program leader reads); write policies use `app_sees_board` (owner or panel), as evidence does. `openBoard` already refuses writes on a closed board (`board_closed`).

L4 (2026-11-23, T1 evidence): RED observed against the base files (API: 5 of 5 new route tests failed with the base `boards.routes.ts`; web: 3 of 3 new board tests failed with the base `BoardsPage.tsx`; domain: missing module). GREEN: `npm test` 470 passed in 49 files (one existing exact-viewer assertion updated with `canMark: true`), `npm run typecheck` clean, web build ok. Local deployment rebuilt; migration 0019 applied.

L5 (2026-11-23, independent verification): PASS on S1–S5, no blockers. DB probes with the app role: program leader, other participant and another organization refused by RLS; forged `marked_by` overwritten; UPDATE refused; cascade on enrollment deletion passes the guard; closed board PM050. Advisory A1 (DELETE of an absent `wip` with an experiment in progress answered 409, against S4's idempotent 204) fixed: the route returns 204 when the mark is not there; pinned by a test (RED without the fix: 2 failed; GREEN: `npm test` 470 passed). A2 (moved doc comment in `copy.ts`) fixed. A3 (READ COMMITTED race on the WIP check) and A4 (one PM050 code for two guard causes) accepted as advisories.
