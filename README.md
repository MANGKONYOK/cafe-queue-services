# Omkoi Station (สถานีอมก๋อย) - Cafe Queue & Services

CPE 334 group project, Theme 9 Queue and Service Management. Walk-in guests join a counter's queue and follow their turn baristas call the next guest, serve and close tickets. Design documents live in [`docs/`](docs/) (SRS, features, traceability, system SDS, sprint plan and Sprint 1 contracts).

| Part | Stack |
| --- | --- |
| `client/` | React 18, Vite, TypeScript, Tailwind CSS 4, React Router |
| `server/` | Node.js 20+, Express 4, TypeScript, `express-session` + `connect-pg-simple`, `bcryptjs`, `zod` |
| Database | PostgreSQL 16, numbered SQL migrations (`node-pg-migrate`), idempotent seed |
| Tests | Vitest + Supertest against PostgreSQL; Vitest + Testing Library for the client; Playwright for responsive E2E |

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
| `DB_PORT` | Host port of the local Docker database (`5432` if empty); use another, e.g. `5434`, when 5432 is taken, and the same port in both URLs |

`server/.env` is ignored by Git. Never commit real values; `npm run check:secrets` scans the tracked files.

## 3. Database

```bash
npm run db:up                      # PostgreSQL 16 on localhost:$DB_PORT (dev + test databases), all settings from server/.env
npm run install:all                # npm ci in server/, client/ and e2e/
npm run db:migrate                 # apply server/db/migrations
npm run db:seed                    # 5 accounts, 4 counters (safe to re-run)
```

Seeded accounts (passwords are the `SEED_*` values from your `server/.env`; test accounts for markers are shared privately, never in Git):

| Email                                       | Role       | Notes                                                                                                                |
| ------------------------------------------- | ---------- | -------------------------------------------------------------------------------------------------------------------- |
| `admin@omkoi.coffee`                        | `ADMIN`    | Station manager: every counter, plus **Counters** (`/admin`) to create, edit, pause/resume counters and assign staff |
| `barista@omkoi.coffee`                      | `STAFF`    | Assigned to Slow Bar and Espresso Bar                                                                                |
| `dessert@omkoi.coffee`                      | `STAFF`    | Assigned to Dessert Lounge                                                                                           |
| `boom@omkoi.coffee`, `hongtae@omkoi.coffee` | `CUSTOMER` | Guests                                                                                                               |

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
npm run e2e            # Playwright: journey (TEST-19) at 375/768/1280 px + admin counters at 1280 px, in your installed Google Chrome;
                       # builds the client, resets + seeds the TEST database, serves on :3100
