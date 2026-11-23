# Observed result of an experiment

Objective: when the panel reviews an experiment, it records what happened (facts and data) in an open field, next to the existing learnings.
Branch: `feat/experiment-observed-result`, from `main` at `7ba4cb1`. Delivery: one work-unit commit; merge, push and deploy are the user's decisions.
Test runner: `npm test` (Vitest; project `api` needs Docker), `npm run typecheck`.

## Specs

S1. User's request (backlog, docs/Backlog.md): "Sobre cierre de un experimento, en Resultado quiero que sea un campo abierto para registrar qué pasó (hechos y datos) y el otro campo de aprendizajes que ya existe"

S2. User decision (2026-11-23): "agregar" — keep the closed choice (consolidated / not consolidated / discarded) and add the open field.

S3. Rules (assumptions derived from S1 and S2, not stated by the user):
- The closed choice keeps its values and rules; its label changes from "Resultado" to "Conclusión".
- The new open field is labeled "Resultado" (help text: what happened, facts and data), optional like "Aprendizajes", at most 5000 characters, recorded only with the review.
- The experiment shows "Resultado: …" before "Aprendizajes: …" once recorded.
- Existing reviewed experiments get an empty result.

## Tasks

- [x] T1 — Migration 0015 (column `observed_result`), API move and read, web form and display, tests. Specs: S1-S3. Route: inline (one small behavior; no writer reason). Risk: item 1 (new column on an existing table, additive with default). Commit: see Log L3.

## Log

L1 (2026-11-23, user): "Sobre cierre de un experimento, en Resultado quiero que sea un campo abierto para registrar qué pasó (hechos y datos) y el otro campo de aprendizajes que ya existe"

L2 (2026-11-23, user): "agregar"

L3 (2026-11-23): RED observed in the three focused tests (route, storage, web form). GREEN: `npm run typecheck` clean, `npm test` 46 files / 444 tests passed. Conceptual base updated (Experiment attributes).
