# Software Test Specification (STS) & Definition of Done (DoD)

## 1. Software Test Specification (STS Matrix)

The matrix below maps every Sprint 1 Acceptance Criteria (`AC-01` to `AC-16`) and Non-Functional Requirement to its automated test identifier, test execution level, preconditions, action and expected result. API and integration tests run against a real, migrated PostgreSQL test database; each suite resets its tables and sets its own fixture state (for example `is_open` of `ROASTERY_CONSULT`) rather than relying on earlier runs.

| Test ID | Linked Criteria | Level | Preconditions / Fixture | Test Action | Expected Result |
| :---: | :---: | :---: | :--- | :--- | :--- |
| **`TEST-01`** | `AC-01`, `NFR-01` | API + DB Integration | Seeded user `boom@omkoi.coffee` with the password from `SEED_CUSTOMER_PASSWORD` | 1. `POST /api/auth/login`<br>2. Inspect DB `users.password_hash`<br>3. `GET /api/auth/me` with session cookie | `200 OK`, `password_hash` starts with `$2a$` or `$2b$`, response JSON returns `{ id, email, fullName, role }` and never leaks password hash. |
| **`TEST-02`** | `AC-02` | API Integration | Unauthenticated client | 1. `POST /api/auth/login` with bad password<br>2. `GET /api/tickets/my` without cookie | Both return `401 Unauthorized` with safe error payloads; no session is created in `user_sessions`. |
| **`TEST-03`** | `AC-03` | API Integration | Seeded database with 4 Omkoi categories | Authenticated user calls `GET /api/categories` | `200 OK` returning 4 categories (`SLOW_BAR`, `ESPRESSO_BAR`, `DESSERT_LOUNGE`, `ROASTERY_CONSULT`) with `prefix`, `estMinsPerTicket` and `isOpen` flags. |
| **`TEST-04`** | `AC-04`, `BR-07` | API + DB Integration | Authenticated `boom@omkoi.coffee` with no active ticket in `SLOW_BAR` | 1. `POST /api/tickets` (`categoryId: 1, partySize: 2`)<br>2. `GET /api/tickets/my` | `201 Created`, `ticketCode: "SB-001"`, `status: "WAITING"`, `aheadCount: 0`. Ticket persists in DB with initial `ticket_events` row. |
| **`TEST-05`** | `AC-05`, `BR-01` | Unit + API Integration | `boom@omkoi.coffee` holds active `WAITING` ticket `SB-001` in `SLOW_BAR` | Submit second `POST /api/tickets` (`categoryId: 1, partySize: 1`) | `409 Conflict` (`DUPLICATE_ACTIVE_TICKET`). Total active ticket count remains 1. |
| **`TEST-06`** | `AC-06`, `BR-02` | API Integration | Test sets `ROASTERY_CONSULT` to `is_open = false` | Submit `POST /api/tickets` (`categoryId: 4, partySize: 2`) | `409 Conflict` (`CATEGORY_CLOSED`). No ticket is created. |
| **`TEST-07`** | `AC-07`, `BR-03` | Unit + API Integration | Authenticated user | 1. `POST /api/tickets` with `partySize` `0`, `9`, `-1`, `2.5`, `"2"`<br>2. `POST /api/tickets` with 281-char `specialRequests`<br>3. `partySize: 1`, then `partySize: 8` with 280-char `specialRequests` (each in a fresh category or after cancelling) | 1-2 return `400 Bad Request` (`VALIDATION_ERROR`), nothing stored; 3 return `201 Created`. |
| **`TEST-08`** | `AC-08`, `BR-05` | API Integration | `boom@omkoi.coffee` holds `WAITING` ticket `SB-001` | 1. `POST /api/tickets/:id/cancel` with `""`<br>2. `POST /api/tickets/:id/cancel` with `"Trip schedule changed"`<br>3. Own ticket already `CALLED` (set by fixture): cancel with a valid reason | 1 -> `400 Bad Request`; 2 -> `200 OK` with `status: "CANCELLED"`; 3 -> `409 Conflict`, ticket still `CALLED`. |
| **`TEST-09`** | `AC-09`, `BR-06` | API Security | `boom@omkoi.coffee` logged in; ticket `:id2` belongs to `hongtae@omkoi.coffee` | 1. `GET /api/tickets/:id2`<br>2. `POST /api/tickets/:id2/cancel`<br>3. `GET /api/tickets` (full queue)<br>4. `POST /api/categories/1/call-next`<br>5. `POST /api/tickets/:id2/serve` | All 5 requests are rejected by backend middleware with **HTTP `403 Forbidden`**, no ticket fields are returned and no ticket changes. |
| **`TEST-10`** | `AC-10`, `BR-04` | API + DB Integration | `barista@omkoi.coffee` (`STAFF` - Khun Noble) logged in; ticket `EB-001` is `WAITING` | Sequential calls: `POST /api/categories/2/call-next` -> `/serve` -> `/complete` (`completionSummary: "Served Highland Matcha Latte"`) | Each step returns `200 OK`, transitions status in order (`CALLED -> SERVING -> COMPLETED`), sets all timestamps and `assigned_staff_id`, and logs 3 transition events in `ticket_events`. |
| **`TEST-11`** | `AC-11`, `AC-12`, `BR-04`, `BR-05` | Unit + API Integration | Staff authenticated; tickets in various states | 1. `/serve` on `WAITING` ticket (illegal jump)<br>2. `/complete` on `SERVING` ticket with `""`, then 4 chars, then 5 chars<br>3. `/no-show` on `CALLED` with note<br>4. `/serve` on `COMPLETED` ticket<br>5. `/no-show` on `CALLED` with blank note<br>6. `/no-show` on `WAITING` with note<br>7. Staff `/cancel` on `CALLED` with reason | 1 -> `409`<br>2 -> `400`, `400`, `200`<br>3 -> `200 OK` (`NO_SHOW`)<br>4 -> `409`<br>5 -> `400`<br>6 -> `409`<br>7 -> `200 OK` (`CANCELLED`). Unit part: the transition table rejects every illegal pair. |
| **`TEST-12`** | `NFR-04` | API Integration | Server running with active PostgreSQL connection | 1. `GET /api/health`<br>2. `GET /api/ready` | Both respond with `200 OK` in `< 500 ms` (`{"status":"ready","db":"connected"}`). |
| **`TEST-13`** | `AC-01`, `AC-04`, `NFR-05` | Component / UI | Customer Queue Portal at Desktop (`1280px`) and Mobile (`375px`) | Render category selection, fill party size, submit, verify active ticket view (mocked API) | Active ticket card renders with status badge and ahead count; loading, empty and error states render. (Viewport overflow is checked in `TEST-19`.) |
| **`TEST-14`** | `AC-10`, `NFR-05` | Component / UI | Staff Counter Console for `STAFF` user | Switch counter tab, click Call next, click Start Serving, submit Complete modal (mocked API) | Transitions update UI dynamically, empty completion summary is blocked by form validation. |
| **`TEST-15`** | `AC-13`, `FR-01` | API + DB Integration | `boom@omkoi.coffee` logged in; a second session row with `expire` in the past | 1. `POST /api/auth/logout`<br>2. `GET /api/auth/me` with the old cookie<br>3. `GET /api/auth/me` with the expired session's cookie | 1 -> `200 OK`, session row deleted, cookie cleared<br>2 -> `401`<br>3 -> `401`; no user data in either body. |
| **`TEST-16`** | `AC-14`, `BR-09` | API Security | `barista@` (SB, EB), `dessert@` (DL), `admin@`; a `WAITING` DL ticket | 1. As barista: `call-next` on DL, `GET /api/tickets?categoryId=3`, `serve`/`complete`/`GET` on the DL ticket<br>2. As barista and admin: `POST /api/tickets`<br>3. Same DL requests as dessert and as admin | 1 -> all `403`, ticket unchanged<br>2 -> `403`<br>3 -> allowed (`200`). |
| **`TEST-17`** | `AC-15`, `BR-10` | Unit + API Integration | `SB-001`, `SB-002`, `SB-003` `WAITING` | `POST /api/categories/1/call-next` four times | Returns `SB-001`, `SB-002`, `SB-003`, then `409 QUEUE_EMPTY`. Unit part: the next-ticket query orders by `seq_no`. |
| **`TEST-18`** | `AC-16`, `AC-15`, `NFR-06`, `BR-01`, `BR-07` | API + DB Integration (concurrency) | Empty `SLOW_BAR` and `ESPRESSO_BAR` queues; 10 test customers | 1. 20 parallel joins by one customer to `SLOW_BAR` (`Promise.all`)<br>2. 10 customers join `ESPRESSO_BAR` in parallel<br>3. 2 parallel `call-next` on a counter with 2 `WAITING` tickets | 1 -> one `201`, nineteen `409`, one row<br>2 -> 10 distinct codes `EB-001`..`EB-010`<br>3 -> two different tickets `CALLED`. |
| **`TEST-19`** | `AC-01`, `AC-04`, `AC-10`, `AC-13`, `NFR-05` | End-to-End (Playwright, real server and database) | Seeded database; browser at 375, 768 and 1280 px | Customer signs in, joins `SLOW_BAR`, sees `SB-001 WAITING 0 ahead`; barista signs in, Call next, Start serving, Complete; customer reloads and sees `COMPLETED`; customer signs out | Each step shows the expected state; no horizontal scroll at any width; after sign-out `/queue` redirects to `/login`. |
| **`TEST-20`** | `NFR-02` | Repository + Startup check | Clean clone | 1. `git grep` for secret patterns (passwords, keys, `SESSION_SECRET=` values)<br>2. Start the server with `NODE_ENV=production` and no `SESSION_SECRET` | 1 -> no real secret found<br>2 -> process exits with a clear configuration error. |

