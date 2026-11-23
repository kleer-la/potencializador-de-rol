# Past improvement cycles on the board

Objective: the board's "Ciclo de mejora" section shows the cycles that already closed, with their focuses and the experiments run in them.
Branch: `feat/past-cycles-on-board`, from `main` at `34d9cb3`. Delivery: one work-unit commit; merge, push and deploy are the user's decisions.
Test runner: `npm test` (Vitest; project `api` needs Docker), `npm run typecheck`.

## Specs

S1. User's request (backlog, docs/Backlog.md): "En ninguna parte se ven los ciclos de mejora que ya ocurrieron ni los focos que tuvieron ni los los experimentos que se ejecutaron en ellos, quiero que eso sea visible en el tablero, en la sección de ciclos de mejora"

S2. Rules (assumptions derived from S1, not stated by the user):
- The board API adds `pastCycles`: the board's closed cycles, newest first, each with the same shape as `cycle` (focuses in map order, experiments oldest first, with state, result, observed result and learnings). Empty when none closed. Anyone who can read the board reads it.
- In "Ciclo de mejora", below the current cycle or the new-cycle form, a "Ciclos anteriores" block lists each closed cycle collapsed ("Ciclo N · Cerrado · del X al Y"); opening it shows its focuses (current and target level) and their experiments, read-only.

## Tasks

- [x] T1 — API `pastCycles`, web client type, "Ciclos anteriores" in the cycle section, tests. Specs: S1-S2. Route: inline (one small behavior; no writer reason). Risk: none (additive response field; the open-cycle read keeps its output, now through a shared `readCycle`). Commit: the one that adds this document (see Log L3).

## Log

L1 (2026-11-23, user): "En ninguna parte se ven los ciclos de mejora que ya ocurrieron ni los focos que tuvieron ni los los experimentos que se ejecutaron en ellos, quiero que eso sea visible en el tablero, en la sección de ciclos de mejora"

L2 (2026-11-23): RED observed (API closing test: `pastCycles` missing; web: no "Ciclos anteriores" region). GREEN: `readOpenCycle` split into `readCycle` plus `readPastCycles`; board body adds `pastCycles`; `PastCycles` reuses `FocusCard`, which is read-only for a closed cycle. `npm run typecheck` clean, `npm test` 46 files / 447 tests passed. Conceptual base 6.2 step 6 updated. No migration.

L3 (2026-11-23, user): "funciona, haz commit" — verified on the local stack after rebuilding api and web; committed as one work unit.
