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

S4. Flow (assumptions, not stated by the user):
- Register: email + password (10 to 128 characters). For an invited person without a confirmed password, the password is stored as a scrypt hash and a single-use link valid for 24 hours is mailed. Registering again before confirming replaces the password and the link. A confirmed password is not changed by registering.
- Confirm: opening the link confirms the password and signs the person in. An expired, used or unknown link redirects to `/?error=verification_failed`.
- Sign in: email + confirmed password opens a session like Google does. Any wrong combination answers `invalid_credentials`. After 5 failures in a row the account is locked for 15 minutes (`too_many_attempts`).
- Out of scope: password reset and change (follow-up).

## Tasks

- [ ] T1 — API: migration, password hashing, mailer port with SMTP adapter, register/confirm/sign-in routes, config, README. Specs: S1-S4. Route: inline. Risk: item 2 (authentication), item 5 (new dependency `nodemailer`).
- [ ] T2 — Web: email/password form and registration form in the sign-in panel, messages. Specs: S1, S2, S4. Route: inline. Risk: none.

## Log

L1 (2026-11-14, user, original request): "Quiero agregar la opción de que alguien se registre con correo y contraseña propios, con validación con email"

L2 (2026-11-14, user decision): "sólo invitados" (see S2).

L3 (2026-11-14, user decision): "smtp genérico, usando google workspace" (see S3).
