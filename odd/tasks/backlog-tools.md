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
- [x] T2 — Search picker for tools and objectives in the capability form. Specs: S2. Route: inline. Risk: none (interface only). Commit: `feat: search tools and objectives by name in the capability form` (see L3).

## Log

L1 (2026-11-13, user, original request): "si, vamos con lo del Backlog" — answer to the proposal to do the backlog items before increment 3.

L2 (2026-11-13, T1 evidence): RED observed (4 API tests, 1 interface test), then GREEN: `npm test` 229 passed, `npm run typecheck` clean.
- `DELETE /api/organizations/:organizationId/tools/:entryId` and `.../strategic-objectives/:entryId` (map designers and super administrators): `204`; `409 in_use` when a capability of any map version links it (the foreign keys of migration 0003 refuse it, so a published map never loses a tool); `404` for an entry not in the organization, including one of another organization addressed through it.
- "Catálogos" shows "Eliminar" next to each entry for map designers, with confirmation; an entry in use stays and the page says why.

L3 (2026-11-13, T2 evidence): RED observed (picker missing; the existing capability test could not find "Buscar herramientas"), then GREEN: `npm test` 233 passed in 24 files, `npm run typecheck` and `npm run build` clean.
- `SearchPicker` replaces the two multiple selects of the capability form: typing part of a name lists up to 8 matches that are not chosen yet, ignoring case and accents ("gestion" finds "Gestión de riesgos"); chosen entries show as tags with "×" to remove; before typing it says how many entries there are.
- The existing interface test of adding a capability now searches "ok" and adds "OKR" instead of picking from a list; it is the requested change in behavior.

L4 (2026-11-13, review of the branch): native review of `feat/backlog-tools` against `main` (lens reliability; consent granted by the user) ended `approved` and was acknowledged. Handled in a follow-up commit, RED then GREEN for the first two:
- Pressing Enter in the search field submitted the whole capability form, saving it without the tool being searched. Enter now adds the first match and never submits.
- After a successful delete, a failed reload of the list showed an error and the deleted entry again. The entry is removed from the list at once; a failed reload no longer shows anything.
- Added the test that a super administrator deletes an entry (`204`).
Checks: `npm test` 235 passed, `npm run typecheck` clean.

L5 (2026-11-13, review after the merge into the local main): native review of b153ac5..3219332 (lens reliability; consent granted by the user) ended `approved` and was acknowledged. Handled on branch `fix/catalog-delete-404`, RED then GREEN for both:
- Deleting an entry someone else already deleted answered `404` and the page kept showing it with an error. The page now drops it like a successful delete.
- The Enter that confirms an input method composition (Japanese, Chinese, accented input) no longer adds a match.
Checks: `npm test` 237 passed, `npm run typecheck` clean.