**Manual check `MC-01` (`NFR-03`):** sign in and join a queue, restart the server process, then reuse the same cookie: `GET /api/auth/me` returns `200` and the ticket is still listed. Repeated across a container restart in Lab 5.

### 1.1 Planned Test Files
| Tests | File |
| :--- | :--- |
| `TEST-01`, `TEST-02`, `TEST-15` | `server/tests/auth.test.ts` |
| `TEST-03`, `TEST-12` | `server/tests/categories-health.test.ts` |
| `TEST-04`-`TEST-08` | `server/tests/tickets.join.test.ts` |
| `TEST-09`, `TEST-16` | `server/tests/access.test.ts` |
| `TEST-10`, `TEST-11`, `TEST-17` | `server/tests/lifecycle.test.ts`, `server/tests/transitions.unit.test.ts` |
| `TEST-18` | `server/tests/concurrency.test.ts` |
| `TEST-13`, `TEST-14` | `client/src/__tests__/QueuePage.test.tsx`, `client/src/__tests__/StaffConsole.test.tsx` |
| `TEST-19` | `e2e/sprint1-journey.spec.ts` |
| `TEST-20` | `scripts/check-secrets.sh`, `server/tests/config.test.ts` |

---

## 2. TDD Plan

For the rule work below, the failing test is committed first, its red output and commit SHA are kept, then the implementation is committed and the green output and SHA are kept (evidence for Part F):

