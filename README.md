# Potencializador de rol

System to diagnose and develop the capabilities of people in a role. The conceptual base is in
[docs/Potencializador de rol — Base conceptual del sistema.md](docs/Potencializador%20de%20rol%20—%20Base%20conceptual%20del%20sistema.md).

## Run with Docker

Create a `.env` file at the repository root:

| Variable | Required | Default | Purpose |
| --- | --- | --- | --- |
| `POSTGRES_PASSWORD` | yes | — | Password of the database owner, used only by migrations. Avoid characters that need URL encoding. |
| `APP_DB_PASSWORD` | yes | — | Password of `potencializador_app`, the restricted role the API connects as. Same character rule. |
| `POSTGRES_USER` | no | `potencializador` | Database user. |
| `POSTGRES_DB` | no | `potencializador` | Database name. |
| `WEB_PORT` | no | `8080` | Host port of the web application. |
| `PUBLIC_URL` | no | `http://localhost:8080` | Address the browser uses. Sign-in callbacks are built from it; with `https` the cookies are marked `Secure`. |
| `SESSION_TTL_HOURS` | no | `12` | Lifetime of a session. |
| `SUPER_ADMIN_EMAILS` | no | — | Comma-separated emails of the mentoring firm's people. Each is created as super administrator on start if no person has that email. |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | no | — | Enable sign-in with Google. Set both or neither. |
| `MICROSOFT_CLIENT_ID`, `MICROSOFT_CLIENT_SECRET` | no | — | Enable sign-in with Microsoft. Set both or neither. |
| `MICROSOFT_TENANT` | no | `common` | `common`, `organizations`, or one tenant id. |

```sh
docker compose up --build
```

Open `http://localhost:8080`. The API is served under `/api` by the same port; `GET /api/health`
answers `{"status":"ok"}` when the API reaches the database.

### Backups

`scripts/backup-db.sh` dumps the database of the running stack into
`~/backups/potencializador/potencializador_<timestamp>.sql.gz` and deletes dumps older than 30 days.
`POTENCIALIZADOR_BACKUP_DIR` and `POTENCIALIZADOR_BACKUP_RETENTION_DAYS` override both. The script
fails without writing a file when the `db` service is not running or the dump is incomplete.

To run it every day, schedule it with cron or a systemd user timer, for example:

```ini
# ~/.config/systemd/user/potencializador-db-backup.service
[Service]
Type=oneshot
ExecStart="/path/to/repo/scripts/backup-db.sh"

# ~/.config/systemd/user/potencializador-db-backup.timer
[Timer]
OnCalendar=*-*-* 03:00:00
Persistent=true

[Install]
WantedBy=timers.target
```

```sh
systemctl --user enable --now potencializador-db-backup.timer
```

To restore a dump over the database of the stack (the `potencializador_app` role must exist, which
the `migrate` service creates):

```sh
gunzip -c potencializador_<timestamp>.sql.gz \
  | docker compose exec -T db sh -c 'psql -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB"'
```

The `migrate` service applies pending migrations from `apps/api/migrations` before the API starts.
A migration that was applied is never edited: the runner stores a checksum and stops if a file
changed. Add a new file instead.

## Sign-in

People sign in with a Google or a Microsoft account, or with their email and a password. Access is
by invitation: a person signs in only if a person with that email already exists. On the first
sign-in the provider account is bound to the person, and later sign-ins use that binding, not the
email. With no provider and no mail configured the application starts, but nobody can sign in.

Register one application per provider and copy its client id and secret to `.env`:

| Provider | Where | Redirect URI |
| --- | --- | --- |
| Google | Google Cloud Console → APIs & Services → Credentials → OAuth client ID (Web application) | `<PUBLIC_URL>/api/auth/google/callback` |
| Microsoft | Microsoft Entra admin center → App registrations (Web platform) | `<PUBLIC_URL>/api/auth/microsoft/callback` |

