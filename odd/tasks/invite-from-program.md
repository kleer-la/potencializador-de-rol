# Invite people from a program

Objective: an administrator invites participants, leaders, specialists and mentors where they belong, in a program, without giving them an organization role they do not need.
Branch: `feat/invite-from-program`, from `main` at `b1affe9`. Delivery: work-unit commits; merge and push are the user's decisions.
Test runner: `npm test` (Vitest; project `api` needs Docker), `npm run typecheck`, `npm run build --workspace @potencializador/web`.

## Specs

S1. User's backlog (`docs/Backlog.md`, "Planeado"): "Al invitar a una persona, no es posible elegir un rol diferente al de administrador y Diseñador de mapa. Se requiere poder invitar a participantes, líderes y especialistas y mentores"
- Participant, leader, specialist and mentor are roles in a program (document §7), not in the organization.

S2. User decision (2026-11-13), answer "Desde el programa (Recomendado)" to: "Al inscribir en un programa se escribe nombre y correo; si la persona no existe, se la invita y se inscribe con su papel (participante, líder, especialista, mentor) en un solo paso. Además, la invitación de Personas permite invitar sin rol de organización."
- Enrolling in a program takes the email and, optionally, the name. When nobody with that email exists, a name is required: the person is invited to the organization (no organization role) and enrolled in the same step. An email that belongs elsewhere answers as the invitation does today, without saying where.
- Inviting from "Personas" offers "Sin rol en la organización" besides "Administrador" and "Diseñador del mapa".
- Unchanged: only an administrator (or a super administrator) invites and enrolls; a person of Kleer still cannot participate; an existing person is enrolled as today and the name is ignored.

## Tasks

- [x] T1 — API: enrollment invites an unknown email with a name; invitation without organization role. Specs: S1, S2. Route: inline. Risk: none (adds optional fields; same permission checks). Commit: `feat: invite people when enrolling them in a program` (see L3).
- [x] T2 — Web: name in the enrollment form, "Sin rol en la organización" in the invitation form. Specs: S2. Route: inline. Risk: none. Commit: `feat: invite from the program form and without organization role` (see L4).

## Log

L1 (2026-11-13, user, original request): "Al invitar a una persona, no es posible elegir un rol diferente al de administrador y Diseñador de mapa. Se requiere poder invitar a participantes, líderes y especialistas y mentores"

L2 (2026-11-13, user decision): see S2.

L3 (2026-11-13, T1 evidence): RED observed (3 route tests failing), then GREEN.
- `POST /api/organizations/:id/programs/:programId/enrollments` takes an optional `name`. Unknown email with a name: the person is created in the organization without organization role and enrolled (`201`); without a name, `404 person_not_found` as before; an email of another organization or of Kleer: `409 invitation_not_possible`, nothing stored. An existing person keeps their name.
- `POST /api/organizations/:id/members` takes `role` as optional; without it the person joins with no organization role (`roles: []`). The find-or-create step is shared by both routes (`organizations/invite-person.ts`).
- A person invited this way signs in and `/api/me` lists no memberships.

L4 (2026-11-13, T2 evidence): RED observed (2 interface tests failing), then GREEN: `npm test` 329 passed in 35 files, `npm run typecheck` and `npm run build` clean.
- The program's "Inscribir" form adds "Nombre (si es nueva)" with a line explaining it; the name is sent only when written.
- The invitation in "Personas" adds "Sin rol en la organización", which sends no role.
- "person_not_found" now says to write the name to invite and enroll; "invitation_not_possible" has its message in the program view too.
