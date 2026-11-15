# Requirement Traceability Matrix

## 1. Traceability Chain Overview

Every requirement (`FR-xx`), domain business rule (`BR-xx`) and non-functional requirement (`NFR-xx`) established in `docs/srs.md` is mapped below to its parent feature or system responsibility, target sprint, Acceptance Criteria (`AC-xx`) and verification (`TEST-xx` automated, `MC-xx` manual). Requirements allocated to Sprints 2 and 3 have a feature and a sprint now; their AC and tests are specified in those sprints' contracts.

---

## 2. Master Traceability Table

| Requirement ID | Requirement Type & Summary | Mapped Feature | Planned Sprint | Acceptance Criteria (Given-When-Then) | Verification Tests (STS) | Implementation Status |
| :---: | :--- | :---: | :---: | :--- | :--- | :---: |
| **`FR-01`** | Email/password login, bcrypt hash verification, DB session persistence with 8 h expiry, `/api/auth/me`, logout. | `F-01` | **Sprint 1** | `AC-01`, `AC-02`, `AC-13` | `TEST-01`, `TEST-02`, `TEST-15`, `TEST-19` | Specified (Sprint 1) |
| **`FR-02`** | List service categories, prefixes, estimated wait times, open/paused intake state and `waitingCount`. | `F-01` | **Sprint 1** | `AC-03` | `TEST-03` | Specified (Sprint 1) |
| **`FR-03`** | Customer joins walk-in queue for open category (`partySize` 1-8, optional note), receives sequenced ticket code (`SB-001`). | `F-02` | **Sprint 1** | `AC-04`, `AC-05`, `AC-06`, `AC-07`, `AC-16` | `TEST-04`, `TEST-05`, `TEST-06`, `TEST-07`, `TEST-13`, `TEST-18`, `TEST-19` | Specified (Sprint 1) |
| **`FR-04`** | Customer tracks own tickets (`GET /api/tickets/my`, `GET /api/tickets/:id`), view live status, queue `aheadCount` and `estWaitMins`. | `F-02` | **Sprint 1** | `AC-04`, `AC-09` | `TEST-04`, `TEST-09`, `TEST-19` | Specified (Sprint 1) |
| **`FR-05`** | Customer self-cancels own ticket in `WAITING` status with mandatory `cancelReason`. | `F-02` | **Sprint 1** | `AC-08`, `AC-09` | `TEST-08`, `TEST-09` | Specified (Sprint 1) |
| **`FR-06`** | Staff list the queue of their assigned counters (Admin: all) with category and status filters, oldest first. | `F-03` | **Sprint 1** | `AC-09`, `AC-10`, `AC-14` | `TEST-09`, `TEST-10`, `TEST-14`, `TEST-16` | Specified (Sprint 1) |
| **`FR-07`** | Staff execute call-next, `/serve`, `/complete`, `/no-show`, `/cancel` with mandatory summaries on assigned counters. | `F-03` | **Sprint 1** | `AC-10`, `AC-11`, `AC-12`, `AC-14`, `AC-15` | `TEST-10`, `TEST-11`, `TEST-14`, `TEST-16`, `TEST-17`, `TEST-19` | Specified (Sprint 1) |
| **`FR-08`** | Admin creates and edits counters, pauses/resumes intake, lists staff and assigns staff to counters. | `F-04` | **Sprint 1** | `AC-17`, `AC-18`, `AC-19`, `AC-20` | `TEST-21`, `TEST-22`, `TEST-23`, `TEST-24`, `TEST-25` | Specified (Sprint 1) |
| **`FR-09`** | Ticket beverage/pastry line itemization and read access to the audit event trail (events written since Sprint 1). | `F-05`, `F-06` | Sprint 2 | *(To be specified in Sprint 2 contract)* | *(To be specified in Sprint 2 STS)* | Planned (Sprint 2) |
| **`FR-10`** | Post-service customer 1-5 star tasting review and station operational analytics dashboard. | `F-07`, `F-08` | Sprint 3 | *(To be specified in Sprint 3 contract)* | *(To be specified in Sprint 3 STS)* | Planned (Sprint 3) |
| **`BR-01`** | Single Active Ticket Invariant: Max 1 active ticket (`WAITING`/`CALLED`/`SERVING`) per customer per category (`409 Conflict`), also under concurrency. | `F-02` | **Sprint 1** | `AC-05`, `AC-16` | `TEST-05` (Unit + API), `TEST-18` | Specified (Sprint 1) |
| **`BR-02`** | Paused Category Gate: Joining a paused/closed category returns `409 Conflict` (`CATEGORY_CLOSED`). | `F-01`, `F-02`, `F-04` | **Sprint 1** | `AC-06`, `AC-18` | `TEST-06` (API), `TEST-22` | Specified (Sprint 1) |
| **`BR-03`** | Input Boundaries: `partySize` must be integer `1-8` and `specialRequests` <= 280 characters (`400 Bad Request`). | `F-02` | **Sprint 1** | `AC-07` | `TEST-07` (Unit + API) | Specified (Sprint 1) |
| **`BR-04`** | State Machine Invariant: Legal transitions only; jumping states or mutating terminal tickets returns `409 Conflict`. | `F-03` | **Sprint 1** | `AC-10`, `AC-11` | `TEST-10`, `TEST-11` (Unit + API) | Specified (Sprint 1) |
| **`BR-05`** | Mandatory Summaries: Trimmed notes required for `COMPLETED` (5-500 chars), `CANCELLED` (3-200 chars) and `NO_SHOW` (3-200 chars). | `F-02`, `F-03` | **Sprint 1** | `AC-08`, `AC-11`, `AC-12` | `TEST-08`, `TEST-11` (Unit + API) | Specified (Sprint 1) |
| **`BR-06`** | Customer Isolation: Customers can only view/cancel own tickets; self-cancel forbidden once `CALLED`/`SERVING` (`403`/`409`). | `F-02`, `F-03` | **Sprint 1** | `AC-08`, `AC-09` | `TEST-08`, `TEST-09` (API Security) | Specified (Sprint 1) |
| **`BR-07`** | Sequential Ticket Codes: monotonic `<PREFIX>-<NNN>` per category, never reset or reused, unique under concurrent joins. | `F-02` | **Sprint 1** | `AC-04`, `AC-16` | `TEST-04` (Unit + API), `TEST-18` | Specified (Sprint 1) |
| **`BR-08`** | Single Rating Integrity: Rating allowed only on own `COMPLETED` ticket, exactly once (`409 Conflict` on duplicate). | `F-07` | Sprint 3 | *(To be specified in Sprint 3 contract)* | *(To be specified in Sprint 3 STS)* | Planned (Sprint 3) |
| **`BR-09`** | Staff Counter Scope: Staff act only on assigned counters (`403` otherwise), Admin on all; only customers create tickets. | `F-03` (`F-04` manages assignments) | **Sprint 1** | `AC-14`, `AC-19` | `TEST-16` (API Security), `TEST-23` | Specified (Sprint 1) |
| **`BR-10`** | Call-Next FIFO: The server calls the oldest `WAITING` ticket; empty queue returns `409 QUEUE_EMPTY`. | `F-03` | **Sprint 1** | `AC-15` | `TEST-17` (Unit + API), `TEST-18` | Specified (Sprint 1) |
| **`BR-11`** | Counter Identity: unique, immutable `code` and `prefix`; `estMinsPerTicket` 1-240 (`409 DUPLICATE_CATEGORY`, `400`). | `F-04` | **Sprint 1** | `AC-17` | `TEST-21` | Specified (Sprint 1) |
| **`BR-12`** | Pause Blocks New Joins Only: queued tickets of a paused counter keep moving. | `F-04`, `F-03` | **Sprint 1** | `AC-18` | `TEST-22` | Specified (Sprint 1) |
| **`NFR-01`** | Stored passwords hashed with salted bcrypt (cost >= 10); zero hash leakage in API responses. | `F-01` | **Sprint 1** | `AC-01` | `TEST-01` | Specified (Sprint 1) |
| **`NFR-02`** | Environment variable configuration, `.env.example` with placeholders, zero secrets in repository, production fails fast without a secret. | System responsibility (configuration), established by `F-01` | **Sprint 1** | *(system check, no feature AC)* | `TEST-20`, clean-clone build check | Specified (Sprint 1) |
| **`NFR-03`** | All domain records and user sessions stored in PostgreSQL 16; zero dependency on ephemeral container disk. | `F-01`..`F-03` | **Sprint 1** (container restart in Lab 5) | `AC-01`, `AC-04` | `TEST-01`, `TEST-04`, `MC-01` server restart check | Specified (Sprint 1) |
| **`NFR-04`** | `/api/health` and `/api/ready` (`SELECT 1`) respond in `< 500 ms` with `200 OK` (or `503` if DB unreachable). | `F-01` | **Sprint 1** | `AC-03` | `TEST-12`, Smoke test script | Specified (Sprint 1) |
| **`NFR-05`** | Responsive UI across Desktop (`1280px`), Tablet (`768px`) and Mobile (`375px`) with loading, empty and error states. | `F-01`..`F-03` | **Sprint 1** (re-checked in Sprints 2-3) | `AC-04`, `AC-10` | `TEST-13`, `TEST-14`, `TEST-19` | Specified (Sprint 1) |
| **`NFR-06`** | Concurrency safety: parallel joins and call-next requests never duplicate tickets, codes or calls. | `F-02`, `F-03` | **Sprint 1** | `AC-15`, `AC-16` | `TEST-18` | Specified (Sprint 1) |

