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

```sh
docker compose up --build
```

Open `http://localhost:8080`. The API is served under `/api` by the same port; `GET /api/health`
answers `{"status":"ok"}` when the API reaches the database.

The `migrate` service applies pending migrations from `apps/api/migrations` before the API starts.

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
npm run dev:api     # needs DATABASE_URL
npm run dev:web     # proxies /api to localhost:3000
```

## Layout

- `apps/api` — Fastify API.
- `apps/web` — React application, served by nginx in Docker.
- `odd/tasks` — one feature document (specs, tasks, log) per increment, written before its code.
