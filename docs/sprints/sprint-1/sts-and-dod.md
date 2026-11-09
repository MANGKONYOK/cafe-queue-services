# Software Test Specification (STS) & Definition of Done (DoD)

## 1. Software Test Specification (STS Matrix)

The matrix below maps every Sprint 1 Acceptance Criteria (`AC-01` to `AC-12`) and Non-Functional Requirement to its automated test identifier, test execution level, preconditions, action and expected result.

| Test ID | Linked Criteria | Level | Preconditions / Fixture | Test Action | Expected Result |
| :---: | :---: | :---: | :--- | :--- | :--- |
| **`TEST-01`** | `AC-01`, `NFR-01` | API + DB Integration | Seeded user `boom@omkoi.coffee` with password `GuestOmkoi123!` | 1. `POST /api/auth/login`<br>2. Inspect DB `users.password_hash`<br>3. `GET /api/auth/me` with session cookie | `200 OK`, `password_hash` starts with `$2a$` or `$2b$`, response JSON returns `{ id, email, fullName, role }` and never leaks password hash. |
| **`TEST-02`** | `AC-02` | API Integration | Unauthenticated client | 1. `POST /api/auth/login` with bad password<br>2. `GET /api/tickets/my` without cookie | Both return `401 Unauthorized` with safe error payloads; no session is created in `user_sessions`. |
| **`TEST-03`** | `AC-03` | API Integration | Seeded database with 4 Omkoi categories | Authenticated user calls `GET /api/categories` | `200 OK` returning 4 categories (`SLOW_BAR`, `ESPRESSO_BAR`, `DESSERT_LOUNGE`, `ROASTERY_CONSULT`) with `prefix`, `estMinsPerTicket` and `isOpen` flags. |
| **`TEST-04`** | `AC-04`, `BR-07` | API + DB Integration | Authenticated `boom@omkoi.coffee` with no active ticket in `SLOW_BAR` | 1. `POST /api/tickets` (`categoryId: 1, partySize: 2`)<br>2. `GET /api/tickets/my` | `201 Created`, `ticketCode: "SB-001"`, `status: "WAITING"`, `aheadCount: 0`. Ticket persists in DB with initial `ticket_events` row. |
| **`TEST-05`** | `AC-05`, `BR-01` | Unit + API Integration | `boom@omkoi.coffee` holds active `WAITING` ticket `SB-001` in `SLOW_BAR` | Submit second `POST /api/tickets` (`categoryId: 1, partySize: 1`) | `409 Conflict` (`DUPLICATE_ACTIVE_TICKET`). Total active ticket count remains 1. |
| **`TEST-06`** | `AC-06`, `BR-02` | API Integration | Category `ROASTERY_CONSULT` has `isOpen = false` | Submit `POST /api/tickets` (`categoryId: 4, partySize: 2`) | `409 Conflict` (`CATEGORY_CLOSED`). No ticket is created. |
| **`TEST-07`** | `AC-07`, `BR-03` | Unit + API Integration | Authenticated user | 1. `POST /api/tickets` with `partySize: 0`<br>2. `POST /api/tickets` with `partySize: 9`<br>3. `POST /api/tickets` with 300-char `specialRequests` | All three return `400 Bad Request` (`VALIDATION_ERROR`). |
| **`TEST-08`** | `AC-08`, `BR-05` | API Integration | `boom@omkoi.coffee` holds `WAITING` ticket `SB-001` | 1. `POST /api/tickets/:id/cancel` with `""`<br>2. `POST /api/tickets/:id/cancel` with `"Trip schedule changed"` | Blank reason returns `400 Bad Request`; valid reason returns `200 OK` with `status: "CANCELLED"`. |
| **`TEST-09`** | `AC-09`, `BR-06` | API Security | `boom@omkoi.coffee` logged in; ticket `:id2` belongs to `hongtae@omkoi.coffee` | 1. `GET /api/tickets/:id2`<br>2. `POST /api/tickets/:id2/cancel`<br>3. `GET /api/tickets` (full queue)<br>4. `POST /api/tickets/:id/call` | All 4 requests are rejected by backend middleware with **HTTP `403 Forbidden`**. |
| **`TEST-10`** | `AC-10`, `BR-04` | API + DB Integration | `barista@omkoi.coffee` (`STAFF` - Khun Noble) logged in; ticket `EB-001` is `WAITING` | Sequential calls: `/call` -> `/serve` -> `/complete` (`completionSummary: "Served Highland Matcha Latte"`) | Each step returns `200 OK`, transitions status in order (`CALLED -> SERVING -> COMPLETED`), sets all timestamps and logs 3 events in `ticket_events`. |
| **`TEST-11`** | `AC-11`, `AC-12`, `BR-04`, `BR-05` | Unit + API Integration | Staff authenticated; tickets in various states | 1. `/serve` on `WAITING` ticket (illegal jump)<br>2. `/complete` on `SERVING` ticket with `""`<br>3. `/no-show` on `CALLED` with note<br>4. `/call` on `COMPLETED` ticket | 1 -> `409 Conflict`<br>2 -> `400 Bad Request`<br>3 -> `200 OK` (`NO_SHOW`)<br>4 -> `409 Conflict`. |
| **`TEST-12`** | `NFR-04` | API Integration | Server running with active PostgreSQL connection | 1. `GET /api/health`<br>2. `GET /api/ready` | Both respond with `200 OK` in `< 500 ms` (`{"status":"ready","db":"connected"}`). |
| **`TEST-13`** | `AC-01`, `AC-04`, `NFR-05` | Component / UI | Customer Queue Portal at Desktop (`1280px`) and Mobile (`375px`) | Render category selection, fill party size, submit, verify active ticket view | Active ticket card renders with status badge and ahead count; no horizontal overflow. |
| **`TEST-14`** | `AC-10`, `NFR-05` | Component / UI | Staff Counter Console for `STAFF` user | Filter by category, click Call, click Start Serving, submit Complete modal | Transitions update UI dynamically, empty completion summary is blocked by form validation. |

---

## 2. Sprint 1 Definition of Done (DoD) Checklist

A feature is considered **Done** and ready for release in Sprint 1 only when all items below are fulfilled:

- [ ] **Contract-First Compliance:** The feature specification, acceptance criteria (`AC-xx`) and software test specification (`TEST-xx`) are committed to version control **before** implementation code.
- [ ] **Server-Side Enforcement:** All domain business rules (`BR-01` to `BR-07`) and role-based permissions are strictly verified in backend controllers/services, rejecting violations with appropriate HTTP status codes (`400`, `401`, `403`, `409`).
- [ ] **Pure PostgreSQL Persistence:** All records and active session cookies are stored durably in PostgreSQL 16; zero dependency on in-memory arrays or local container disk.
- [ ] **Automated Test Coverage:** All mapped unit, API integration and component tests (`TEST-01` to `TEST-14`) pass with 0 failures and 0 skipped tests.
- [ ] **Responsive UI Implementation:** Client screens support loading indicators, empty states, validation error banners and clean desktop/mobile viewport rendering.
- [ ] **Peer-Reviewed Pull Request:** Work is committed on a feature branch branched from `staging`, reviewed with substantive technical feedback by the teammate (author never self-merges) and merged into `staging`.