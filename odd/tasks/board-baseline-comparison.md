# A board compares its baseline with its current state

Objective: once the baseline exists, a board shows the baseline beside the current level of each capability, and its sections follow the order the user asked for.
Branch: `feat/board-baseline-comparison`, from `main` at `a91282c`. Delivery: work-unit commits; merge, push and deploy are the user's decisions.
Test runner: `npm test` (Vitest; project `api` needs Docker), `npm run typecheck`.

## Specs

S1. User's request: "En un Tablero necesito una forma de visualización que presente la comparativa entre la línea base y el nivel al que ha llegado con los cambios de nivel. Puede ser el mismo tipo de vista que muestra la autoevaluación vs la línea base acordada. De hecho, esa vista ya no se requiere una vez la línea base se ha acordado, por lo que la podemos quitar y poner la nueva que estoy pidiendo en su lugar."

S2. User's order: "1. Comparativa Línea Base vs Estado actual 2. Puntaje de Madurez 3. Ciclos de Mejora 4. Evidencias 5. Cambios de nivel. 6. Mentorías (serían sólo para Mentor o líder o especialista) 7. Opción de cerrar tablero 8. Capacidades del mapa que no están en el tablero."

S3. Proposal approved by the user (2026-11-23, "adelante"):
- Board grid, once the baseline exists: `● estado actual · ○ línea base` replaces `○ autoevaluación`. Before the baseline the grid stays as it is (the calibration needs it).
- The "Línea base" section becomes "Línea base vs estado actual": a table Línea base / Actual / Diferencia, without the self-assessment column.
- Order: comparison (grid and table), Calibración and Capacidades por nivelar only when they apply, Puntaje, Ciclo, Evidencias, Cambios de nivel, Bonificaciones, Recalibración, Mentorías, Cerrar tablero, Capacidades fuera del tablero.
- Mentorías is hidden from the board's owner (the participant).

S4. User decision (2026-11-23): "Me está sobrando la tabla "Línea base vs estado actual", la que es en modo Kanban ya presenta esa información." Approved replacement ("sí, impleméntalo así"): the table and its heading go away; under the grid legend, a short note "Línea base fijada en la calibración del <fecha> · Asistieron: <nombres>", with collapsible "Notas de la calibración" (only when there are notes) and "Agregadas después: N" (only when there are capabilities added after the baseline, each with its initial level and date).

## Tasks

- [x] T1 — Web only: grid markers, comparison table, section order, mentoring hidden from the owner, tests. Specs: S1-S3. Route: inline (one behavior; no writer reason). Risk: none (web display only; data already served: `placements` hold the current level, `baseline.entries` the fixed baseline). Commit: see L4.

- [x] T2 — Replace the comparison table with the baseline note under the legend. Specs: S4. Route: inline. Risk: none (web display only). Commit: see L6.

## Log

L1 (2026-11-23, user, original request): see S1 and S2.

L2 (2026-11-23, user approval of the proposal): see S3.

L3 (2026-11-23, analysis): approved level changes (migration 0008) and recalibrations (0006, 0009) update `placements.level_id`, so `placements` is the current state; `baseline.entries` never change (invariant 3). No API change needed. Hiding Mentorías from the owner is a display rule; the API still sends `mentoringSessions` to the owner.

L4 (2026-11-23, T1 evidence): RED observed first (5 failing for the expected reason: missing region "Línea base vs estado actual", missing "Línea base" marker, Mentorías shown to the owner). GREEN: `npm test` 430 passed in 46 files, `npm run typecheck` clean. `EvidenceSections` split into `EvidenceSection`, `LevelChangesSection`, `BonusesSection`, `MentoringSection` so the board orders them; `BaselineSummary` renamed `BaselineComparison`.

L5 (2026-11-23, user): see S4.

L6 (2026-11-23, T2 evidence): RED observed (4 failing: missing group "Contexto de la línea base"). GREEN: `npm test` 431 passed in 46 files, typecheck clean. Checked in Chrome on the rebuilt web container (board of Leo Prueba): legend and note together above the grid, table gone. Section `BaselineComparison` replaced by `BaselineNote`; no CSS change.
