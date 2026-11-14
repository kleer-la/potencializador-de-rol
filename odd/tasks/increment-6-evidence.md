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
- [ ] T2 — Persistence: evidence, level change proposals, bonus awards, mentoring sessions; decision functions; guards; Row Level Security. Specs: S1–S6, S8. Route: inline. Risk: item 1 (schema, level_changes reason), item 2 (access rules).
- [ ] T3 — API: read with the board; evidence, proposals, decisions, bonuses, sessions. Specs: S1–S6. Route: inline. Risk: item 2 (permissions).
- [ ] T4 — Web: evidence, proposals, bonuses and sessions on the board. Specs: S7. Route: inline. Risk: none (interface over the API).

Route evidence: each task builds on the previous one; no parallel writer applies.
Forecast: about 2,800 authored changed lines.

## Log

L1 (2026-11-13, user, original request): "vamos con incremento 6"

L2 (2026-11-13, context): row 6 of the approved build plan: evidence, level change and bonus; covers invariants 4–7. Migrations up to 0007 are on `main`; this increment adds migration 0008 and edits none. `level_changes` (migration 0006) allows reasons `calibration` and `initial_leveling`; migration 0008 adds `evidence` with its proposal.

L3 (2026-11-13, assumptions): those marked in S1, S2 and S5 were taken without asking; each can change later without redoing the rest.

L4 (2026-11-13, T1 evidence): RED observed (`evidence.ts` missing), then GREEN: unit project 115 passed, `npm run typecheck` clean. Rules: `canRecordEvidence` (owner or panel after the baseline), `canProposeChange` (owner), `canDecideProposal` and `canRecordMentoring` (panel), `proposalProblems` (`unplaced`, `not_above`, `no_evidence`, `no_transfer_evidence`), `bonusProblems` (`no_evidence`, `already_awarded`), `isEvidenceLink` (http or https).
