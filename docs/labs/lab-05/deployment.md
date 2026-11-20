# Omkoi Station (`cafe-queue-services`) — Cloud Deployment & CI/CD Runbook (Lab 5)

This runbook documents the production architecture, Sprint 1 cloud-readiness baseline, environment configuration, GCP resources, and repeatable release/rollback procedures for **Omkoi Station** (`cafe-queue-services`), fulfilling Lab 5 requirements **`R-02`**, **`R-04`**, **`R-07`**, and **`R-08`**.

---

## 1. Application Stack, Sprint 1 Feature Scope & Starter Kit Adaptations

### 1.1 Sprint 1 Vertical Slice Deployed (`F-01` to `F-04`)
| Feature ID | Feature Name | Cloud-Deployed Capabilities | Primary Modules |
| :---: | :--- | :--- | :--- |
| **`F-01`** | **Auth, PG Sessions & Counter Directory** | Email/password sign-in (`bcrypt` cost 10), 8h fixed PostgreSQL sessions (`connect-pg-simple` in `user_sessions`), `/api/auth/me`, `/api/auth/logout`, `/api/health`, `/api/ready` (`SELECT 1`), and counter directory (`GET /api/categories` with live `waitingCount`). | `server/src/routes/auth.ts`, `middleware/auth.ts`, `session.ts`, `routes/health.ts`, `client/src/pages/LoginPage.tsx` |
| **`F-02`** | **Customer Walk-In Queue Joining & Tracking** | Walk-in ticket creation (`POST /api/tickets`, `partySize` 1–8, optional `specialRequests` <=280 chars), sequential `<PREFIX>-<NNN>` codes (`SB`, `EB`, `DL`, `RC`), live `aheadCount`/`estWaitMins`, customer self-cancel while `WAITING` (`3–200` char reason), and `409` duplicate/closed counter guards. | `server/src/services/tickets.ts` (`joinQueue`), `routes/tickets.ts`, `client/src/pages/QueuePage.tsx` |
| **`F-03`** | **Staff Counter Console & Service Lifecycle** | Counter-scoped staff queues (`staff_counters` enforced via `canOperate`), concurrency-safe FIFO `POST /api/categories/:id/call-next` (`FOR UPDATE SKIP LOCKED`), state machine (`WAITING -> CALLED -> SERVING -> COMPLETED / NO_SHOW / CANCELLED`), mandatory notes, and immutable `ticket_events` audit rows. | `server/src/services/tickets.ts` (`callNext`), `services/access.ts`, `client/src/pages/StaffPage.tsx` |
| **`F-04`** | **Admin Counter Management & Pause/Resume** | Admin counter CRUD (`POST /api/categories`, `PATCH /api/categories/:id`), live `isOpen` pause/resume, staff directory (`GET /api/staff`), and staff-to-counter assignment (`PUT /api/categories/:id/staff`) via `/admin`. | `server/src/routes/categories.ts`, `routes/staff.ts`, `client/src/pages/AdminPage.tsx` |

### 1.2 Six-Point Cloud-Readiness Verification
1. **Stateless Container / Zero Local Disk Storage (`R-04`):** No `multer` disk uploads or in-memory state arrays exist. All application records and sessions persist in PostgreSQL 16 across container restarts and Cloud Run rollbacks.
2. **Idempotent Natural-Key Seeding:** `server/src/db/seed.ts` uses `ON CONFLICT (email) DO UPDATE` for seeded users, `ON CONFLICT (code) DO UPDATE` for service categories (preserving admin-toggled `is_open` state on re-seed), and `ON CONFLICT DO NOTHING` for `staff_counters`. Production seeding executes compiled JS (`npm run db:seed:prod` -> `node dist/db/seed-cli.js`) reading `SEED_*_PASSWORD` variables strictly from the environment.
3. **Production Fail-Fast & Proxy Trust:** `loadConfig()` in `server/src/config.ts` refuses to start when `NODE_ENV=production` unless `SESSION_SECRET` is at least 32 characters and not `"change-me"`. When `config.isProduction` is true, `server/src/app.ts` enables `app.set("trust proxy", 1)` for secure session cookies behind Cloud Run's TLS load balancer.
4. **PostgreSQL-Backed User Sessions (`R-04`):** Express sessions use `connect-pg-simple` targeting table `user_sessions` (`cookie: connect.sid`, 8h non-rolling expiration).
5. **Environment-Driven Port & Same-Origin SPA Serving:** `server/src/index.ts` binds to `0.0.0.0` on `Number(process.env.PORT) || 3000` and passes `/app/client/dist` as `clientDist` to `createApp()`, serving API routes (`/api/*`) and built React assets from one Cloud Run container.
6. **Health & DB Readiness Probes (`NFR-04`):** `GET /api/health` returns `200 {"status":"ok"}` and `GET /api/ready` runs `SELECT 1` against PostgreSQL, returning `200 {"status":"ready","db":"connected"}` or `503 {"status":"not_ready","db":"disconnected"}`.

