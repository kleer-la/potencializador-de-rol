# Calibration draft and baseline with an incomplete panel

Objective: the panel can save the calibration as a draft, and can fix the baseline even when a mandatory panel role did not attend, recording which roles were missing.
Branch: `feat/calibration-draft-incomplete-panel`, from `main` at `e576613`. Delivery: work-unit commits; merge, push and deploy are the user's decisions.
Test runner: `npm test` (Vitest; project `api` needs Docker), `npm run typecheck`.

## Specs

S1. User's request (backlog, docs/Backlog.md): "cuando no está todo el panel, no deja guardar la línea base y no se puede guardar el borrador. Quiero poder hacerlo"

S2. User decision (2026-11-23), option 2 "Relajar invariante": "permitir fijar línea base con panel incompleto. Queda registrado quién faltó."

S3. Rules for the baseline with an incomplete panel (assumptions derived from S1 and S2, not stated by the user):
- The participant must still attend; only the mandatory panel roles become optional.
- Fixing the baseline with a mandatory role missing needs an explicit confirmation: the API refuses with `attendance` (as today) unless the request says `allowMissingRoles: true`; the web names the missing roles and offers to fix the baseline anyway.
- The calibration records the mandatory roles that were missing (`missingPanelRoles`), and the board shows them in the note under the legend.
- The recalibration keeps its current attendance rule (out of scope).
- The conceptual base document records the amendment of invariant 3.

S4. Rules for the calibration draft (assumptions derived from S1):
- While the board can be calibrated (self-assessed, no baseline), a panel member saves a draft: date, notes, attendees and the agreed levels chosen so far (any subset). One draft per board; saving replaces it.
- The panel reads the draft when it opens the calibration form; the owner and program leaders off the panel do not.
- Fixing the baseline discards the draft.
- Attendees and capabilities must belong to the board (`unknown_reference`); levels are checked only when the baseline is fixed.

## Tasks

- [ ] T1 — Baseline with an incomplete panel: migration 0013 (column `missing_panel_roles`, `app_calibrate_board` with `p_allow_missing_roles`), API flag and read, web confirmation and note, conceptual base amendment, tests. Specs: S1-S3. Route: inline (one behavior; no writer reason). Risk: items 1 and 2 (migration replacing a SECURITY DEFINER function that guards invariant 3).
- [ ] T2 — Calibration draft: migration 0014 (table `calibration_drafts` with Row Level Security for the panel), API `PUT /boards/:boardId/calibration/draft` and read in the board, web "Guardar borrador", tests. Specs: S1, S4. Route: inline (one behavior; no writer reason). Risk: items 1 and 2 (new table and Row Level Security policies).
- [ ] T3 — Independent verifier over T1 and T2 (high-risk items 1 and 2).

## Log

L1 (2026-11-23, user, original request): see S1.

L2 (2026-11-23, analysis): the screen is the calibration (`apps/web/src/containers/Calibration.tsx`). There is no calibration draft; the only action fixes the baseline, all or nothing. Attendance is checked in the API (`boards.routes.ts`, `missingAttendance`) and again under lock in `app_calibrate_board` (migration 0006, SQL state PM031). The self-assessment draft already saves partial levels.

L3 (2026-11-23, user decision): see S2.
