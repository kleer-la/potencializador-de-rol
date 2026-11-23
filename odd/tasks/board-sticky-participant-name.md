# Participant name stays visible on the board

Objective: whoever opens a participant's board sees the participant's name at the top, and it stays visible while scrolling down.
Branch: `feat/board-sticky-participant-name`, from `main` at `629d923`. Delivery: one commit; merge, push and deploy are the user's decisions.
Test runner: `npm test` (Vitest), `npm run typecheck`.

## Specs

S1. User's request: "Quiero que el mentor o el líder o el especialista cuando estén viendo el tablero de un participante, puedan ver el nombre del participante en la parte superior del tablero, y que se conserve visible cuando hagan scroll down"

S2. Rules (assumptions, not stated by the user):
- The board view already shows "Tablero de {ownerName}" in `.board-header`; the change makes that header sticky at the top of the viewport, for every viewer (owner included).
- The header stays on one line (long program names truncate) so its height is constant and the board frame fits below it without hiding the frozen level headings.

## Tasks

- [x] T1 — Sticky `.board-header` and board frame height adjusted. Specs: S1-S2. Route: inline (CSS only; jsdom cannot assert sticky layout). Risk: none. Browser check: passed (user, 2026-11-23).

## Log

L1 (2026-11-23, user, original request): see S1.

L2 (2026-11-23, verification): `npm run typecheck` clean; web Vitest 97/97 passed. User confirmed in the browser (local Docker web rebuilt) that the name stays visible while scrolling.
