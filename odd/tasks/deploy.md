# Deploy to the shared server

Objective: run the application on the shared Kleer server (5.78.92.152, the one with crm, fugazzeta, eventer and website17) without putting the other applications at risk.
Branch: `feat/deploy`, from `main` at `3b6a34c`. Delivery: work-unit commits; merge, push and the first deploy are the user's decisions.
Test runner: `npm test` (Vitest; project `api` needs Docker), `npm run typecheck`.

## Specs

S1. User's request: "preparemos el despliegue de potencializador-de-rol", on the server where crm and fugazzeta run, "asumiendo que le ponemos límites estrictos de cpu y memoria".

S2. Decisions of the user (2026-11-16):
- Mechanism: docker compose on the server, the web container registered in the existing kamal-proxy (TLS by Let's Encrypt). The migrate one-shot keeps the owner credentials; the API only the restricted ones.
- Database: a new database in the shared `postgres` container, with an owner role of its own that is not superuser.
- Public address: `https://potencializador-de-rol.lab.kleer.la`.
- Images: "con una registry local (WSL)". The server pulls through an SSH reverse tunnel to the registry on the developer's machine; nothing is built on the server.

S3. Constraints found on the server (assumptions derived from measurements, not stated by the user):
- 4 vCPU, 7.6 GB RAM, about 2.8 GB available; no other container has limits. Hard limits: api 256 MB / 0.5 CPU, web 64 MB / 0.25 CPU, migrate 256 MB / 0.5 CPU.
- A build on the server already took production down once: images are built on the developer's machine only.
- kamal-proxy owns ports 80 and 443; the application publishes no port.
- The shared `postgres` is reached on the docker network `kamal`. The owner role has `CREATEROLE` but not `SUPERUSER`, so the migration runner must work without superuser.

## Tasks

- [x] T1 — API: the migration runner works when the owner is not superuser (PostgreSQL 16+ refuses `alter role ... nosuperuser nobypassrls` from a non-superuser); it still guarantees the application role cannot bypass Row Level Security. Specs: S2, S3. Route: inline. Risk: item 1 (tenant isolation).
- [x] T2 — Deploy files: `deploy/compose.yml` (limits, network `kamal`, no published ports), `deploy/deploy.sh` (build, push to the local registry, pull on the server through the tunnel, migrate, start, register in kamal-proxy), `deploy/.env.example`, README section. Specs: S2, S3. Route: inline. Risk: none for the code; the first deploy touches the shared server.

## Log

L1 (2026-11-16, user, original request): "evalúes si en el server donde están crm, fugazzeta, etc hay capacidad para una aplicación más". Measured: about 2.8 GB available, load 0.1, no OOM in 60 days. User stopped fugazzeta-qa to make room.

L2 (2026-11-16, T1 evidence before the change): `migrate-cli.ts` against a throwaway postgres:17 with owner `potencializador LOGIN CREATEROLE` fails in `ensureAppRole`: "permission denied to alter role — Only roles with the SUPERUSER attribute may change the SUPERUSER attribute."

L3 (2026-11-16, T1 evidence): RED observed first (2 new tests in `migrate.test.ts`, on a cluster of their own with a `LOGIN CREATEROLE` owner: "permission denied to alter role"), then GREEN. `npm test` 415 passed in 44 files, typecheck clean.
- `ensureAppRole` creates the role without privileges (PostgreSQL defaults), sets only `login` and the password, and refuses to run if the role is superuser, bypasses RLS, or creates databases or roles.
- Intended behavior change: a pre-existing role with one of those privileges used to be reset silently; now the migration stops with an error.
- Every real migration applies with a non-superuser owner.

L4 (2026-11-16, T2 evidence): `docker compose -f deploy/compose.yml config` valid (migrate only under its profile); both images build for linux/amd64 (api 311 MB, web 95 MB). SSH reverse tunnel checked against the server: its `localhost:5555/v2/` answers 200. The scripts were not run end to end: a local rehearsal with a simulated server was not approved, and the first deploy is the user's decision.
- Image tag: the commit (12 characters); `current` marks the running release on the server. The last 3 releases are kept.
- Not done: DNS record, OAuth/SMTP credentials, `.env` values. The database line for backups should also go to `util/databases.conf` in the fugazzeta repo, which `pg-backup-setup.sh` copies over the server's file.