### 1.3 Intentional Changes from `toktickit-lab5-starter` Reference Stack
- **SQL Migrations instead of Prisma:** Omkoi Station uses pure `pg` with `node-pg-migrate` (`server/db/migrations/001`–`003`) via `npm run db:migrate` and compiled seeding via `npm run db:seed:prod` instead of Prisma (`openssl` and `prisma migrate deploy` are omitted from the Dockerfile).
- **Explicit Session & Multi-Role Seed Secrets:** Unlike the starter kit's two password secrets, Omkoi Station enforces `SESSION_SECRET` (`omkoi-session-secret`) and three role seed passwords (`omkoi-admin-password`, `omkoi-staff-password`, `omkoi-customer-password`) stored individually in Google Secret Manager with per-secret least-privilege IAM bindings on `omkoi-queue-runner`.
- **Cookie-Authenticated Endpoints:** `GET /api/categories` requires an authenticated session (`401` when logged out, returns `{"categories": [...]}` when signed in), and `/api/auth/login` uses HTTP-only cookies (`connect.sid`) rather than bearer JWTs, so [`deploy/smoke_test.py`](../../../deploy/smoke_test.py) validates unauthenticated `401` behavior publicly and uses `http.cookiejar.CookieJar` when optional login smoke credentials are supplied.

---

## 2. Environment Variables & Secrets Configuration (`R-02`)

