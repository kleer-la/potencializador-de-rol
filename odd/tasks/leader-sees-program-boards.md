# A program leader reads every board of the program

Objective: a person enrolled as leader in a program sees the content of every board of that program, read-only.
Branch: `feat/leader-sees-program-boards`, from `main` at `fd0e08b`. Delivery: work-unit commits; merge, push and deploy are the user's decisions.
Test runner: `npm test` (Vitest; project `api` needs Docker), `npm run typecheck`.

## Specs

S1. User's request: "Quiero que quien tenga perfil de líder pueda visualizar todos los tableros de un programa"

S2. User decision (2026-11-23), scope: "Solo lectura" — "Líder inscrito en programa ve contenido de todos los tableros del programa. Acciones de panel (ajustar selección, calibrar, evidencia) siguen solo para su panel. Se enmienda invariante 9."

S3. Rules (assumptions derived from S1 and S2, not stated by the user):
- "Leader profile" means an enrollment with role `leader` in the board's program. Leaders of other programs see nothing new.
- The leader reads what a panel member reads: placements, submitted self-assessment (never a draft), calibration, baseline, cycles, evidence, decisions, score and history.
- Every write stays where it was: owner or panel, enforced by the API and by Row Level Security.
- `GET /api/boards` adds a third list, `program`, with the boards the person reads only as program leader (not owner, not panel). The web shows it as "Tableros de mis programas".
- The conceptual base document records the amendment of invariant 9.

## Tasks

- [x] T1 — Domain, migration 0012 (read-only Row Level Security for program leaders), API list and viewer, web list, conceptual base amendment, tests. Specs: S1-S3. Route: inline (one behavior; no writer reason). Risk: items 1 and 2 (migration changing Row Level Security policies). Independent verifier after own checks. Commit: `aa5eec4`.

## Log

L1 (2026-11-23, user, original request): see S1.

L2 (2026-11-23, user decision on scope): see S2.

L3 (2026-11-23, analysis): `app_sees_board` (migration 0004) is used by SELECT policies and by some write policies (0007 cycles/focuses/experiments, 0008 evidence). Widening it would open writes at database level. Plan: new `app_reads_board` = `app_sees_board` OR program leader; rewrite only SELECT policies and read lookups (`app_board_of_cycle`, `app_board_of_focus`, `app_board_organization`, `app_sees_self_assessment`, self-assessment read policy, `app_my_boards`). Write policies keep `app_sees_board` / `app_on_board_panel`.

L4 (2026-11-23, T1 evidence): RED observed first (9 failing for the expected reason), then GREEN. `npm test` 427 passed in 46 files, typecheck clean. Two existing tests encoded the old invariant 9 and were narrowed to keep their intent (`evidence-storage`: counts of one board; `program-storage`: the trial enrollment is a specialist). Domain write rules `canPlanCycle` and `canRecordEvidence` used `canSeeBoardContent`; they now use `takesPartIn` (owner or panel).

L5 (2026-11-23, independent verifier on `aa5eec4`): S1, S2, S3 PASS, no blockers. Probed `pg_policies`: no write policy uses `app_reads_board`, no SELECT policy still uses `app_sees_board`. Every SECURITY DEFINER write function refuses a program leader off the panel (42501). Advisory: only one API write route is tested for this role; the others rely on domain rules and Row Level Security.
