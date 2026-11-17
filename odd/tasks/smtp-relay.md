# Mail through the Google Workspace SMTP relay

Objective: send the password links through the same SMTP relay Kleer's other applications use, which accepts the shared server by its address and needs no credentials.
Branch: `feat/smtp-relay`, from `main` at `d711f6e`. Delivery: work-unit commits; merge, push and deploy are the user's decisions.
Test runner: `npm test` (Vitest; project `api` needs Docker), `npm run typecheck`.

## Specs

S1. User's request: "Me gustaría configurar el servidor SMTP de la forma usual para nosotros, como en fugazzeta. Me ayudás con eso y con cualquier cambio que haya que hacer en el código?"

S2. How fugazzeta sends (read from its `config/environments/production.rb` and `config/deploy.yml`): `smtp-relay.gmail.com`, port 587, STARTTLS, no user or password in production (the relay accepts the server's address), EHLO domain `kleer.la`.

S3. Changes (assumptions, not stated by the user):
- `SMTP_USER` and `SMTP_PASSWORD` become optional: both or neither, and only with `SMTP_HOST`. `SMTP_HOST` and `SMTP_FROM` stay required together. Without credentials the mailer does not authenticate.
- The server greets with the host of `PUBLIC_URL`: Google's relay refuses a greeting that is not a full domain name, and nodemailer's default is the container id.
- The one-account setup (`smtp.gmail.com`, 465, app password) keeps working.

## Tasks

- [x] T1 — API: optional SMTP credentials, EHLO name from `PUBLIC_URL`, tests, README and both `.env.example`. Specs: S2, S3. Route: inline. Risk: item 2 (authentication: password links depend on mail).
- [ ] T2 — Production: SMTP variables in the server's `.env`, deploy, and one real link received. Specs: S1. Route: inline. Risk: touches the shared server.

## Log

L1 (2026-11-17, user, original request): see S1.

L2 (2026-11-17, T1 evidence): RED observed first (5 failing: 3 in `config.test.ts`, 2 in the new `mailer.test.ts`), then GREEN. `npm test` 418 passed in 45 files, typecheck clean.
- `SmtpSettings` now has `auth?` and `clientName`; `smtpTransportOptions` is exported so the options handed to nodemailer are tested without a server.
- Error messages changed: "SMTP_HOST and SMTP_FROM must be set together" and "SMTP_USER and SMTP_PASSWORD must be set together, and only with SMTP_HOST".
