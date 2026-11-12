# Potencializador de rol

System to diagnose and develop the capabilities of people in a role. The conceptual base is in
[docs/Potencializador de rol — Base conceptual del sistema.md](docs/Potencializador%20de%20rol%20—%20Base%20conceptual%20del%20sistema.md).

## Run with Docker

Create a `.env` file at the repository root:

| Variable | Required | Default | Purpose |
| --- | --- | --- | --- |
| `POSTGRES_PASSWORD` | yes | — | Database password. Avoid characters that need URL encoding. |
| `POSTGRES_USER` | no | `potencializador` | Database user. |
| `POSTGRES_DB` | no | `potencializador` | Database name. |
| `WEB_PORT` | no | `8080` | Host port of the web application. |

```sh
docker compose up --build
```

Open `http://localhost:8080`. The API is served under `/api` by the same port; `GET /api/health`
answers `{"status":"ok"}` when the API reaches the database.

## Develop

Requires Node 22.18 or later (the API runs its TypeScript sources directly) and Docker.

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
