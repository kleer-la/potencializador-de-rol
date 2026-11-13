# Backlog — tool catalog: delete and search

Objective: the two "To Do" items of `docs/Backlog.md`.
Branch: `feat/backlog-tools`, from `main` at `b153ac5`. Delivery: work-unit commits; merge and push are the user's decisions.
Test runner: `npm test`, `npm run typecheck`.

## Specs

S1. `docs/Backlog.md`: "CRUD Herramientas". Create, list and edit exist (increment 1, tab "Catálogos"); delete is missing.
- A map designer or a super administrator deletes a tool of the organization's catalog. Strategic objectives, the other catalog, work the same way.
- Assumption: an entry used by any capability of any map version cannot be deleted (published maps never change, invariant 10); the answer says it is in use. An unused entry is deleted.
- Deletion asks for confirmation in the page.

S2. `docs/Backlog.md`: "Búsqueda de herramientas simple para añadir a una Capacidad observable".
- When adding or editing a capability, tools are found by typing part of their name; the match ignores case and accents. Selected tools show as tags that can be removed.
- Assumption: strategic objectives use the same picker, for consistency.

## Tasks

- [x] T1 — Delete catalog entries: API and interface. Specs: S1. Route: inline. Risk: item 1 (deletes stored data; guarded by the foreign keys). Commit: `feat: delete tools and objectives from the catalogs` (see L2).
- [ ] T2 — Search picker for tools and objectives in the capability form. Specs: S2. Route: inline. Risk: none expected. Commit: —

## Log

L1 (2026-11-13, user, original request): "si, vamos con lo del Backlog" — answer to the proposal to do the backlog items before increment 3.

L2 (2026-11-13, T1 evidence): RED observed (4 API tests, 1 interface test), then GREEN: `npm test` 229 passed, `npm run typecheck` clean.
- `DELETE /api/organizations/:organizationId/tools/:entryId` and `.../strategic-objectives/:entryId` (map designers and super administrators): `204`; `409 in_use` when a capability of any map version links it (the foreign keys of migration 0003 refuse it, so a published map never loses a tool); `404` for an entry not in the organization, including one of another organization addressed through it.
- "Catálogos" shows "Eliminar" next to each entry for map designers, with confirmation; an entry in use stays and the page says why.
