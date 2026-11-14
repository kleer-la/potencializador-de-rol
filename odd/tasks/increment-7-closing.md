# Increment 7 — Closing, recalibration, score and evolution

Objective: close cycles with a snapshot, recalibrate between cycles, close a board, and show the maturity score with its breakdowns and its evolution across snapshots, never comparing people.
Branch: `feat/increment-7-closing`, from `main` at `3930dd0`. Delivery: work-unit commits; merge and push are the user's decisions.
Test runner: `npm test` (Vitest; project `api` needs Docker), `npm run typecheck`, `npm run build --workspace @potencializador/web`.
Conceptual base: `docs/Potencializador de rol — Base conceptual del sistema.md` ("the document").

## Specs

S1. Score. Document §5.2: "El puntaje es la suma, capacidad por capacidad, del multiplicador de su nivel más sus bonificaciones. La dificultad se muestra, pero no pondera el puntaje." "Una capacidad sin ubicar suma cero." "Como cada participante tiene su propia selección de capacidades, el máximo posible es distinto para cada tablero. Al agregar capacidades ese máximo crece, así que cada fotografía guarda cuántas capacidades tenía el tablero." Example: 10 capabilities, levels 0×2, 1×3, 2×3, 3×1, 4×1 and one AI bonus of +1 give "**17**"; "El máximo de ese tablero sin bonificaciones es 40 (10 capacidades en nivel 4)."
- Score of a board = Σ (multiplier of the capability's level, 0 when unplaced) + Σ extra points of its approved bonuses. Maximum without bonuses = number of capabilities × the highest multiplier of the scale.
- The example of §5.2 is a unit test.

S2. How the score is shown. Document §5.3: "El total siempre va junto a su evolución entre fotografías (línea base, cierres de ciclo, hoy)." "Se desglosa por dimensión, para ver dónde están las brechas." "Se desglosa por dificultad, para que sea visible si el avance viene solo de capacidades fáciles."
- Owner and panel see today's total with the maximum and the number of capabilities, its evolution (baseline, each recalibration and cycle close, today) with the change from the previous point, and today's breakdown by dimension and by difficulty.
- Assumption: the baseline point is computed from the baseline entries (each capability added later counts with its initial level) and carries no bonuses, since none exist before the baseline.

S3. Snapshots. Document §4.3: "`Snapshot` | fecha, tipo (línea base, recalibración, cierre de ciclo), copia de ubicaciones, cantidad de capacidades, puntaje | pertenece a un tablero; sus entradas no se editan".
- Closing a cycle and recalibrating each record a snapshot: date, type, one entry per capability on the board (level, multiplier, bonus points), the number of capabilities and the score. Nothing of it is ever edited or deleted.
- The baseline keeps living in its entries (increment 4); it is not copied again.

S4. Closing a cycle. Document §6.2 step 6: "**Cierre del ciclo.** Se toma una fotografía del tablero y se compara con la anterior." Document §6.3: "Ciclo | planeado → activo → cerrado"; "Tablero | ... en ciclo ⇄ entre ciclos → cerrado".
- A panel member closes the active cycle: the cycle becomes "cerrado", the board "entre ciclos", and a snapshot of type "cierre de ciclo" is recorded.
- Assumption: experiments not reviewed stay as they were; a closed cycle no longer changes.

S5. Recalibration. Document §6.2 step 7: "Una recalibración completa (paso 2) es opcional al iniciar un ciclo; produce una fotografía y no reemplaza la línea base." Invariant 4: "Hay dos excepciones, que también quedan como `LevelChange` con quién las aprobó: la nivelación inicial de una capacidad agregada y los niveles acordados en una recalibración." Document §9.1: "Un nivel puede bajar, pero solo en una recalibración".
- While the board is "entre ciclos", a panel member records a recalibration: date, attendees, notes, and an agreed level for every capability on the board; levels may go down.
- Assumption: the attendance rule of the calibration applies (the participant and the program's mandatory panel roles).
- Each capability whose level changes gets a level change with reason "recalibración" and who approved it; a snapshot of type "recalibración" is recorded. The baseline does not change.
- Assumption: at most one recalibration while the board is between two cycles.
- User decision (2026-11-13): recalibration and closing the board are part of this increment ("Incluir ambos").

S6. Closing a board. Document §6.3: "Tablero | ... → cerrado".
- Assumption: a panel member closes a board that is "entre ciclos" or "calibrado" (no cycle open); once closed nothing on it changes: no cycles, capabilities, levels, evidence, proposals, decisions, bonuses or sessions. Owner and panel keep reading it.

S7. Invariant 9. Document §5.1: "**Sin comparación entre personas.** No existen rankings ni vistas que ordenen participantes por puntaje. Un tablero lo ven su dueño y su panel."
- The score is part of a board only; lists of boards and program views carry no score. Tests titled `INV-9`.

S8. Web interface (Spanish, design system).
- "Puntaje de madurez" on a board with a baseline: total and maximum, evolution table, breakdown by dimension and by difficulty; the difficulty is shown, not weighted.
- A panel member closes the active cycle (with confirmation), records a recalibration while between cycles, and closes the board (with confirmation).

S9. Automated coverage. User: "Las invariantes de la sección 5.1 deben quedar cubiertas por pruebas automatizadas." This increment covers the recalibration exception of invariant 4 and the ranking part of invariant 9, and extends 3 (baseline unchanged by a recalibration) and 11.

## Tasks

- [x] T1 — Domain rules: score, maximum, breakdowns, evolution; who closes and recalibrates. Specs: S1, S2, S4–S6, S9. Route: inline. Risk: none (new pure code). Commit: `feat: domain rules of the score, closing and recalibration` (see L5).
- [ ] T2 — Persistence: snapshots and their entries; close cycle, recalibrate and close board functions; closed-board guards; Row Level Security. Specs: S3–S7, S9. Route: inline. Risk: item 1 (schema, level_changes reason), item 2 (access rules).
- [ ] T3 — API: score and evolution with the board; close cycle, recalibrate, close board. Specs: S1–S7. Route: inline. Risk: item 2 (permissions).
- [ ] T4 — Web: score, evolution, breakdowns; close cycle, recalibration, close board. Specs: S8. Route: inline. Risk: none (interface over the API).

Route evidence: each task builds on the previous one; no parallel writer applies.
Forecast: about 3,000 authored changed lines.

## Log

L1 (2026-11-13, user, original request): "vamos" — answer to: "El último incremento del plan es el 7: cierre de ciclo con su fotografía, puntaje de madurez ... y la evolución entre línea base, cierres de ciclo y hoy."

L2 (2026-11-13, user decision): question on scope (recalibration and closing the board); answer: "Incluir ambos".

L3 (2026-11-13, context): row 7 of the approved build plan. Migrations up to 0008 are on `main`; this increment adds migration 0009 and edits none. `level_changes` allows reasons `calibration`, `initial_leveling`, `evidence`; migration 0009 adds `recalibration`.

L4 (2026-11-13, assumptions): those marked in S2 and S4–S6 were taken without asking; each can change later without redoing the rest.

L5 (2026-11-13, T1 evidence): RED observed (`score.ts` missing), then GREEN: unit project 128 passed, `npm run typecheck` clean. `computeScore` reproduces the example of §5.2 (17 of 40 for 10 capabilities) and breaks the score down by dimension and by difficulty without weighting; `withChanges` adds the change from the previous point; `canCloseCycle`, `canRecalibrate` (between cycles) and `canCloseBoard` (calibrated or between cycles) are for a panel member.
