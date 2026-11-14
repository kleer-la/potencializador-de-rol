# Sign in with email and password

Objective: an invited person can sign in with their own email and password, after confirming the email through a link sent by mail.
Branch: `feat/password-sign-in`, from `main` at `e15a4ed`. Delivery: work-unit commits; merge and push are the user's decisions.
Test runner: `npm test` (Vitest; project `api` needs Docker), `npm run typecheck`, `npm run build --workspace @potencializador/web`.

## Specs

S1. User's request: "Quiero agregar la opción de que alguien se registre con correo y contraseña propios, con validación con email"

S2. User decision (2026-11-14): "sólo invitados".
- Only a person who already exists (was invited) can create a password. The invitation model and organization isolation do not change.
- Registering never reveals whether an email was invited: the answer is the same for every email, and the mail is sent in the background.

S3. User decision (2026-11-14): "smtp genérico, usando google workspace".
- Mail goes out through SMTP, configured with `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASSWORD`, `SMTP_FROM`. Password sign-in is offered only when SMTP is configured.

S4. Flow (assumptions, not stated by the user; revised in L5):
- Register: email only. For an invited person without a password, a single-use link valid for 24 hours is mailed. Asking again before using it replaces the link. A person who already has a password gets no link and keeps the password.
- Confirm: the link opens `/?confirm=<token>`, where the person chooses the password (10 to 128 characters, stored as a scrypt hash). Saving it confirms the email and signs the person in. Opening the link alone changes nothing. An expired, used or unknown link answers `confirmation_failed` and the page explains it.
- Sign in: email + password opens a session like Google does. Any wrong combination answers `invalid_credentials`. After 5 failures in a row the password is locked for 15 minutes (`too_many_attempts`), also under concurrent requests.
- Out of scope: password reset and change (follow-up).

## Tasks

- [x] T1 — API: migration, password hashing, mailer port with SMTP adapter, register/confirm/sign-in routes, config, README. Specs: S1-S4. Route: inline. Risk: item 2 (authentication), item 5 (new dependency `nodemailer`). Commit: `e01ab21`, corrected in T3.
- [x] T2 — Web: email/password form and registration form in the sign-in panel, messages. Specs: S1, S2, S4. Route: inline. Risk: none. Commit: `8be87f3`, corrected in T3.
- [x] T3 — Correction of the verifier's blockers (L5): password chosen on the link page, atomic lockout. Specs: S4. Route: inline. Risk: item 2.

## Log

L1 (2026-11-14, user, original request): "Quiero agregar la opción de que alguien se registre con correo y contraseña propios, con validación con email"

L2 (2026-11-14, user decision): "sólo invitados" (see S2).

L3 (2026-11-14, user decision): "smtp genérico, usando google workspace" (see S3).

L4 (2026-11-14, T1/T2 evidence): API written before its tests (no RED observed, a process slip); web RED observed (6 failing), then GREEN. `npm test` 407 passed, typecheck and web build clean. Dependency `nodemailer@^10.5.0` (7.x had known advisories; `npm audit` clean on 10.5).

L5 (2026-11-14, independent verifier, two blockers reproduced):
1. Lockout bypassed by concurrent requests: the lock was read before scrypt and recorded after. 40 parallel logins gave 30 password checks and a success. Fix: `app_password_begin_attempt` reserves the check in one `UPDATE` before verifying (row lock serializes), success clears it.
2. Account takeover: the password was chosen at registration and activated by the invitee's click, so anyone knowing an invited email could set its password. Fix: registration takes only the email; the password is chosen on the page the link opens and stored on confirmation.
3. S4 said a failed link redirects to `/?error=verification_failed`; the link page explains `confirmation_failed` instead (submission, not page load, uses the link, so mail scanners cannot consume it). S4 rewritten.
Migration 0010 edited in place: it never left this unmerged branch.
Advisories kept as follow-ups: no rate limit on asking for links (mail bombing, Gmail quota) or on sign-in; the locked answer reveals that an email has a password; anyone can lock a person out for 15 minutes.

L6 (2026-11-14, user): real end-to-end test with Google Workspace SMTP validated by the user: "ya hice la prueba y funcionó bien".