Microsoft needs one more step. Entra does not verify the `email` claim, so the first sign-in is
accepted only when the token also carries `xms_edov` (email domain owner verified). In the app
registration, under Token configuration, add the optional ID token claims `email` and `xms_edov`.
Without them a Microsoft first sign-in is refused as not invited.

### Email and password

Offered only when mail is configured. Under "Crear contraseña" an invited person writes their email;
the system mails a link valid for 24 hours and for one use, and the person chooses the password on
the page that link opens (10 to 128 characters). Whoever asks for the link never chooses the
password, so knowing someone's email is not enough to take their account. Asking answers the same
for any email, so it does not reveal who was invited. Asking again replaces a pending link; a person
who already has a password gets no link. Five wrong passwords in a row lock sign-in with a password
for 15 minutes; the database counts each check before it runs, so parallel requests cannot exceed
that. Passwords are stored as scrypt hashes. There is no password reset yet.

| Variable | Required | Default | Meaning |
| --- | --- | --- | --- |
| `SMTP_HOST` | with the others | — | SMTP server, for example `smtp.gmail.com` |
| `SMTP_PORT` | no | `465` | 465 uses TLS from the start; any other port must offer STARTTLS |
| `SMTP_USER` | with the others | — | Account that sends |
| `SMTP_PASSWORD` | with the others | — | Its password; with Google, an app password |
| `SMTP_FROM` | with the others | — | Sender, for example `Potencializador de rol <no-reply@example.com>` |

With Google Workspace: turn on 2-Step Verification for the sending account, create an app password
at <https://myaccount.google.com/apppasswords>, and use `smtp.gmail.com`, port 465, the account's
address as `SMTP_USER` and the app password as `SMTP_PASSWORD`. `SMTP_FROM` must be that address
or an alias the account may send as.

## Roles

- **Super administrator**: a person of the mentoring firm. Creates organizations and may administer
  any of them for support. The first ones come from `SUPER_ADMIN_EMAILS`.
- **Administrator** of an organization: invites its people and assigns their roles.
- **Map designer** of an organization: no administration rights; used from the next increment on.

An email belongs to one person in the whole system. Inviting an email that already belongs to
another organization is refused without saying where it belongs.

## Capability maps

A map designer builds the capability map of a role: a maturity scale, bonus rules, and dimensions
with their capabilities, each linked to tools and strategic objectives from the organization's
catalogs. A version moves from draft to published to archived.

- A **draft** accepts any change and can be discarded.
- A **published** version only grows: new dimensions and new capabilities. Any other change needs a
  new version, which starts as a draft copy (invariant 10). The database refuses those changes too.
- An **archived** version accepts nothing.

A map can be imported from a JSON file in the format `potencializador.capability-map/v1`; tools
and objectives are named, matched ignoring case, and added to the catalogs when missing.
`data/maps/product-owner.json` is the Product Owner map of the first client, ready to import.

## Isolation by organization

Every table holds data of one organization and is protected by PostgreSQL Row Level Security.
The API reaches data only through `withScope` (`apps/api/src/infrastructure/scoped-transaction.ts`),
which declares the acting person and organization for one transaction; a query outside it sees no
rows. A new table needs its policies in the same migration: the test suite fails if the API role
can reach a table without Row Level Security. Tests of invariant 11 are titled `INV-11`.

## Develop

Requires Node 22.18 or later (the API runs its TypeScript sources directly) and Docker.
`npm test` starts a throwaway PostgreSQL container, so the Docker daemon must be running.

```sh
npm install
npm test            # Vitest
npm run typecheck
npm run dev:api     # needs DATABASE_URL and PUBLIC_URL
npm run dev:web     # proxies /api to localhost:3000
```

## Layout

- `packages/domain` — domain rules, with no framework or database dependency.
- `data/maps` — capability maps ready to import.
- `apps/api` — Fastify API.
- `apps/web` — React application, served by nginx in Docker.
- `odd/tasks` — one feature document (specs, tasks, log) per increment, written before its code.
