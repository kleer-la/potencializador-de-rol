# Increment 4 — Calibration and baseline

Objective: the panel and the participant agree, with real cases, the level of every capability on the board; the system keeps the difference from the self-assessment and fixes the baseline, which never changes afterwards and only grows with capabilities added later.
Branch: `feat/increment-4-calibration`, from `main` at `c1134a6`. Delivery: work-unit commits; merge and push are the user's decisions.
Test runner: `npm test` (Vitest; project `api` needs Docker), `npm run typecheck`, `npm run build --workspace @potencializador/web`.
Conceptual base: `docs/Potencializador de rol — Base conceptual del sistema.md` ("the document").

## Specs

S1. What a calibration is. Document §3: "Calibración | `CalibrationSession` | Sesión en la que el panel y el participante acuerdan niveles con casos reales." Document §4.2: "`CalibrationSession` | fecha, asistentes, notas, niveles acordados | pertenece a un tablero; produce una línea base". Document §6.2: "2. **Calibración.** El panel contrasta cada ubicación con casos reales y se acuerdan los niveles. El sistema guarda la diferencia entre lo autoevaluado y lo acordado, y fija la línea base."
- A panel member of the board records the session: date, who attended (the participant and panel members of that board), notes, and one agreed level of the program's scale for each capability on the board.
- Assumption: calibration is for a board "autoevaluado" (its self-assessment was submitted).
- Assumption: every capability on the board needs an agreed level; the answer names the ones missing. Capabilities the panel added after the self-assessment have no proposal and are calibrated like the rest.
- Assumption: the calibration that fixes the baseline happens once per board. A later recalibration (document §6.2 step 7) only produces a snapshot and belongs to the cycle increments.

S2. Invariant 3. Document §5.1: "**La línea base nace de una calibración.** Solo se fija si asistieron el participante y los roles obligatorios del panel, y toma las capacidades seleccionadas en ese momento. Sus entradas no se editan. Después, en cualquier momento se pueden agregar capacidades nuevas al tablero: entran sin ubicar, un integrante del panel acuerda su nivel inicial con el participante, y ese nivel se agrega a la línea base original como entrada nueva. Queda registro de quién agregó la capacidad, cuándo, y de su nivelación inicial. Una recalibración posterior no reemplaza la línea base: solo produce una fotografía."
- The mandatory panel roles are those of the program (`mandatory_panel_roles`; user, 2026-11-13: "de los 3 roles del panel se requiere como obligatorio al menos 1"). Without the participant or a person of each mandatory role among the attendees, nothing is recorded and the answer names what is missing.
- The baseline holds one entry per capability on the board at that moment, with its agreed level. Entries are never edited or deleted, in the database as well.
- A capability added after the baseline enters unplaced; a panel member records its initial level agreed with the participant, and that adds one baseline entry. Who added it and when is already recorded (`added_by`, `added_at`).
- Tests are titled `INV-3`.

S3. Difference from the self-assessment. Document §6.2 step 2: "El sistema guarda la diferencia entre lo autoevaluado y lo acordado".
- For each capability the session keeps the agreed level beside the self-assessed one (none when the participant gave no proposal), and both are shown together.

S4. Board state. Document §6.3: "Tablero | sin iniciar → autoevaluado → calibrado (con línea base) → ...".
- Recording the calibration moves the board from "autoevaluado" to "calibrado" and sets the date of the baseline. The placements take the agreed levels.

S5. Levels after the baseline. Document §5.1 invariant 4: "**Después de la línea base, ningún nivel cambia sin evidencia.** Todo cambio queda como `LevelChange` con al menos una evidencia y quién lo aprobó. Hay dos excepciones, que también quedan como `LevelChange` con quién las aprobó: la nivelación inicial de una capacidad agregada y los niveles acordados en una recalibración." Document §9.2: "Nivel inicial de una capacidad agregada | Se registra como cambio de nivel con motivo \"nivelación inicial\"".
- The calibration's agreed levels and every initial leveling are recorded as level changes (previous level, new level, date, reason, approved by).
- After the baseline, a placement's level changes only together with its level change, in the database. Changes with evidence come in increment 6.
- User decision (2026-11-13): fixing a level that requires transfer at calibration or initial leveling asks for no recorded evidence ("Sin evidencia").

