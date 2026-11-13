# Increment 3 — Self-assessment

Objective: each participant places every capability of their board in a level according to their own perception, saves drafts, and submits it once; their panel sees it for the calibration; it never counts as baseline or score.
Branch: `feat/increment-3-self-assessment`, from `main` at `d46c013`. Delivery: work-unit commits; merge and push are the user's decisions.
Test runner: `npm test` (Vitest; project `api` needs Docker), `npm run typecheck`, `npm run build --workspace @potencializador/web`.
Conceptual base: `docs/Potencializador de rol — Base conceptual del sistema.md` ("the document").

## Specs

S1. What a self-assessment is. Document §3: "Autoevaluación | `SelfAssessment` | Ubicación propuesta por el participante según su percepción." Document §4.2: "`SelfAssessment` | fecha, niveles propuestos por capacidad | pertenece a un tablero". Document §6.2: "1. **Autoevaluación.** El participante ubica cada capacidad en un nivel según su percepción."
- The owner of a board proposes one level of the program's scale for each capability on the board.
- They can save a draft and come back to it; they submit it once.
- Assumption: submitting needs a level for every capability on the board; the answer names the ones missing.
- Assumption: one self-assessment per board. Once submitted it never changes; a later recalibration (increment 4) works from it.

S2. Invariant 2. Document §5.1: "**La autoevaluación no es línea base.** Es una propuesta del participante y no genera puntaje oficial."
- A self-assessment never changes the board's placements (their level stays as it was, unplaced until the calibration) and no score comes from it.
- Enforced in the database: self-assessment levels live in their own table, and submitting changes only the self-assessment and the board's state.
- Tests are titled `INV-2`.

S3. Board state. Document §6.3: "Tablero | sin iniciar → autoevaluado → calibrado (con línea base) → en ciclo ⇄ entre ciclos → cerrado".
- Submitting moves the board from "sin iniciar" to "autoevaluado"; nothing else moves it in this increment.

S4. Who writes and who sees. Document §1, principle 2: "La autoevaluación es solo el punto de partida". Document §6.2 step 2: "El panel contrasta cada ubicación con casos reales". Invariant 9: "Un tablero lo ven su dueño y su panel."
- Only the owner writes their self-assessment; nobody writes it for them, and a panel member cannot change it.
- Assumption: the panel sees it once submitted; a draft is the owner's only.
- Nobody outside the owner and their panel sees it, in the API or the database (invariant 9 applies to it as to placements).

S5. Isolation. Document §5.1 invariant 11: new tables have `organization_id` and Row Level Security. Tests titled `INV-11` cover them.

S6. Web interface (Spanish, design system).
- The owner of a board that is "sin iniciar" sees the board with one choice per capability across the levels, a count of how many are placed, "Guardar borrador" and "Enviar autoevaluación" (with confirmation that it cannot be changed afterwards and that the panel will see it).
- The page says plainly that the self-assessment is a proposal, not the baseline, and gives no score.
- The panel sees the submitted self-assessment on the board, marked apart from the official level.

S7. Automated coverage. User: "Las invariantes de la sección 5.1 deben quedar cubiertas por pruebas automatizadas." This increment covers invariant 2 and extends 9 and 11.

## Tasks

- [x] T1 — Domain rules: who self-assesses, what is missing to submit. Specs: S1, S4, S7. Route: inline. Risk: none (new pure code). Commit: `feat: domain rules of the self-assessment` (see L4).
- [ ] T2 — Persistence: self-assessments and their levels, submission function, Row Level Security, database guards. Specs: S1–S5, S7. Route: inline. Risk: item 1 (schema), item 2 (access rules). Commit: —
- [ ] T3 — API: read with the board, save draft, submit. Specs: S1–S5. Route: inline. Risk: item 2 (permissions). Commit: —
- [ ] T4 — Web: self-assessment on the board, panel view. Specs: S6. Route: inline. Risk: none expected. Commit: —

Route evidence: each task builds on the previous one; no parallel writer applies.
Forecast: about 1,800 authored changed lines.

## Log

L1 (2026-11-13, user, original request): "adelante" — answer to: "Lo siguiente del plan es el incremento 3, la autoevaluación ... Cuando quieras empezar, armo su documento de especificación primero".

L2 (2026-11-13, context): row 3 of the approved build plan: "Autoevaluación", covering invariant 2. Migration 0004 is on `main` and may already be applied on the user's machine, so this increment adds migration 0005 and edits none.

L3 (2026-11-13, decisions before code): the assumptions marked in S1 and S4 were taken without asking; each can change later without redoing the rest.

L4 (2026-11-13, T1 evidence): RED observed (`self-assessment.ts` missing), then GREEN: unit project 76 passed, `npm run typecheck` clean. Rules: `canWriteSelfAssessment` (owner, until submitted), `canSeeSelfAssessment` (owner; panel once submitted), `missingFromSelfAssessment`.
