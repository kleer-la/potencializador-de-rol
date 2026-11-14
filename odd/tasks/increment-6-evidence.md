# Increment 6 — Evidence, level changes, bonuses and mentoring

Objective: after the baseline, a level moves only with evidence and the approval of one panel member; bonuses count only when their condition is met, evidenced and approved; mentoring sessions record what was reviewed.
Branch: `feat/increment-6-evidence`, from `main` at `a6e629a`. Delivery: work-unit commits; merge and push are the user's decisions.
Test runner: `npm test` (Vitest; project `api` needs Docker), `npm run typecheck`, `npm run build --workspace @potencializador/web`.
Conceptual base: `docs/Potencializador de rol — Base conceptual del sistema.md` ("the document").

## Specs

S1. Evidence. Document §4.2: "`Evidence` | descripción del hecho, enlace opcional, fecha, autor | sustenta un experimento, un cambio de nivel o una bonificación otorgada". Document §7: the participant "registra experimentos y evidencias".
- Owner and panel record evidence on a board: the fact, an optional link (http or https), the date it happened, its author (the person acting). It may name the experiment it comes from.
- Assumption: evidence can say that it shows transfer (the person taught others), for invariant 6.
- Assumption: evidence is never edited; it can be deleted by its author only while nothing decided cites it.

S2. Level changes with evidence. Document §5.1 invariant 4: "**Después de la línea base, ningún nivel cambia sin evidencia.** Todo cambio queda como `LevelChange` con al menos una evidencia y quién lo aprobó." Invariant 5: "**El participante no aprueba sus propios cambios.** Propone; basta la aprobación de un solo integrante de su panel." Document §6.3: "Cambio de nivel | propuesto → aprobado o rechazado". Document §9.1: "Un nivel puede bajar, pero solo en una recalibración".
- The owner proposes a new level for a capability on a board with a baseline, citing at least one evidence of that board.
- One panel member approves or rejects it. On approval the placement takes the level and a level change with reason "evidencia", the approver and the cited evidence is recorded. A rejection changes no level.
- Assumption: the proposed level is above the current one (lowering belongs to a recalibration); a capability has at most one open proposal.
- Assumption: only the owner proposes (document §7); the panel decides.
- Tests are titled `INV-4` and `INV-5`.

S3. Invariant 6. Document §5.1: "**Los niveles que exigen transferencia piden evidencia de haber enseñado a otros.** En el caso de origen es el nivel 4." Levels have `requires_transfer` since migration 0003.
- A proposal to a level that requires transfer cites at least one evidence that shows transfer; otherwise it is refused, in the database as well.
- User decision (2026-11-13, increment 4): the calibration and the initial leveling ask for no evidence; this applies to changes with evidence only.
- Tests are titled `INV-6`.

S4. Bonuses. Document §5.1 invariant 7: "**Una bonificación solo cuenta con su condición cumplida y evidenciada.** Se registra como `BonusAward` sobre una ubicación: el participante la propone con al menos una evidencia y un integrante de su panel la aprueba. Solo las aprobadas suman, y hay a lo sumo una por regla y capacidad." Document §4.2: "`BonusAward` | estado (propuesta, aprobada, rechazada), fecha, propuesta por, aprobada por".
- The owner proposes a bonus rule of the program's map for a capability on the board with a baseline, citing at least one evidence; one panel member approves or rejects it.
- At most one bonus per rule and capability that is proposed or approved; after a rejection it can be proposed again.
- The score (increment 7) counts only approved bonuses.
- Tests are titled `INV-7`.

S5. Mentoring sessions. Document §4.2: "`MentoringSession` | fecha, notas | pertenece a un tablero; revisa experimentos". Document §6.2 step 5: "**Mentoría.** En cada sesión se revisan los experimentos, se registran hechos y aprendizajes."
- A panel member records a session on a board with a baseline: date, notes, and the experiments of the board it reviewed.
- Assumption: a session is not edited afterwards.

S6. Who sees. Invariant 9: "Un tablero lo ven su dueño y su panel." Invariant 11: new tables have `organization_id` and Row Level Security; tests titled `INV-9` and `INV-11`.

