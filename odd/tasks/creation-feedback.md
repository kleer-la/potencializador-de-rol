# Feedback when creating elements

Objective: every creation in the web app announces its outcome with a floating notice: green when the element was created, red when a required field is missing.
Branch: `feat/creation-feedback`, from `main` at `56e0360`. Delivery: one work-unit commit; push and merge are the user's decisions.
Test runner: `npm test` (Vitest; project `api` needs Docker), `npm run typecheck`, `npm run build --workspace @potencializador/web`.

## Specs

S1. Backlog (Planeado): "Al crear ciclos de mejora (u otros elementos nuevos en todo el sistema) necesitamos que el sistema emita un mensaje claro con algún uso del color verde, anunciando que fue creado con éxito. Si no fuera así, que avise con algún uso del color rojo, en el caso de que haya un error o falte completar un campo."

S2. Format (user, 2026-11-23): "Aviso flotante" — one floating notice for the whole system, in a corner, green or red, that closes by itself after a few seconds. It also has a close button.

S3. Success: after each creation succeeds, a green notice names what was created. Creations covered: organization, member invitation, role, catalog entry (tool, strategic objective), map draft (new, copy, import), dimension, capability, program, enrollment, panel member, board capability, cycle, focus, experiment, evidence, level-change proposal, bonus proposal, mentoring session. Edits, removals, and state changes (publish, start, close) are out of scope.

S4. Missing field: when a form is sent with a required field empty (or any field the browser rejects), a red notice names the field: "Completa el campo «<label>»." (other rejections: "Revisa el campo «<label>»."), and the field gets a red border. One notice per attempt.

S5. Server errors keep their current red inline notice in each section (already red). Assumption: no extra floating notice for them, to avoid saying the same thing twice.

## Tasks

- [x] T1 — Notice store, `Toaster` component (with the `invalid` listener), styles, success calls at every creation site of S3, tests. Specs: S1–S5. Route: inline. Risk: none (shared `change`/`run` helpers gain an optional argument; existing calls unchanged and covered by their tests). Commit: `feat: announce creations and missing fields with floating notices`.

Route evidence: one behavior spread over many call sites (one line each) plus one new component; no writer reason.

## Log

L1 (2026-11-23, user, original request): "Al crear ciclos de mejora (u otros elementos nuevos en todo el sistema) necesitamos que el sistema emita un mensaje claro con algún uso del color verde, anunciando que fue creado con éxito. Si no fuera así, que avise con algún uso del color rojo, en el caso de que haya un error o falte completar un campo."

L2 (2026-11-23, context): server errors already render red (`role="alert"`, `--danger`); no success message exists anywhere; required fields rely on the browser's native bubble. Token `--success` exists in light and dark themes.

L3 (2026-11-23, user decision): format "Aviso flotante (Recommended)" chosen over a message next to each form.

L4 (2026-11-23, T1 evidence): RED observed (Toaster and feedback modules missing; evidence test failing without the success call), then GREEN: `npm test` 459 passed in 47 files, `npm run typecheck` clean, web build ok. Toaster tests cover success notice, auto-close after 5 s, close button, and one error notice naming the first missing field. Cycle tests pin "Ciclo creado.", "Foco agregado.", "Experimento agregado."; evidence tests pin "Evidencia registrada." and no green notice after a refused proposal.