S6. Who records and who sees. Document §7: leader, specialist and mentor "participa(n) en la calibración"; invariant 9: "Un tablero lo ven su dueño y su panel."
- Only a panel member of the board records the calibration and the initial leveling; the participant does not record it for themself.
- The owner and their panel see the calibration (attendees, notes, agreed and self-assessed levels) and the baseline; nobody else, in the API or the database.
- Invariant 11: new tables have `organization_id` and Row Level Security; tests titled `INV-11`.

S7. Web interface (Spanish, design system).
- A panel member of a board "autoevaluado" sees a calibration form: date, attendees (participant and each panel member, with their role), notes, and for each capability the self-assessed level and a choice of the agreed level; "Fijar línea base" with confirmation that it cannot be changed afterwards.
- After the baseline, the board shows the agreed levels, the baseline, and the difference from the self-assessment. A capability added later shows as unplaced with a way for a panel member to record its initial level.

S8. Automated coverage. User: "Las invariantes de la sección 5.1 deben quedar cubiertas por pruebas automatizadas." This increment covers invariant 3, the two exceptions of invariant 4, and extends 9 and 11.

## Tasks

- [x] T1 — Domain rules: attendance against mandatory roles, what is missing to calibrate, difference from the self-assessment. Specs: S1–S3, S8. Route: inline. Risk: none (new pure code). Commit: `feat: domain rules of the calibration` (see L5).
- [x] T2 — Persistence: calibration sessions, attendees, agreed levels, baseline entries, level changes; calibration and initial-leveling functions; guards (baseline immutable, placement level after baseline only with a level change); Row Level Security. Specs: S1–S6, S8. Route: inline. Risk: item 1 (schema), item 2 (access rules). Commit: `feat: store calibrations and the baseline under invariants 3 and 4` (see L6).
- [x] T3 — API: read calibration and baseline with the board, record calibration, record initial leveling. Specs: S1–S6. Route: inline. Risk: item 2 (permissions). Commit: `feat: calibration and initial leveling through the board API` (see L8).
- [ ] T4 — Web: calibration form, baseline and difference on the board, initial leveling. Specs: S7. Route: inline. Risk: none (interface over the API).

Route evidence: each task builds on the previous one; no parallel writer applies.
Forecast: about 2,000 authored changed lines.

## Log

L1 (2026-11-13, user, original request): "Vamos con el incremento 4"

L2 (2026-11-13, context): row 4 of the approved build plan: "Calibración y línea base", covering invariant 3. Migrations 0004 and 0005 are on `main`; this increment adds migration 0006 and edits none. No route sets a placement's level today, so calibration is the first one.

L3 (2026-11-13, user decision): question on the open decision "Transferencia en la calibración" (document §9.3); answer: "Sin evidencia (Recomendado)" — at calibration the panel's agreement with real cases is enough, as in the initial leveling; evidence of transfer is required for later level changes (increment 6).

L4 (2026-11-13, assumptions): those marked in S1 were taken without asking; each can change later without redoing the rest. Advisory of increment 3 (L10) handled by S1: capabilities without a proposal are calibrated like the rest.

L5 (2026-11-13, T1 evidence): RED observed (`calibration.ts` missing), then GREEN: unit project 85 passed, `npm run typecheck` clean. Rules: `canCalibrate` (panel member, before the baseline), `missingAttendance` (participant, and each mandatory role through a panel member of this board who attended), `missingFromCalibration`, `calibrationDifference` (proposed and agreed level, steps between them, none without a proposal), `canRecordInitialLevel` (panel member, after the baseline). `isOnPanel` is now exported from `program.ts` for reuse.