S7. Web interface (Spanish, design system).
- On a board with a baseline, owner and panel see the evidence (with its link and whether it shows transfer), the level change proposals with their state, the bonuses with their state, and the mentoring sessions.
- The owner records evidence, proposes a level change (choosing evidence) and proposes a bonus; a panel member records evidence, approves or rejects proposals, and records sessions.

S8. Automated coverage. User: "Las invariantes de la sección 5.1 deben quedar cubiertas por pruebas automatizadas." This increment covers invariants 4 (changes with evidence), 5, 6 and 7, and extends 9 and 11.

## Tasks

- [x] T1 — Domain rules: who proposes and decides, proposal validity (above current level, evidence, transfer), bonus uniqueness. Specs: S1–S5, S8. Route: inline. Risk: none (new pure code). Commit: `feat: domain rules of evidence, level changes and bonuses` (see L4).
- [x] T2 — Persistence: evidence, level change proposals, bonus awards, mentoring sessions; decision functions; guards; Row Level Security. Specs: S1–S6, S8. Route: inline. Risk: item 1 (schema, level_changes reason), item 2 (access rules). Commit: `feat: store evidence, level changes, bonuses and mentoring under invariants 4 to 7` (see L5).
- [x] T3 — API: read with the board; evidence, proposals, decisions, bonuses, sessions. Specs: S1–S6. Route: inline. Risk: item 2 (permissions). Commit: `feat: evidence, level changes, bonuses and mentoring through the board API` (see L7).
- [x] T4 — Web: evidence, proposals, bonuses and sessions on the board. Specs: S7. Route: inline. Risk: none (interface over the API). Commit: `feat: evidence, level changes, bonuses and mentoring in the web interface` (see L8).

Route evidence: each task builds on the previous one; no parallel writer applies.
Forecast: about 2,800 authored changed lines.

## Log

L1 (2026-11-13, user, original request): "vamos con incremento 6"

L2 (2026-11-13, context): row 6 of the approved build plan: evidence, level change and bonus; covers invariants 4–7. Migrations up to 0007 are on `main`; this increment adds migration 0008 and edits none. `level_changes` (migration 0006) allows reasons `calibration` and `initial_leveling`; migration 0008 adds `evidence` with its proposal.

L3 (2026-11-13, assumptions): those marked in S1, S2 and S5 were taken without asking; each can change later without redoing the rest.

L4 (2026-11-13, T1 evidence): RED observed (`evidence.ts` missing), then GREEN: unit project 115 passed, `npm run typecheck` clean. Rules: `canRecordEvidence` (owner or panel after the baseline), `canProposeChange` (owner), `canDecideProposal` and `canRecordMentoring` (panel), `proposalProblems` (`unplaced`, `not_above`, `no_evidence`, `no_transfer_evidence`), `bonusProblems` (`no_evidence`, `already_awarded`), `isEvidenceLink` (http or https).

L5 (2026-11-13, T2 evidence and decisions): RED observed (`relation "evidence" does not exist`), then GREEN: 8 storage tests (titled `INV-4`, `INV-5`, `INV-6`, `INV-7`, `INV-9`, `INV-11`) and the whole suite, 344 passed in 37 files; `npm run typecheck` clean. Mutation check on migration 0008: dropping the transfer check, the panel check of a decision, or the one-bonus-per-rule index each failed its test. All restored.
- Migration `0008_evidence_level_changes_bonuses.sql`: `evidence` (link only http or https, `shows_transfer`, optional experiment of the same board, author set to the person acting), `level_change_proposals` and `proposal_evidence`, `bonus_awards` (at most one not rejected per rule and capability) and `bonus_evidence`, `mentoring_sessions` and `mentoring_session_experiments`. Every table carries `board_id`, `organization_id` and Row Level Security for owner and panel; no super administrator clause.
- `level_changes` gains reason `evidence` and `proposal_id`, required together. `bonus_rules` gains the composite key bonus awards need. Migration 0006 is not edited.
- The API role inserts evidence and deletes its own evidence while nothing cites it; it writes nothing else. `app_propose_level_change`, `app_decide_level_change`, `app_propose_bonus`, `app_decide_bonus` and `app_record_mentoring` write after their checks. A decided proposal or bonus, a citation and a session never change, for every role.
- SQL states: `PM004`, `PM006`, `PM007` for the invariants, `PM050` for states, `23514` for references outside the board or the map, `42501` for who acts.

