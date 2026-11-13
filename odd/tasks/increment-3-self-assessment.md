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
- [x] T2 — Persistence: self-assessments and their levels, submission function, Row Level Security, database guards. Specs: S1–S5, S7. Route: inline. Risk: item 1 (schema), item 2 (access rules). Commit: `feat: store self-assessments under invariants 2 and 9` (see L5).
- [x] T3 — API: read with the board, save draft, submit. Specs: S1–S5. Route: inline. Risk: item 2 (permissions). Commit: `feat: self-assessment through the board API` (see L6).
- [x] T4 — Web: self-assessment on the board, panel view. Specs: S6. Route: inline. Risk: none (interface over the existing API). Commit: `feat: self-assessment in the web interface` (see L8).

Route evidence: each task builds on the previous one; no parallel writer applies.
Forecast: about 1,800 authored changed lines.

## Log

L1 (2026-11-13, user, original request): "adelante" — answer to: "Lo siguiente del plan es el incremento 3, la autoevaluación ... Cuando quieras empezar, armo su documento de especificación primero".

L2 (2026-11-13, context): row 3 of the approved build plan: "Autoevaluación", covering invariant 2. Migration 0004 is on `main` and may already be applied on the user's machine, so this increment adds migration 0005 and edits none.

L3 (2026-11-13, decisions before code): the assumptions marked in S1 and S4 were taken without asking; each can change later without redoing the rest.

L4 (2026-11-13, T1 evidence): RED observed (`self-assessment.ts` missing), then GREEN: unit project 76 passed, `npm run typecheck` clean. Rules: `canWriteSelfAssessment` (owner, until submitted), `canSeeSelfAssessment` (owner; panel once submitted), `missingFromSelfAssessment`.

L5 (2026-11-13, T2 evidence and decisions): RED observed (`relation "self_assessments" does not exist`), then GREEN: 8 storage tests (titled `INV-2`, `INV-9`, `INV-11`) and the whole suite, 249 passed in 26 files. Mutation check on migration 0005: letting the panel read a draft failed the `INV-9` draft test; copying the proposed levels into the placements on submit failed the `INV-2` test. Both restored.
- Migration `0005_self_assessments.sql`: `self_assessments` (one per board, `submitted_at` empty while a draft) and `self_assessment_levels` (one level per capability), with `organization_id`, composite foreign keys and Row Level Security with no super administrator clause.
- The owner starts and writes their draft; the panel reads it only once submitted; nobody else reads it. The API role has no `UPDATE` or `DELETE` on self-assessments: only `app_submit_self_assessment(board)` submits, for the owner, when every capability on the board has a level; it moves the board from `not_started` to `self_assessed` and touches no placement.
- A proposed level must be for a capability on the board and of the program's scale. A submitted self-assessment never changes, for every role (SQL state `PM002`); it goes only with its board.
- Two test expectations were adjusted to the stronger behavior found: the API role is denied `UPDATE` outright, and deleting the levels of a submitted self-assessment as its owner deletes nothing.

L6 (2026-11-13, T3 evidence): RED observed (6 failing), then GREEN: `npm test` 255 passed in 27 files, `npm run typecheck` clean.
- `GET /api/boards/:boardId` adds `selfAssessment` (`null` for the panel while it is a draft; for the owner, `{ submittedAt, levels }` in map order) and `viewer.canSelfAssess`. One existing test compared `viewer` whole and now includes the new field; nothing else changed.
- `PUT /api/boards/:boardId/self-assessment` (owner, draft only) replaces the proposed levels; `POST /api/boards/:boardId/self-assessment/submit` (owner) submits.
- Answers: `403 forbidden` (the panel or anyone but the owner on the board), `404` for someone off the board, `400 unknown_reference` (capability off the board or level off the scale), `422 incomplete` with the missing capability ids, `409 already_submitted`.

L7 (2026-11-13, review of T1 to T3): native review of commits 1f9e2ca to 014ee21 (lenses risk, reliability; consent granted by the user) ended `approved` and was acknowledged. Handled in a follow-up commit, RED observed for all four new tests, then GREEN:
- A self-assessment could be started, written and submitted on a board already calibrated or in a cycle. It is now open only while the board is "sin iniciar", in the database (insert and write policies, submit function) and the API (`409 board_not_open`; `canSelfAssess` false).
- Two first saves at once could both try to create the self-assessment and one answered `500`. Saving and submitting take a transaction advisory lock per board; four concurrent saves now give one self-assessment.
- The lookup functions of migrations 0004 and 0005 were executable by `PUBLIC` (PostgreSQL's default). Migration 0005 revokes that and grants them to the API role only.
- Added route tests: repeated capabilities and a malformed body (`400`), the panel submitting (`403`).
- Recorded, not changed: the route and storage tests of this increment run in order and share state.
Checks: `npm test` 260 passed, `npm run typecheck` clean.

L8 (2026-11-13, T4 evidence): RED observed (3 interface tests failing), then GREEN: `npm test` 263 passed in 27 files, `npm run typecheck` and `npm run build` clean.
- The owner of a board "sin iniciar" sees a self-assessment form: each capability on the board as a group of level choices (radio buttons), "N de M capacidades con nivel", "Guardar borrador", and "Enviar autoevaluación" with confirmation. Submitting saves what is on screen first. An incomplete submission lists the capabilities without a level. The page says the self-assessment is a proposal, not the baseline, and gives no score.
- After submitting, and for the panel, the board shows the agreed level as ● ("Nivel acordado") and the self-assessment as ○ ("Autoevaluación"), with a legend.
- Compose and real browser probe with the Product Owner map (participant with 15 capabilities): an incomplete submission listed the 10 missing; the complete one moved the board to "Autoevaluado"; the 15 agreed levels stayed "Sin ubicar" (invariant 2) and the 15 proposals showed as ○. The first browser attempt failed with `403 forbidden_origin` because the probe page used `127.0.0.1` while the API expected `localhost`; with the probe's own origin configured it passed. Not a defect of the application.

L9 (2026-11-13, review of the whole branch): native review of the increment (lenses risk, reliability; consent granted by the user) ended `approved` and was acknowledged. Handled in a follow-up commit, RED observed (`[500, 200]` instead of `[422, 422]`), then GREEN:
- Submitting on a board without capabilities answered `500` before any save, and after saving an empty draft it moved the board to "autoevaluado" with nothing proposed. It now answers `422 empty_board` and the board stays "sin iniciar".
- Added the route test the log of T3 claimed: a level of another map answers `400 unknown_reference`.
Checks: `npm test` 265 passed in 27 files, `npm run typecheck` clean.

L10 (2026-11-13, independent verification at `b73eef9`, baseline `d46c013`): S1–S7 PASS, no blockers; `npm test` 263 passed, `npm run typecheck` clean in a scratch copy. Probes through the API and SQL as the API role confirmed invariant 2 (placements unchanged on submit, submitted self-assessment immutable even for the schema owner), invariant 9 (draft only for the owner; nobody off the panel reads it) and invariant 11. Advisories, recorded for later increments, not changed:
- Since migration 0004 an administrator can update `boards.status` directly as the API role; no route does it, so S3 holds at the API, not in the database.
- The panel can still add or remove placements before the baseline, so a submitted self-assessment can stop matching the board. Increment 4 (calibration) must handle capabilities without a proposal.
- `app_is_super_admin()` and `map_state_of` (earlier migrations) keep the default `PUBLIC` execute.
- Direct SQL by the owner could race a level delete against a submit; the API's advisory lock prevents it.