L6 (2026-11-13, T2 evidence and decisions): RED observed (`function app_calibrate_board ... does not exist`), then GREEN: 11 storage tests (titled `INV-3`, `INV-4`, `INV-9`, `INV-11`) and the whole suite, 282 passed in 29 files; `npm run typecheck` clean. Mutation check on migration 0006: dropping the participant attendance check, the level guard after the baseline, or the "baseline only from a calibration" guard each failed its test. All restored.
- Migration `0006_calibration_and_baseline.sql`: `calibration_sessions` (one per board), `calibration_attendees`, `calibration_levels` (self-assessed level beside the agreed one), `baseline_entries` (origin `calibration` or `initial_leveling`), `level_changes` (reason `calibration` or `initial_leveling`, approved by). All with `organization_id`, composite foreign keys and Row Level Security: the owner and the panel read; nobody else; no super administrator clause.
- The API role writes none of these tables. `app_calibrate_board(board, date, notes, attendees, levels)` and `app_record_initial_level(board, capability, level)` write after their checks. None of these rows is ever edited or deleted, for every role (SQL states `PM003`, `PM004`).
- Database guards: a baseline is set only with a calibration session; a board without a baseline cannot be "calibrado" or later, and one with a baseline cannot go back (this closes the advisory of increment 3 L10 about administrators moving the state); a capability added after the baseline enters unplaced; after the baseline a placement's level changes only with the level change recorded in the same transaction.
- `app_is_super_admin()` and `map_state_of` (advisory of increment 3 L10) are now executable only by the API role.
- Five existing tests gave a board a baseline or a later state by updating `boards` directly, which the new guards refuse. They now use the test helper `giveBaseline`, which records a calibration session first. Their assertions did not change.

L7 (2026-11-13, review of T1 and T2): native review of commits `5b12b7f` and `f6e0f03` (escalated for item 2, access rules; lenses risk, reliability; consent granted by the user) ended `approved` and was acknowledged. Handled in a follow-up commit, RED observed for the new cases, then GREEN (`npm test` 283 passed, `npm run typecheck` clean):
- `canCalibrate` allowed a board not yet self-assessed while the database refuses it; it now takes the board's state.
- A calibration item without a capability got the message about repeated capabilities; the "not on the board" check now runs first.
- Added storage cases: repeated capability, missing level, missing capability, no attendees; moving an existing baseline date is refused (already guarded by migration 0004, now pinned by a test).
- The mandatory-roles loop tolerates an empty value, as the attendee loop does (the column is `NOT NULL`, so this is defensive only).
- Recorded, not changed: the storage tests of this increment share one board and run in order, as in increment 3.

L8 (2026-11-13, T3 evidence): RED observed (6 of 7 route tests failing), then GREEN: `npm test` 290 passed in 30 files, `npm run typecheck` clean.
- `GET /api/boards/:boardId` adds `owner` and `panel` (person, name, role), `program.mandatoryPanelRoles`, `calibration` (`heldOn`, `notes`, attendees with names, and per capability the self-assessed and agreed level, in map order; `null` before it), `baseline` (`setAt` and entries with origin, oldest first; `null` before it), and `viewer.canCalibrate` / `viewer.canRecordInitialLevel`. One existing test compared `viewer` whole and now includes the two fields; nothing else changed.
- `POST /api/boards/:boardId/calibration` {heldOn, notes, attendees, levels} (panel member): `201`; `403 forbidden` (owner, anyone not on the panel), `404` off the board, `409 baseline_set`, `409 not_self_assessed`, `400 unknown_reference` (attendee off the board, capability off the board, level of another map), `422 attendance` with `participantMissing` and `missingRoles`, `422 incomplete` with the missing capability ids, `400 invalid_request` (malformed date, repeated capability, no attendees).
- `POST /api/boards/:boardId/initial-levels` {capabilityId, levelId} (panel member, after the baseline): `201`; `403 forbidden`, `409 no_baseline`, `404` capability not on the board, `409 already_leveled` (it already has its entry in the baseline).