| Rule | Test written red first |
| :--- | :--- |
| `BR-01` duplicate active ticket | `TEST-05` |
| `BR-04` state machine | `TEST-11` (unit transition table) |
| `BR-09` staff counter scope | `TEST-16` |
| `BR-10` call-next order | `TEST-17` |

---

## 3. Sprint 1 Definition of Done (DoD) Checklist

A feature is considered **Done** and ready for release in Sprint 1 only when all items below are fulfilled:

- [ ] **Contract-First Compliance:** The feature specification, acceptance criteria (`AC-xx`) and software test specification (`TEST-xx`) are committed to version control **before** implementation code.
- [ ] **Server-Side Enforcement:** All domain business rules (`BR-01` to `BR-07`, `BR-09`, `BR-10`) and role-based permissions are strictly verified in backend controllers/services, rejecting violations with appropriate HTTP status codes (`400`, `401`, `403`, `409`).
- [ ] **Pure PostgreSQL Persistence:** All records and active session cookies are stored durably in PostgreSQL 16; zero dependency on in-memory arrays or local container disk.
- [ ] **Planned Verification Executed:** All mapped unit, API integration, component and end-to-end tests (`TEST-01` to `TEST-20`) and `MC-01` were run on the release commit; the command, commit, counts and output are kept. They pass with 0 failures and 0 skipped tests, and no required test was disabled or weakened.
- [ ] **Responsive UI Implementation:** Client screens support loading indicators, empty states, validation error banners and clean desktop/mobile viewport rendering.
- [ ] **Peer-Reviewed Pull Request:** Work is committed on a feature branch branched from `staging`, reviewed with substantive technical feedback by the teammate (author never self-merges) and merged into `staging`.
- [ ] **Setup & Documents Current:** `README.md`, `.env.example`, migrations and seed match the release; any specification change is recorded in the contract's version history and in `docs/traceability.md`.
- [ ] **Integrated & Released:** `staging` passes the full suite and acceptance checks, the release PR `staging -> main` is reviewed by the other member and merged, and the release tag and commit are recorded.
- [ ] **Incomplete Work Disclosed:** Any unfinished AC, failed or skipped test, or known limitation is listed in the submission; completion is shown by evidence, not by an AI agent's claim.