L6 (2026-11-13, review of T1 and T2): native review of commits `a4a2176` and `5a43951` (escalated for item 2, access rules; lenses risk, reliability; consent granted by the user) ended `approved` and was acknowledged. Handled in a follow-up commit (`npm test` green, `npm run typecheck` clean):
- `app_board_evidence` returned evidence rows across Row Level Security to anyone who could call it. Only the proposal functions use it now; the API role can no longer call it (test: `permission denied`).
- The domain accepted a link with spaces that the database refuses; `isEvidenceLink` now refuses it too (unit case added).
- Added storage cases: evidence from an experiment of the board is accepted; from an experiment of another board it is refused, as is a mentoring session that names it.

L7 (2026-11-13, T3 evidence): RED observed (5 of 6 route tests failing), then GREEN: `npm test` 350 passed in 38 files, `npm run typecheck` clean.
- `GET /api/boards/:boardId` adds `evidence` (with link, `showsTransfer`, experiment, author), `proposals` and `bonuses` (state, dates, note, cited evidence ids), `bonusRules` of the map, `mentoringSessions` (with the experiments reviewed), and `viewer.canRecordEvidence`, `canProposeChanges`, `canDecideProposals`, `canRecordMentoring`. One existing test compared `viewer` whole and now includes the four fields.
- `POST /api/boards/:boardId/evidence` {description, link?, occurredOn, showsTransfer?, experimentId?}: `201`; `409 no_baseline`, `400 invalid_request` (link not http or https), `400 unknown_reference`. `DELETE .../evidence/:evidenceId`: `204`; `403` not its author, `409 evidence_cited`.
- `POST .../level-proposals` {capabilityId, levelId, evidenceIds}: `201`; `403` not the owner, `422 invalid_proposal` with `problems` (`unplaced`, `not_above`, `no_evidence`, `no_transfer_evidence`), `400 unknown_reference` (evidence of another board), `409 proposal_open`. `POST .../level-proposals/:id/decision` {approve, note}: `200`; `403` not on the panel, `409 already_decided`, `409 no_longer_above`.
- `POST .../bonuses` {capabilityId, bonusRuleId, evidenceIds}: `201`; `422 invalid_bonus` (`no_evidence`), `409 already_awarded`, `400 unknown_reference`. `POST .../bonuses/:id/decision`: as for proposals.
- `POST .../mentoring-sessions` {heldOn, notes, experimentIds}: `201`; `403` not on the panel, `400 unknown_reference`.

L8 (2026-11-13, T4 evidence): RED observed (5 interface tests failing), then GREEN: `npm test` 355 passed in 39 files, `npm run typecheck` and `npm run build` clean.
- On a board with a baseline, owner and panel see four sections: "Evidencias" (fact, date, author, link opened in a new tab, "Enseñó a otros"), "Cambios de nivel" (capability → level, state, cited evidence, decision note), "Bonificaciones" (the map's rules with points and condition, and the bonuses with their state) and "Mentorías" (date, who recorded it, notes, experiments reviewed).
- Owner and panel record evidence ("Hecho", "Fecha del hecho", "Enlace (opcional)", "Muestra que enseñó a otros"). The owner proposes a level change (only placed capabilities and levels above the current one; levels that require transfer say so) and a bonus, choosing the evidence; a refused proposal lists its problems in Spanish. A panel member approves or rejects with a note (buttons named after what they decide) and records mentoring sessions with the experiments of the current cycle.
- Deleting evidence is in the API only; the interface does not offer it yet.
- Existing interface test fixtures gained the new board fields; their assertions did not change.

L9 (2026-11-13, review of T3 and T4): native review of commits `45bc2ec` to `f8b489c` (escalated for item 2, permissions; lenses risk, reliability; consent granted by the user) ended `approved` and was acknowledged. Handled in a follow-up commit (`npm test` green, `npm run typecheck` clean):
- The default "Fecha del hecho" and "Fecha de la sesión" took the UTC date, a day ahead in the evening in Colombia. They now take the local date (unit case at 21:30 local time).
- The review warned that migration 0008 was edited after its first commit (the `app_board_evidence` revoke). It exists only on this branch and has run only in throwaway test databases; no shared or user database has applied it. Once merged it is never edited again.
- Recorded, not changed: the route tests of this increment share state and run in order, as in earlier increments.
