# Recover a forgotten password

Objective: a person who forgot their password gets a link by mail and chooses a new one, reusing the password sign-in flow.
Branch: `feat/password-reset`, from `main` at `faf7cce`. Delivery: work-unit commits; merge and push are the user's decisions.
Test runner: `npm test` (Vitest; project `api` needs Docker), `npm run typecheck`, `npm run build --workspace @potencializador/web`.

## Specs

S1. User's request: "vamos con recuperar contraseña olvidada"

S2. Flow (assumptions, not stated by the user):
- The sign-in form offers "Olvidé mi contraseña". It asks only for the email and answers like "Crear contraseña": the same answer for every email, so it reveals nothing.
- A person who already has a password now gets a link too, with the subject "Cambia tu contraseña". A person without one gets "Crea tu contraseña", as before.
- Until the link is used, the current password keeps working. The link is valid for 24 hours, for one use, and a new one replaces a pending one.
- Choosing the new password on the link page replaces the old one, clears the lockout, closes every other session of that person, and signs them in.

## Tasks

- [x] T1 — API: migration 0011 (link for people with a password, replace on confirm, close sessions), mail text, tests, README. Specs: S1, S2. Route: inline. Risk: item 2 (authentication, sessions).
- [x] T2 — Web: "Olvidé mi contraseña" in the sign-in form. Specs: S2. Route: inline. Risk: none.

## Log

L1 (2026-11-14, user, original request): "vamos con recuperar contraseña olvidada"

L2 (2026-11-14, T1/T2 evidence): RED observed first in both (API 3 failing, web 2 failing), then GREEN. `npm test` 413 passed in 44 files, typecheck and web build clean.
- Migration 0011 replaces `app_password_register` (now returns name and whether the person has a password; no longer skips people with a password) and `app_password_confirm` (replaces the password, clears the lock, deletes the person's sessions).
- Intended behavior change: a person with a password who asks for a link now gets "Cambia tu contraseña" instead of nothing.
- Web: "Olvidé mi contraseña" opens the same email-only form as "Crear contraseña"; the notice says "elegir tu contraseña".
