# Lab 5 Deployment — Omkoi Station (`cafe-queue-services`)

How Omkoi Station is configured, built, tested, deployed to Google Cloud and released. This is the Lab 5 runbook (handout §4.3) for `R-02`, `R-04`, `R-07` and `R-08`.

| keyword | abstract |
| :--- | :--- |
| project | GCP `omkoi-515303`, region `asia-southeast1` |
| live URL | https://omkoi-queue-tdt4pxa64a-as.a.run.app |
| released | `v2.3.0` (`bd2f69e`) → Cloud Run revision `omkoi-queue-00002-pgw` |
| scripts | `deploy/deploy.sh` (first deploy) · `deploy/setup-wif.sh` (GitHub sign-in) · `deploy/release.sh` (every release) · `deploy/smoke_test.py` · `deploy/teardown.sh` |
| workflows | `.github/workflows/ci-docker.yml` (job `test-and-docker`) · `.github/workflows/deploy.yml` (Issue #12) |

---

## 1. Stack and Changes from the Starter Kit

| keyword | abstract |
| :--- | :--- |
| reference stack | Same as the kit: Artifact Registry, Cloud Run, Cloud SQL for PostgreSQL, Secret Manager, GitHub Actions |
| one image | Express serves the API (`/api/*`) and the built React client from one container on port 3000 |
| migrations | `pg` + `node-pg-migrate` (`server/db/migrations/001`–`003`, `npm run db:migrate`) instead of Prisma |
| seed | compiled `npm run db:seed:prod` (`node dist/db/seed-cli.js`), passwords only from `SEED_*` |
| secrets | `SESSION_SECRET` + three role seed passwords instead of the kit's two, each its own Secret Manager secret |
| auth | HTTP-only session cookie `connect.sid` (PostgreSQL `user_sessions`), not bearer tokens |
| smoke test | checks the public `401` on `/api/categories`; optional login uses a cookie jar |

The design choices come from the D1 SRS/SDS. Because the app uses its own SQL migrations and cookie sessions, the kit's Prisma steps were removed from the `Dockerfile`, and the migrate job runs `npm run db:migrate && npm run db:seed:prod` from the same image. Everything else follows the kit's names and flow, renamed from `toktickit` to `omkoi-queue`.

### 1.1 Sprint 1 Features Deployed (`F-01`–`F-04`)

| keyword | abstract |
| :--- | :--- |
| `F-01` sign-in | email/password (`bcrypt` cost 10), 8-hour PostgreSQL sessions, `/api/auth/me`, `/api/auth/logout`, `/api/health`, `/api/ready`, counter list with `waitingCount` |
| `F-02` join queue | `POST /api/tickets` (party 1–8, request ≤ 280 chars), codes `SB/EB/DL/RC-NNN`, `aheadCount` / `estWaitMins`, self-cancel while `WAITING`, `409` on duplicate or paused counter |
| `F-03` counter service | staff only on assigned counters, FIFO `POST /api/categories/:id/call-next` (`FOR UPDATE SKIP LOCKED`), `WAITING → CALLED → SERVING → COMPLETED / NO_SHOW / CANCELLED`, `ticket_events` audit |
| `F-04` admin counters | create and edit counters, pause and resume, staff list, staff-to-counter assignment on `/admin` |

These are the Sprint 1 features released in D1 (`v1.4.0`) and deployed unchanged in Lab 5. Lab 5 adds one visible change in Issue #12 (Release B): a **release banner** in the bottom-right corner of every page showing `Release <short SHA>`, read from `/api/health`.

### 1.2 Cloud-Readiness Check

| keyword | abstract |
| :--- | :--- |
| no local disk | no uploads or in-memory state; all records and sessions in PostgreSQL (`R-04`) |
| safe seed | natural-key upserts (`ON CONFLICT`), keeps an admin's pause state, passwords from env only |
| fail fast | production refuses to start without a 32+ character `SESSION_SECRET`; `trust proxy` on for `Secure` cookies behind Cloud Run |
| PG sessions | `connect-pg-simple`, table `user_sessions`, cookie `connect.sid`, 8 h absolute expiry |
| port | binds `0.0.0.0:$PORT` (default 3000), serves `client/dist` |
| probes | `/api/health` → `200 {"status":"ok","version":"<APP_VERSION>"}`; `/api/ready` runs `SELECT 1` → `200` ready or `503` not ready |

These six points are why a Cloud Run container can be replaced at any time without losing data or signing users out. `/api/ready` is also what the smoke test uses after every deploy to prove the app can reach Cloud SQL.

---

## 2. Environment Variables (`R-02`)

| variable | secret | purpose | local (`server/.env`) | Cloud Run |
| :--- | :---: | :--- | :--- | :--- |
| `PORT` | no | HTTP port | `3000` | `3000` (`--port`) |
| `NODE_ENV` | no | `development` / `test` / `production` | `development` | `production` |
| `DATABASE_URL` | **yes** | PostgreSQL URI: `postgresql://<user>:<password>@localhost:<port>/omkoi_queue` locally; Cloud SQL socket on Cloud Run | your local DB | Secret Manager `omkoi-database-url` |
| `PG_POOL_MAX` | no | connections per process (1–50, default 10) | empty = 10 | `5` (set by `deploy.sh`) |
| `TEST_DATABASE_URL` | **yes** | separate DB for `test:server` and e2e | your local test DB | not used (CI uses its own) |
| `SESSION_SECRET` | **yes** | signs `connect.sid`; 32+ characters in production | random | Secret Manager `omkoi-session-secret` |
| `SEED_ADMIN_PASSWORD` | **yes** | `admin@omkoi.coffee` | your choice | `omkoi-admin-password` (migrate job only) |
| `SEED_STAFF_PASSWORD` | **yes** | `barista@` and `dessert@omkoi.coffee` | your choice | `omkoi-staff-password` (migrate job only) |
| `SEED_CUSTOMER_PASSWORD` | **yes** | `boom@` and `hongtae@omkoi.coffee` | your choice | `omkoi-customer-password` (migrate job only) |
| `POSTGRES_USER` / `POSTGRES_DB` | no | local Docker database user and name | your choice / `omkoi_queue` | not used (Cloud SQL user `omkoi_user`, DB `omkoi_queue`) |
| `POSTGRES_PASSWORD` | **yes** | local Docker database password | your choice | not used (inside `omkoi-database-url`) |
| `DB_PORT` | no | host port of the local database | `5432`, or another if taken | not used |
| `APP_VERSION` | no | commit SHA the app runs; returned by `/api/health` and shown by the release banner | empty = `dev` | set by `deploy/release.sh` on every release |

No secret is committed: both `.env.example` files list key names only, and `scripts/check-secrets.sh` (`TEST-20`) fails CI if a value, a `.env` file or a password in a connection string appears in a tracked file. Locally the values live in `server/.env` (git-ignored); CI uses a throwaway database with trust auth and random seed passwords; Cloud Run reads secrets from Secret Manager and never sees the seed passwords. If a secret is ever pushed, change it where it is used, add a new Secret Manager version, redeploy and tell a TA (handout §4.3).

---

## 3. Commands

| keyword | command (repository root) |
| :--- | :--- |
| configure | `cp .env.example server/.env`, then fill in every key |
| install | `npm run install:all` |
| database (dev) | `npm run db:up` · `npm run db:migrate` · `npm run db:seed` |
| run (dev) | `npm run dev:server` (:3000) · `npm run dev:client` (:5173) |
| build | `npm run build` · then `npm --prefix server run db:seed:prod` · `npm --prefix server start` |
| test | `npm run typecheck` · `npm run test:server` · `npm run test:client` · `npm run e2e` · `npm run check:secrets` |
| Docker stack (`C-03`) | `npm run stack:up` (= `docker compose --env-file server/.env up --build -d`) · `stack:ps` · `stack:logs` · `stack:restart` · `stack:down` |
| check | `curl -s http://localhost:3000/api/ready` · `python3 deploy/smoke_test.py http://localhost:3000` |

Day-to-day work runs with the database in Docker and the app on your machine (hot reload). The Docker stack runs the **same image as Cloud Run** in the same order: `db`, then `migrate` (`db:migrate` + `db:seed:prod`, exits 0), then `app` on :3000. Compose sets `NODE_ENV=development` on `app` so the session cookie works over plain `http://localhost`, and `COMPOSE_DB_HOST=db` so `docker-entrypoint.sh` points `DATABASE_URL` at the `db` container. The `stack:*` scripts always pass `--env-file server/.env`; plain `docker compose up` would use host port 5432, which may already be taken. `stack:down` keeps the `omkoi-db` volume.

---

## 4. GCP Resources

| keyword | resource | setting |
| :--- | :--- | :--- |
| project | `omkoi-515303` · `asia-southeast1` | Free Trial on a personal Gmail; alerts-only budget USD 10 |
| registry | Artifact Registry `omkoi-queue` | `asia-southeast1-docker.pkg.dev/omkoi-515303/omkoi-queue/omkoi-queue:<tag>` |
| database | Cloud SQL `omkoi-queue-db` | PostgreSQL 16, `--edition=enterprise`, `db-f1-micro`, 10 GB, `--no-storage-auto-increase`; DB `omkoi_queue`, user `omkoi_user`; socket `/cloudsql/omkoi-515303:asia-southeast1:omkoi-queue-db` |
| app | Cloud Run `omkoi-queue` | public, port 3000, min 0, max 3, 512 MiB, `PG_POOL_MAX=5` |
| migrate | Cloud Run job `omkoi-queue-migrate` | `npm run db:migrate && npm run db:seed:prod` before every service update |
| runner | service account `omkoi-queue-runner` | `roles/cloudsql.client` + `secretAccessor` on each of the 5 secrets only |
| deployer | service account `omkoi-queue-deployer` | `roles/run.developer`, `artifactregistry.writer` on `omkoi-queue`, `serviceAccountUser` on the runner; no keys |
| GitHub sign-in | WIF pool `github-actions` / provider `github-main` | repo `1450043053`, owner `183930344`, `refs/heads/main`, `deploy.yml`, environment `demo` |
| secrets | Secret Manager | `omkoi-database-url`, `omkoi-session-secret`, `omkoi-admin-password`, `omkoi-staff-password`, `omkoi-customer-password` |

`deploy/deploy.sh` creates everything from the registry to the secrets, builds the first image with Cloud Build, runs the migrate job and deploys the service; it is idempotent, so running it again only rebuilds and redeploys. `deploy/setup-wif.sh` then creates the deployer and the WIF pool/provider. Cloud SQL is the only real cost (billed every hour it exists): keep Cloud Run at min 0, pause the instance when nobody tests (`--activation-policy=NEVER`), and run `deploy/teardown.sh` after grading.

### 4.1 First Deployment and Merge Gate (Issue #11)

| keyword | result |
| :--- | :--- |
| trial deploy | 21 Nov 2026, `deploy.sh` from `fix/11-pre-deploy` (image `:latest`, revision `omkoi-queue-00001-lrf`); not evidence |
| evidence deploy | 22 Nov 2026, `deploy.sh` from `main` at **`v2.3.0`** (`bd2f69e`, release PR #17) → revision **`omkoi-queue-00002-pgw`** |
| URL | https://omkoi-queue-tdt4pxa64a-as.a.run.app (same service: https://omkoi-queue-6605140384.asia-southeast1.run.app) |
| smoke test | health, ready/DB, HTML and `401` on `/api/categories`: PASS |
| `C-04` | customer joins SB, staff calls, serves and completes, admin sees all counters; a signed-in customer on `/api/tickets?categoryId=1` gets `403` |
| WIF | `setup-wif.sh`: deployer without keys, provider `github-main` ACTIVE |
| environment `demo` | deployment branch `main`; variables `GCP_PROJECT_ID`, `GCP_REGION`, `WIF_PROVIDER`, `WIF_SERVICE_ACCOUNT` |
| `protect-main` (`R-06`) | Active, empty bypass list, target `main`: restrict deletions, block force pushes, PR + 1 approval, required check `test-and-docker` |
| gate proof (`C-02`) | PR #18 from `test/prove-gate` (one failing assertion in `server/tests/config.test.ts`): check failed, merge **BLOCKED**, closed unmerged |

The trial deploy found nothing to fix, so the evidence deploy reused the same database and secrets and only rebuilt the image from the released `main` commit. The gate proof used a throwaway branch so the released application was never touched.

### 4.2 Keyless GitHub Sign-In

| keyword | abstract |
| :--- | :--- |
| preview | `DRY_RUN=1 bash deploy/setup-wif.sh` prints the attribute condition and every `gcloud` command |
| apply | `bash deploy/setup-wif.sh`, after the first `deploy.sh` |
| output | the four `demo` variables for GitHub |
| tested | `deploy/tests/test_wif_stub.sh` in CI (no GCP calls) |

GitHub Actions never holds a password or key: on `main`, inside environment `demo`, `deploy.yml` receives a short-lived token from GitHub, Google checks the condition (this repository, `main`, `deploy.yml`, `demo`) and lends it `omkoi-queue-deployer` for that run only. A pull-request branch, a fork or another workflow is refused. The deployer can deploy Cloud Run and push images, but cannot read secrets, change IAM or create databases.

---

## 5. Release, Running Commit and Rollback (`R-07`, `R-08`)

### 5.1 Release Pipeline

| # | keyword | abstract |
| :---: | :--- | :--- |
| 1 | Issue | labelled `lab5`; branch from `staging` (`<type>/<n>-<keyword>`) |
| 2 | PR → `staging` | `test-and-docker` must pass; the other member reviews with a specific comment and merges (`R-09`) |
| 3 | release PR → `main` | `protect-main`: 1 approval + green `test-and-docker` (`R-06`) |
| 4 | `deploy.yml` | on the push to `main`: `test-and-docker` → WIF sign-in → build and push `omkoi-queue:<full SHA>` → `deploy/release.sh` → `smoke_test.py` → run summary |
| 5 | tag | tag the merge commit (`v2.3.0`, `v2.5.0`, `v2.6.0`) |

Every merge into `main` is a release, and only `main` deploys. `deploy/release.sh` finds the image's exact `@sha256` digest, runs `omkoi-queue-migrate` on it and stops if the migration fails, then updates `omkoi-queue` to that digest with `APP_VERSION=<SHA>` and sends it 100 % of traffic. Settings and secrets are never touched by a release. `v2.3.0` was deployed by hand with `deploy.sh` before `deploy.yml` existed; from Release A (`v2.5.0`) every release goes through the pipeline.

### 5.2 Which Commit Is Running

| keyword | where to look |
| :--- | :--- |
| run summary | GitHub → Actions → **Deploy demo** → the run: commit, digest, revision, URL |
| revision + image | `gcloud run services describe omkoi-queue --region asia-southeast1 --format="value(status.latestReadyRevisionName,spec.template.spec.containers[0].image)"` |
| `APP_VERSION` | `gcloud run services describe omkoi-queue --region asia-southeast1 --format="yaml(spec.template.spec.containers[0].env)" \| grep -A1 APP_VERSION` |
| image tag → digest | `gcloud artifacts docker images describe asia-southeast1-docker.pkg.dev/omkoi-515303/omkoi-queue/omkoi-queue:<SHA> --format="value(image_summary.fully_qualified_digest)"` |
| in the app | the release banner (bottom-right on every page) shows `Release <first 7 characters>`; hover shows the full SHA; `curl -s <URL>/api/health` returns it as `version` |

Each pipeline image is tagged with the full commit SHA and deployed by digest, so the running revision maps to exactly one commit; `APP_VERSION` on the revision states it directly.

### 5.3 Rollback and Roll-Forward (`C-05`)

| # | keyword | abstract |
| :---: | :--- | :--- |
| 1 | find SHA | the full 40-character SHA of the earlier release (`main` history or its Deploy demo run) |
| 2 | roll back | Actions → **Deploy demo** → Run workflow on `main` with `image_tag` = that SHA |
| 3 | what runs | tests, build and migration are skipped (`ROLLBACK=true`); the service switches to that image's digest and `APP_VERSION` |
| 4 | roll forward | Run workflow again with an empty `image_tag` (or the newer SHA) |

A rollback only changes which image Cloud Run runs. Data and signed-in sessions stay in Cloud SQL, so a ticket created before the rollback and the user's session are still there afterwards. Migrations are additive, so an older image runs safely on the newer schema.

### 5.4 Lab 5 Releases

| tag | release PR | contains | deployed by | revision |
| :--- | :--- | :--- | :--- | :--- |
| `v2.3.0` | #17 (`bd2f69e`) | cloud-ready, Docker, CI gate, deploy scripts, WIF script | `deploy/deploy.sh` by hand | `omkoi-queue-00002-pgw` |
| `v2.5.0` | Release A (TODO PR, SHA) | `deploy.yml`, `APP_VERSION` in `release.sh` (#19) | first **Deploy demo** run | TODO |
| `v2.6.0` | Release B (TODO PR, SHA) | release banner + `version` in `/api/health` | **Deploy demo** | TODO |

Release A must reach `main` before Release B is merged into `staging`, so the two are separate releases: B shows the banner, A does not, and the rollback from B to A (`C-05`) is visible in the browser.
