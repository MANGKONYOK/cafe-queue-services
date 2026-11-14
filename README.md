# Omkoi Station (สถานีอมก๋อย) — Cafe Queue & Services

CPE 334 group project, Theme 9 Queue and Service Management. Walk-in guests join a counter's queue and follow their turn; baristas call the next guest, serve and close tickets. Design documents live in [`docs/`](docs/) (SRS, features, traceability, system SDS, sprint plan and Sprint 1 contracts).

| Part | Stack |
| --- | --- |
| `client/` | React 18, Vite, TypeScript, Tailwind CSS 4, React Router |
| `server/` | Node.js 20+, Express 4, TypeScript, `express-session` + `connect-pg-simple`, `bcryptjs`, `zod` |
| Database | PostgreSQL 16, numbered SQL migrations (`node-pg-migrate`), idempotent seed |
| Tests | Vitest + Supertest against a real PostgreSQL test database; Vitest + Testing Library for the client |

## 1. Prerequisites

- Node.js 20 or newer, npm 10+
- Docker (for the local PostgreSQL 16 container), or any PostgreSQL 16 you can reach

## 2. Configure

```bash
cp server/.env.example server/.env
```

`server/.env.example` holds the key names only. Fill in every value in `server/.env`:

| Variable | Purpose |
| --- | --- |
| `PORT` | API port (`3000` if left empty) |
| `NODE_ENV` | `development` (if empty), `test` or `production` |
| `DATABASE_URL` | Development database: `postgresql://<user>:<password>@localhost:<port>/<database>` |
| `TEST_DATABASE_URL` | Separate database used by `npm run test:server`, e.g. the same server with database `omkoi_queue_test` (created and migrated automatically) |
| `SESSION_SECRET` | Random string (`openssl rand -hex 32`); in `production` the server refuses to start unless it is at least 32 characters |
| `SEED_ADMIN_PASSWORD`, `SEED_STAFF_PASSWORD`, `SEED_CUSTOMER_PASSWORD` | Passwords for the seeded accounts; `db:seed` refuses to run without them |
| `POSTGRES_USER`, `POSTGRES_PASSWORD`, `POSTGRES_DB` | Credentials for the local Docker database (`docker-compose.yml` reads them from `server/.env`); must match `DATABASE_URL` |

`server/.env` is ignored by Git. Never commit real values; `npm run check:secrets` scans the tracked files.

## 3. Database

```bash
npm run db:up                      # PostgreSQL 16 on localhost:5432 (dev + test databases), credentials from server/.env
# DB_PORT=5434 npm run db:up       # if 5432 is taken; then use :5434 in server/.env
npm run install:all                # npm ci in server/ and client/
npm run db:migrate                 # apply server/db/migrations
npm run db:seed                    # 5 accounts, 4 counters (safe to re-run)
```

Seeded accounts (passwords are the `SEED_*` values from your `server/.env`; test accounts for markers are shared privately, never in Git):

| Email | Role | Notes |
| --- | --- | --- |
| `admin@omkoi.coffee` | `ADMIN` | Station manager, every counter |
| `barista@omkoi.coffee` | `STAFF` | Slow Bar and Espresso Bar (assignments arrive with F-03) |
| `dessert@omkoi.coffee` | `STAFF` | Dessert Lounge (assignments arrive with F-03) |
| `boom@omkoi.coffee`, `hongtae@omkoi.coffee` | `CUSTOMER` | Guests |

Counters: `SLOW_BAR` (SB), `ESPRESSO_BAR` (EB), `DESSERT_LOUNGE` (DL), `ROASTERY_CONSULT` (RC, seeded paused).

## 4. Run

```bash
npm run dev:server     # API on http://localhost:3000
npm run dev:client     # UI on http://localhost:5173 (proxies /api to :3000)
```

Production-style: `npm run build`, then `NODE_ENV=production npm --prefix server start` serves the API and the built client from one origin (session cookies are `Secure` in production, so use HTTPS).

## 5. Test

```bash
npm run test:server    # API + DB integration tests (needs the database from step 3)
npm run test:client    # component tests (jsdom)
npm run typecheck
npm run check:secrets
```

Test IDs (`TEST-xx`) in the test names match `docs/sprints/sprint-1/sts-and-dod.md`.

## 6. API (Sprint 1 so far)

| Method | Path | Access |
| --- | --- | --- |
| `GET` | `/api/health`, `/api/ready` | Public (`/ready` returns `503` when the database is down) |
| `POST` | `/api/auth/login` | Public |
| `GET` | `/api/auth/me` | Signed in |
| `POST` | `/api/auth/logout` | Signed in |
| `GET` | `/api/categories` | Signed in |

Errors use one envelope: `{ "error": { "code", "message", "details" } }`. Full contracts: [`docs/system-sds.md`](docs/system-sds.md) section 3.

## 7. Workflow

`main` ← `staging` ← `feature/*` / `docs/*`. Each issue gets a branch from `staging`, a PR into `staging` reviewed by the other member, and the release PR `staging → main` is tagged.