---

## 3. Coverage Gaps

| Item | Gap | Where it is closed |
| :--- | :--- | :--- |
| `FR-09`, `FR-10`, `BR-08` | No AC or test yet; the handout requires only a feature and sprint for later sprints. | Sprint 2 and Sprint 3 contracts and STS. |
| `NFR-03` (container part) | Sprint 1 verifies persistence across a server-process restart only; Docker arrives in Lab 5. | Lab 5 container restart check. |
| `NFR-04` (deployed latency) | Sprint 1 measures `/api/health` and `/api/ready` locally. | Lab 5 smoke test against the Cloud Run URL. |
| Lab 5 delivery (Docker, CI/CD, GCP) | A system responsibility with no FR. | `docs/sprints/plan.md`, Lab 5 section. |
| Sprint 1 | None: every Sprint 1 FR, BR and NFR has at least one AC and at least one test. | n/a |

---

## 4. Approved Changes

Changes to the first baseline commit (`a9c7a02`). `C-01`–`C-15` were raised in the review of PR #4 and approved by its merge; later entries are approved by the merge of the PR that records them.

| ID | Change | Reason | Affects |
| :--- | :--- | :--- | :--- |
| `C-01` | Added `BR-09` staff counter scope, the `staff_counters` table, seeded `dessert@omkoi.coffee`, `AC-14`, `TEST-16`. | Theme 9: "operators act only on authorized queues" and a test of unauthorized queue access. | SRS, SDS, `F-03`, STS |
| `C-02` | Replaced `POST /api/tickets/:id/call` with `POST /api/categories/:id/call-next`; added `BR-10`, `AC-15`, `TEST-17`. | Theme 9: the operator "calls the next eligible entry"; queue ordering must be defined. | SRS, SDS, `F-03`, STS |
| `C-03` | Join transaction locks the category row via `next_seq`; partial unique index on active tickets; added `NFR-06`, `AC-16`, `TEST-18`. | `SELECT ... FOR UPDATE` locks nothing when no active ticket exists; Theme 9 asks for safe numbering and no duplicates. | SRS, SDS, `F-02`, `F-03`, STS |
| `C-04` | Added logout and expiry `AC-13`, `TEST-15`; specified cookie flags, 8 h `maxAge` and session regeneration. | Part C asks for session creation and expiry; Part F demonstrates logout. | SRS, SDS, `F-01`, STS |
| `C-05` | Added rules, failure cases, permissions, UI, data and version-history sections to each contract. | Part E contract content. | `F-01`, `F-02`, `F-03` |
| `C-06` | Added assumptions and questions (SRS), coverage gaps and approved changes (this file), UI conventions, migrations and the session section (SDS). | Parts A, B and C content. | SRS, SDS, traceability |
| `C-07` | Added the end-to-end test `TEST-19`, the secret check `TEST-20`, missing AC branches, a TDD plan and the handout's DoD items. | Part E STS and DoD. | STS and DoD |
| `C-08` | `POST /api/tickets` is `CUSTOMER`-only; dropped "Staff on behalf of walk-ins". | The request had no field naming the guest (`Q-01`). | SRS, SDS, `F-02` |
| `C-09` | Dropped "daily" numbering; codes are never reset; added `seq_no` for ordering. | Contradicted `BR-07` and the unique `ticket_code` (`Q-03`). | SRS, SDS, `F-02` |
| `C-10` | `ticket_events` written from Sprint 1; Sprint 2 adds the read endpoint and recall. | Sprint 1 tests already asserted event rows. | SRS, features, plan |
| `C-11` | Seed upserts on natural keys without explicit ids; tests set fixture state themselves. | Explicit ids left the `SERIAL` sequences at 1. | SDS, STS |
| `C-12` | `NFR-02`, `NFR-03`, `NFR-05` verification made runnable in Sprint 1 and consistent across documents. | Verification must be allocated to an appropriate sprint. | SRS, traceability |
| `C-13` | SRS §3.3 marked as not planned; removed `ticket_type` from the Sprint 1 schema. | No FR, feature or sprint carried them. | SRS, SDS |
| `C-14` | Added the Lab 5 delivery item, the Sprint 1 scope rationale and risks to the plan. | Part D and the handout's Lab 5 timing. | Plan |
| `C-15` | Seed passwords and the session secret come only from the environment; production fails fast. | No published fallback secrets. | SRS, SDS, `F-01`, STS |
| `C-20` | PR #6 review fixes: ids above INT4 are `400`; empty query values mean "not given"; the staff console keeps the list on a repeat tab click and re-reads counters and assignments on refresh; refused cancels show the server message; the admin **Edit** form opens with the latest values and a `401` ends the session; the secret scan also checks `client/` and `e2e/` dependencies are ignored. | Comment 3.1 by @MANGKONYOK on PR #6. | SDS 3.1/3.3, `F-02` 1.3, `F-03` 1.3, `F-04` 1.1, STS 1.1 |
| `C-17` | Login and `GET /api/auth/me` return `assignedCategoryIds` for `STAFF`/`ADMIN` (customers unchanged). | The staff console needs its counter tabs; suggested in the PR #4 review. | SDS 3.3, `F-01` 1.2, `F-03` 1.2, `TEST-16` |
| `C-18` | `F-04` Admin Counter Management moved from Sprint 2 into Sprint 1 and shipped in the issue #3 PR (PR #6) with `F-02` and `F-03`; new contract `f04-admin-counters.md`, `BR-11`, `BR-12`, `AC-17`-`AC-20`, `TEST-21`-`TEST-25`; `GET /api/staff` added to `FR-08`. | The team ships Sprint 1 as three PRs; the release can then pause counters and assign staff from the UI. | SRS, features, plan, STS, SDS, `F-04` |
| `C-19` | `GET /api/categories` returns `waitingCount`; tickets return `estWaitMins` while `WAITING`. | Planned in the team's design for the queue page; lets guests and the admin see queue length and expected wait. | `FR-02`, `FR-04`, `F-01` 1.3, `F-02` 1.2, `TEST-03`, `TEST-04` |
| `C-16` | `.env.example` holds key names only (empty values); `TEST_DATABASE_URL` and the local `POSTGRES_*` keys added; `PORT`/`NODE_ENV` default when empty; `SESSION_SECRET` must be at least 32 characters in production. | A template must not carry values, not even local defaults (raised during F-01, `e844923`; recorded in the PR #5 review). | SRS `NFR-02`, SDS 6.1 |