Zero secrets are committed to Git. All `.env.example` files contain empty key names only (`scripts/check-secrets.sh` / `TEST-20`). Local development uses `server/.env` (gitignored), CI uses an ephemeral `POSTGRES_HOST_AUTH_METHOD=trust` database inside `.github/workflows/ci-docker.yml`, and Cloud Run injects runtime secrets from Google Secret Manager *(provisioned in Issues #11–#12)*.

| Variable Name | Secret? | Purpose | Local Development Source | Production (GCP Cloud Run) Source |
| :--- | :---: | :--- | :--- | :--- |
| `PORT` | No | HTTP port listened on by Express (`0.0.0.0`) | `server/.env` (`3000`) | Cloud Run env (`3000`) |
| `NODE_ENV` | No | Runtime mode (`development`, `test`, `production`) | `server/.env` (`development`) | Cloud Run env (`production`) |
| `DATABASE_URL` | **Yes** | PostgreSQL 16 connection URI (TCP locally; Unix socket `/cloudsql/...` on Cloud Run) | `server/.env` (`postgresql://<user>:<password>@localhost:5432/omkoi_queue`) | Secret Manager (`omkoi-database-url:latest`) |
| `PG_POOL_MAX` | No | PostgreSQL connections per process (1–50, default `10`). Cloud Run sets `5`, so 3 instances (15) plus the migrate job stay under `db-f1-micro`'s 25 connections | `server/.env` (empty = `10`) | Cloud Run env (`5`, set by `deploy/deploy.sh`) |
| `TEST_DATABASE_URL` | **Yes** | Isolated test database URI for Vitest suites (`TEST-01`..`TEST-25`) | `server/.env` (`postgresql://<user>:<password>@localhost:5432/omkoi_queue_test`) | CI workflow service DB only (not needed in Cloud Run) |
| `SESSION_SECRET` | **Yes** | Signs `connect.sid` cookies; must be >= 32 chars in `production` | `server/.env` | Secret Manager (`omkoi-session-secret:latest`) |
| `SEED_ADMIN_PASSWORD` | **Yes** | Password hashed (`bcrypt` cost 10) for seeded `admin@omkoi.coffee` | `server/.env` | Secret Manager (`omkoi-admin-password:latest`) on migrate job |
| `SEED_STAFF_PASSWORD` | **Yes** | Password hashed (`bcrypt` cost 10) for `barista@omkoi.coffee` & `dessert@omkoi.coffee` | `server/.env` | Secret Manager (`omkoi-staff-password:latest`) on migrate job |
| `SEED_CUSTOMER_PASSWORD` | **Yes** | Password hashed (`bcrypt` cost 10) for `boom@omkoi.coffee` & `hongtae@omkoi.coffee` | `server/.env` | Secret Manager (`omkoi-customer-password:latest`) on migrate job |
| `POSTGRES_USER` | No | Local Docker Compose PostgreSQL superuser | `server/.env` | Cloud SQL instance user (`omkoi_user`, managed by `deploy.sh`) |
| `POSTGRES_PASSWORD` | **Yes** | Local Docker Compose PostgreSQL password | `server/.env` | Cloud SQL generated password stored in `omkoi-database-url` |
| `POSTGRES_DB` | No | Primary application PostgreSQL database name | `server/.env` (`omkoi_queue`) | Cloud SQL database (`omkoi_queue`) |
| `DB_PORT` | No | Host port mapped by local `docker-compose.yml` | `server/.env` (`5432`) | Not used in Cloud Run (connects via Cloud SQL Unix socket) |

---

## 3. Local Build, Migrate, Seed, Test & Run Commands

From the repository root (`cafe-queue-services/`):

1. **Copy templates and configure local environment:**
   - Copy `.env.example` (or `server/.env.example`) to `server/.env` and fill in values (never commit `server/.env`).
2. **Install dependencies & start local PostgreSQL 16:**
   ```bash
   npm run install:all
   npm run db:up
   ```
3. **Run SQL migrations and idempotent seed:**
   ```bash
   npm run db:migrate
   npm run db:seed
   ```
4. **Build TypeScript server (`dist/`) & Vite React client (`client/dist/`), then run production build locally:**
   ```bash
   npm run build
   npm --prefix server run db:seed:prod
   npm --prefix server start
   ```
   *(For local hot-reload development, run `npm run dev:server` and `npm run dev:client` in separate terminals.)*
5. **Run all verification suites & secret scan:**
   ```bash
   npm run typecheck
   npm run test:server
   npm run test:client
   npm run e2e
   npm run check:secrets
   ```
6. **Build & run unified production Docker container locally (Issue #9 / `C-03`):**
   > **Note:** The production `Dockerfile` defaults `NODE_ENV=production` (`Secure` cookies behind Cloud Run HTTPS). Local `docker-compose.yml` overrides `NODE_ENV=development` on the `app` service so `connect.sid` session cookies work over plain `http://localhost:3000`, and sets `COMPOSE_DB_HOST=db` so `docker-entrypoint.sh` routes `DATABASE_URL` to the Compose `db` container.
   The root scripts always pass `--env-file server/.env`, so `DB_PORT` and `PORT` come from your env file (plain `docker compose up` falls back to host port `5432`, which may already be taken).
   ```bash
   npm run stack:up       # build the image; start db, run migrate (db:migrate + db:seed:prod), then app
   npm run stack:ps       # migrate: Exited (0); db: healthy; app: Up
   curl -s http://localhost:3000/api/health
   curl -s http://localhost:3000/api/ready
   npm run stack:restart  # restart the app container; sessions and tickets stay in the omkoi-db volume
   npm run stack:logs     # follow the app logs (Ctrl+C to stop following)
   npm run stack:down     # stop and remove containers; the omkoi-db volume (data) is kept
   ```

---

## 4. GCP Project, Region & Resource Names *(Live Provisioning in Issues #11–#12)*

> **Status:** `deploy/deploy.sh`, `deploy/release.sh`, `deploy/teardown.sh`, `deploy/smoke_test.py`, and `.github/workflows/ci-docker.yml` are implemented on this branch (**Issue #10**). Cloud SQL/Cloud Run provisioning (`deploy.sh`), WIF/IAM bindings, `protect-main`, and `.github/workflows/deploy.yml` run in **Issues #11–#12**.

Deployment scripts (`deploy/deploy.sh`, `deploy/release.sh`, `deploy/teardown.sh`) and GitHub Actions workflows reference these consistent identifiers:

| Resource | Identifier / Setting | Notes |
| :--- | :--- | :--- |
| **GCP Region** | `asia-southeast1` | Passed as `GCP_REGION` in GitHub `demo` Environment |
| **Artifact Registry Repo** | `omkoi-queue` | Format: Docker (`asia-southeast1-docker.pkg.dev/<PROJECT_ID>/omkoi-queue/omkoi-queue`) |
| **Cloud SQL Instance** | `omkoi-queue-db` | `POSTGRES_16`, `--edition=enterprise`, `--tier=db-f1-micro`, `--no-storage-auto-increase` |
| **Cloud SQL Database / User** | `omkoi_queue` / `omkoi_user` | Unix socket `/cloudsql/<PROJECT_ID>:asia-southeast1:omkoi-queue-db` |
| **Cloud Run Service** | `omkoi-queue` | Public HTTPS (`--allow-unauthenticated`), port `3000`, `min-instances=0`, `max-instances=3`, `512Mi` |
| **Cloud Run Migration Job** | `omkoi-queue-migrate` | Runs `npm run db:migrate && npm run db:seed:prod` before every service update |
| **Runtime Service Account** | `omkoi-queue-runner` | Least-privilege IAM: `roles/cloudsql.client` + per-secret `roles/secretmanager.secretAccessor` |
| **GitHub Deployer SA** | `omkoi-queue-deployer` | Authenticated keyless via WIF (`roles/run.developer`, repo-scoped `roles/artifactregistry.writer`, `roles/iam.serviceAccountUser`) |
| **Workload Identity Pool / Provider** | `github-actions` / `github-main` | Locked to `MANGKONYOK/cafe-queue-services`, `refs/heads/main`, `deploy.yml`, `environment:demo` |
| **Secret Manager Secrets** | `omkoi-database-url`, `omkoi-session-secret`, `omkoi-admin-password`, `omkoi-staff-password`, `omkoi-customer-password` | Created idempotently by `deploy/deploy.sh` |

---

## 5. Repeatable Release, Running Commit Check & Rollback Procedure (`R-07`, `R-08`)

> **Status:** `.github/workflows/ci-docker.yml` (`test-and-docker`) and `deploy/*` scripts are implemented (**Issue #10**). `protect-main`, WIF, live Cloud Shell provisioning, and `.github/workflows/deploy.yml` arrive in **Issues #11–#12**.

### 5.1 Standard Release Pipeline (`feature/* -> staging -> main`)
1. Create a GitHub Issue labeled `lab5` on the 6-column Kanban board and branch off `staging`.
2. Open a Pull Request into `staging`; verify `.github/workflows/ci-docker.yml` (`test-and-docker`) passes (`R-05`). Teammate reviews with specific technical comments and merges (`Author != Reviewer`, `R-09`).
3. Open a **Release PR** from `staging` into `main`. GitHub ruleset `protect-main` (empty bypass list, configured in Issue #11) requires 1 teammate approval and green `test-and-docker` before merge (`R-06`).
4. Merging into `main` triggers `.github/workflows/deploy.yml` (configured in Issue #12, `R-07`):
   - Re-runs `test-and-docker`,
   - Authenticates to GCP via Workload Identity Federation (no JSON key files),
   - Builds and pushes image tagged with the 40-character `GITHUB_SHA`,
   - Executes `deploy/release.sh` (resolves immutable `@sha256` digest -> updates and runs `omkoi-queue-migrate` -> updates `omkoi-queue` Cloud Run service and routes 100% traffic to latest),
   - Runs `python3 deploy/smoke_test.py "$SERVICE_URL"`.

### 5.2 Identifying Which Commit Is Running in Production (`R-08`) *(Planned — Issues #11–#12)*
Run either command in Cloud Shell / terminal (or inspect the **Revisions** tab in Google Cloud Console for `omkoi-queue` and the `Deploy demo` GitHub Actions job summary):
```bash
gcloud run services describe omkoi-queue --region asia-southeast1 \
  --format="value(status.latestReadyRevisionName,spec.template.spec.containers[0].image)"
gcloud artifacts docker images describe \
  "asia-southeast1-docker.pkg.dev/<PROJECT_ID>/omkoi-queue/omkoi-queue:<40_CHAR_SHA>" \
  --format="value(image_summary.fully_qualified_digest)"
```
Match the active revision's `@sha256:...` digest to the commit tag `<40_CHAR_SHA>` in Artifact Registry / GitHub Actions step summary.

### 5.3 Rollback & Roll-Forward Procedure (`R-08`) *(Planned — Issue #12)*
1. Find the full **40-character commit SHA** of the target prior release in GitHub (`main` history or previous `Deploy demo` run summary).
2. In GitHub **Actions -> Deploy demo -> Run workflow**, paste that 40-char SHA into **`image_tag`** and click **Run workflow**.
3. When `image_tag` is set, `deploy.yml` skips tests, image build, and migrations (`ROLLBACK=true`) and switches `omkoi-queue` directly to the previously built immutable `@sha256` digest. Because data and `user_sessions` reside in Cloud SQL, signed-in sessions and queue tickets persist across rollbacks.
4. To roll forward, trigger **Run workflow** again with an empty `image_tag` (or the newer 40-char SHA).