npm run test:all       # all three
npm run typecheck
npm run check:secrets
```

Test IDs (`TEST-xx`) in the test names match `docs/sprints/sprint-1/sts-and-dod.md`.

## 6. API (Sprint 1)

| Method | Path | Access |
| --- | --- | --- |
| `GET` | `/api/health`, `/api/ready` | Public (`/ready` returns `503` when the database is down) |
| `POST` | `/api/auth/login` | Public |
| `GET` | `/api/auth/me` | Signed in |
| `POST` | `/api/auth/logout` | Signed in |
| `GET` | `/api/categories` | Signed in (each counter with `waitingCount`) |
| `POST` | `/api/categories` | Admin: create a counter (`code`, `prefix`, `name`, `estMinsPerTicket`, optional `description`, `isOpen`) |
| `PATCH` | `/api/categories/:id` | Admin: edit name, description, minutes, or pause/resume with `isOpen` |
| `PUT` | `/api/categories/:id/staff` | Admin: set the staff on a counter (`staffIds`) |
| `GET` | `/api/staff` | Admin: staff accounts and their counters |
| `POST` | `/api/tickets` | Customer: join a counter (`categoryId`, `partySize` 1-8, optional `specialRequests`) |
| `GET` | `/api/tickets/my` | Signed in: own tickets with `aheadCount` and `estWaitMins` |
| `GET` | `/api/tickets/:id` | Owner customer; staff on that counter; admin |
| `POST` | `/api/tickets/:id/cancel` | Owner while `WAITING`; staff on that counter while `WAITING`/`CALLED`; admin |
| `GET` | `/api/tickets?categoryId=&status=` | Staff (assigned counters), admin |
| `POST` | `/api/categories/:id/call-next` | Staff on that counter, admin: calls the oldest `WAITING` ticket |
| `POST` | `/api/tickets/:id/serve`, `/complete`, `/no-show` | Staff on that counter, admin |

Errors use one envelope: `{ "error": { "code", "message", "details" } }`. Full contracts: [`docs/system-sds.md`](docs/system-sds.md) section 3.

## 7. Documentation & Sprint Scope Summary

Design contracts and specifications live in [`docs/`](docs/):

| Document | Scope & Key Contents |
| --- | --- |
| [`docs/srs.md`](docs/srs.md) | Domain context (4 counters: `SB`, `EB`, `DL`, `RC`), actors (`CUSTOMER`, `STAFF`, `ADMIN`), scope/exclusions, `FR-01`..`FR-10`, `BR-01`..`BR-12`, `NFR-01`..`NFR-06`, architectural decisions, assumptions and open questions (`Q-01`..`Q-05`). |
| [`docs/features.md`](docs/features.md) | Feature catalog (`F-01`..`F-08`) across Sprints 1-3 and dependency graph. |
| [`docs/system-sds.md`](docs/system-sds.md) | 3-tier architecture (React 18/Vite + Express/Node 20 + PostgreSQL 16), ER model, migrations `001`-`003`, idempotent seed, UI/API contracts, RBAC security matrix, 8 h session lifecycle and Cloud Run delivery plan. |
| [`docs/sprints/plan.md`](docs/sprints/plan.md) | Three-sprint roadmap, Lab 5 container/CI/GCP plan and risk mitigations. |
| [`docs/sprints/sprint-1/f01-auth-and-categories.md`](docs/sprints/sprint-1/f01-auth-and-categories.md) | `F-01` contract: login, `/me`, logout, service directory with `waitingCount` (`AC-01`..`AC-03`, `AC-13`). |
| [`docs/sprints/sprint-1/f02-customer-walkin-queue.md`](docs/sprints/sprint-1/f02-customer-walkin-queue.md) | `F-02` contract: join transaction, `aheadCount` + `estWaitMins`, customer cancel while `WAITING` (`AC-04`..`AC-09`, `AC-16`). |
| [`docs/sprints/sprint-1/f03-staff-counter-lifecycle.md`](docs/sprints/sprint-1/f03-staff-counter-lifecycle.md) | `F-03` contract: assigned counter tabs, FIFO `call-next`, `serve`, `complete`, `no-show`, `cancel` (`AC-10`..`AC-12`, `AC-14`..`AC-15`). |
| [`docs/sprints/sprint-1/f04-admin-counters.md`](docs/sprints/sprint-1/f04-admin-counters.md) | `F-04` contract (moved into Sprint 1 via `C-18`): create/edit/pause counters and manage `staff_counters` (`AC-17`..`AC-20`). |
| [`docs/sprints/sprint-1/sts-and-dod.md`](docs/sprints/sprint-1/sts-and-dod.md) | Test matrix (`TEST-01`..`TEST-25`, `MC-01`), Red->Green TDD plan and Sprint 1 Definition of Done checklist. |
| [`docs/traceability.md`](docs/traceability.md) | Master `FR`/`BR`/`NFR` -> `Feature` -> `AC` -> `TEST` matrix, coverage gaps and approved changes (`C-01`..`C-20`). |

## 8. Workflow

`main` ← `staging` ← `feature/*` / `docs/*`. Each issue gets a branch from `staging`, a PR into `staging` reviewed by the other member, and the release PR `staging → main` is tagged.