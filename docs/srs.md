# Software Requirements Specification (SRS) & Product Scope

## 1. Stakeholder Problem & Domain Context

### 1.1 The Stakeholder Problem
**Omkoi Station (สถานีอมก๋อย)** is a highland specialty coffee micro-roastery, slow-bar tasting room and artisanal northern dessert lounge situated in Omkoi District, Chiang Mai (`1,100-1,400 MASL`). The establishment operates four specialized service counters:
1. **Omkoi Specialty Slow Bar (`SLOW_BAR` / `SB`):** Hand-poured V60, Origami and vacuum Syphon brews featuring single-origin micro-lots from Mae Tuen. Each service requires ~10-12 minutes of dedicated barista craft.
2. **Highland Espresso & Artisan Beverage Bar (`ESPRESSO_BAR` / `EB`):** High-throughput speed bar serving espresso drinks, *Omkoi Dirty Coffee* and artisanal matcha. Service takes ~3-5 minutes.
3. **Chiang Rai Mist Tea & Dessert Table (`DESSERT_LOUNGE` / `DL`):** Seated table service for northern pastries (*Khao Puk Nga Mochi Roll*, *Purple Yam Mille-Feuille*, *Basque Honeycomb Cheesecake*). Service duration averages ~15 minutes.
4. **Omkoi Roastery & Bean Wholesale Consultation (`ROASTERY_CONSULT` / `RC`):** 1-on-1 green and roasted bean cupping sessions for wholesale partners and home brewers (~20 minutes).

During peak travel and harvest seasons, walk-in guests encounter:
- Severe physical counter congestion and confusion between different preparation queues.
- Lack of visibility into real-time waiting times across different specialized service counters.
- Missed verbal ticket announcements caused by ambient espresso grinding and milk steaming noise.
- Baristas lacking a unified, role-protected queue console to call tickets in sequence, record service handoffs and track completion or no-show outcomes.

### 1.2 The Solution
The **Omkoi Station Queue and Services Management System** provides a web application backed by PostgreSQL 16 and Node.js/Express. Walk-in guests authenticate, select an open service category, join the walk-in queue with their party size, receive a sequenced ticket code (`SB-001`, `EB-001`), track their live queue position (`aheadCount`) and self-cancel if needed. Baristas and station managers monitor live queues across counters and execute validated lifecycle transitions (`WAITING -> CALLED -> SERVING -> COMPLETED / NO_SHOW / CANCELLED`) under strict domain invariants.

---

## 2. System Actors & Role-Based Responsibilities

| Actor / Role | System Code | Primary Responsibilities |
| :--- | :---: | :--- |
| **Customer (Walk-in Guest / Member)** | `CUSTOMER` | - Authenticate via email/password session.<br>- Browse active Omkoi service counters and real-time open/paused status.<br>- Join walk-in queue for an open category (`partySize` 1-8, optional dietary/brewing note).<br>- Monitor own ticket's live queue status and waiting position (`aheadCount`).<br>- Cancel own ticket while in `WAITING` status with a mandatory cancellation reason.<br>- *(Sprint 3)* Submit 1-5 star tasting feedback on own `COMPLETED` ticket. |
| **Staff (Barista / Counter Operator)** | `STAFF` | - Authenticate via staff credentials.<br>- View the live queue of the counters assigned to them (`staff_counters`), filtered by category and status.<br>- Call the next waiting customer of an assigned counter (`WAITING -> CALLED`); the server picks the oldest `WAITING` ticket.<br>- Start preparation (`CALLED -> SERVING`) with assigned barista attribution.<br>- Complete service (`SERVING -> COMPLETED`) with a mandatory service completion summary.<br>- Mark absent guests as `NO_SHOW` (`CALLED -> NO_SHOW`) with an explanatory note.<br>- Cancel tickets with an operational reason if necessary. |
| **Administrator (Station Manager)** | `ADMIN` | - Perform all `STAFF` queue operations on every counter (no assignment needed).<br>- *(Sprint 2)* Create, edit, pause and resume Omkoi service categories (`is_open` toggle) and assign staff to counters.<br>- *(Sprint 3)* Inspect station-wide operational analytics, wait-time averages and counter throughput metrics. |

---

## 3. Product Scope & Boundary Constraints

### 3.1 In-Scope Deliverables (Sprints 1 to 3)
- **Sprint 1 (Deliverable 1 Core Vertical Slice):**
  - Session-based authentication with bcrypt password hashing and PostgreSQL session persistence (`user_sessions`).
  - Omkoi service categories directory (`SLOW_BAR`, `ESPRESSO_BAR`, `DESSERT_LOUNGE`, `ROASTERY_CONSULT`).
  - Walk-in queue ticket creation with sequential per-counter numbering (`SB-001`, `SB-002`, never reset or reused).
  - Customer personal queue tracking with real-time `aheadCount` computation.
  - Customer self-cancellation for tickets in `WAITING` status with mandatory `cancelReason`.
  - Staff live queue console scoped to the staff member's assigned counters, with category and status filters and a server-side **Call next** (oldest `WAITING` ticket first).
  - Complete barista state machine: `WAITING -> CALLED -> SERVING -> COMPLETED / NO_SHOW / CANCELLED`.
  - Backend-enforced role and ownership access control (HTTP 401/403).
  - Health (`/api/health`) and database readiness (`/api/ready`) probes.
- **Sprint 2 (Operational Expansion):**
  - Admin service counter management (create, update, pause/resume intake).
  - Highland beverage and dessert itemization on active tickets (`ticket_items`).
  - Read access to the state-transition audit trail (`GET /api/tickets/:id/events`; the `ticket_events` rows themselves are written from Sprint 1) and barista recall tracking.
- **Sprint 3 (Customer Feedback & Operational Intelligence):**
  - Post-service 1-5 star customer tasting feedback and review comments (`ticket_feedback`).
  - Station operational analytics dashboard (average wait times, service durations, counter volume).

### 3.2 Explicit Exclusions (Out of Scope)
- **NO Advance Multi-Day Calendar Booking:** The system manages live, walk-in counter queues only. It is not a hotel or calendar reservation system.
- **NO Self-Registration or Password Recovery in Deliverable 1:** Per course specifications, seeded test accounts are sufficient for Deliverable 1.
- **NO External Notification Gateways (SMS, LINE Notify, SMTP):** All status tracking is conducted in-app via the live database.
- **NO Real Payment Gateways / POS Accounting:** Ticket line items serve service tracking; credit card charging and fiscal invoicing are out of scope.
- **NO Local Container File Uploads or SQLite Storage:** Cloud Run statelessness requires all application state and sessions to live in PostgreSQL 16.

### 3.3 Future Ideas (Not Planned in Sprints 1 to 3)
The ideas below are recorded so they are not lost. They are **not** in scope, have no FR/BR and no sprint, and nothing in the Sprint 1 schema depends on them. Taking one on requires new FR/BR rows, a feature and an approved change in `docs/traceability.md`.
- **Highland Courier Proxy Workflow:** a `DELIVERER` role collecting `TAKEAWAY` / `DELIVERY_PICKUP` tickets for external couriers.
- **Highland Community Discount / Privilege Badges:** local resident/student discounts and promo codes.

---

## 4. Functional Requirements (`FR-xx`)

- **`FR-01` (Authentication & Session Lifecycle):** The system shall authenticate users via email and password (`POST /api/auth/login`), verify hashes against stored bcrypt digests, persist session state in PostgreSQL (`user_sessions`), return authenticated profiles via `GET /api/auth/me` and invalidate sessions on `POST /api/auth/logout`.
- **`FR-02` (Service Category Directory):** The system shall provide an endpoint (`GET /api/categories`) returning all Omkoi Station service counters, including category code, display name, description, ticket prefix (`SB`, `EB`, `DL`, `RC`), estimated wait time per ticket and active intake status (`is_open: true/false`).
- **`FR-03` (Walk-In Queue Ticket Creation):** Authenticated Customers shall be able to create a queue ticket (`POST /api/tickets`) for an open category by supplying `categoryId`, `partySize` (1-8) and optional `specialRequests` (max 280 characters), receiving an initial ticket in `WAITING` status with an auto-sequenced code (e.g., `SB-001`). `STAFF` and `ADMIN` accounts cannot create tickets (`403`, `BR-09`).
- **`FR-04` (Customer Live Queue Tracking):** Authenticated Customers shall be able to view their own active and historical tickets (`GET /api/tickets/my`, `GET /api/tickets/:id`), displaying status, assigned counter, timestamps and the number of `WAITING` tickets ahead in the same category.
- **`FR-05` (Customer Self-Cancellation):** Authenticated Customers shall be able to cancel their own ticket (`POST /api/tickets/:id/cancel`) while in `WAITING` status by supplying a non-empty `cancelReason`.
- **`FR-06` (Staff Live Queue Console):** Authenticated Staff shall be able to list the queue tickets of the counters assigned to them, and Admin users those of every counter (`GET /api/tickets`), with optional query filters for `categoryId` and `status`, ordered FIFO by the per-counter sequence number (`seq_no ASC`, oldest first).
- **`FR-07` (Staff Service Lifecycle Execution):** Authenticated Staff (on their assigned counters, `BR-09`) and Admin users (on every counter) shall be able to transition ticket states through:
  - `POST /api/categories/:id/call-next` (the counter's oldest `WAITING` ticket `-> CALLED`, chosen by the server (`BR-10`); records `called_at`, `counter_name` and `assigned_staff_id`)
  - `POST /api/tickets/:id/serve` (`CALLED -> SERVING`, records `serving_started_at`)
  - `POST /api/tickets/:id/complete` (`SERVING -> COMPLETED`, records `completed_at` and mandatory `completionSummary`)
  - `POST /api/tickets/:id/no-show` (`CALLED -> NO_SHOW`, records `no_show_at` and mandatory `noShowNote`)
  - `POST /api/tickets/:id/cancel` (`WAITING/CALLED -> CANCELLED`, records `cancelled_at` and mandatory `cancelReason`)
- **`FR-08` (Admin Category Management - Sprint 2):** Admin users shall be able to create, update and toggle the open/paused intake state (`is_open`) of service categories (`POST /api/categories`, `PATCH /api/categories/:id`) and set which staff are assigned to each category (`PUT /api/categories/:id/staff`).
- **`FR-09` (Ticket Itemization & Audit Log - Sprint 2):** The system shall expose the immutable log of every state transition (`ticket_events`, written since Sprint 1 by `FR-03`, `FR-05` and `FR-07`) through `GET /api/tickets/:id/events` and allow attaching beverage/pastry items to tickets (`POST /api/tickets/:id/items`).
- **`FR-10` (Customer Feedback & Operational Analytics - Sprint 3):** Customers shall be able to submit a 1-5 star rating on their own `COMPLETED` tickets (`POST /api/tickets/:id/feedback`) and Staff/Admin shall access aggregated operational metrics (`GET /api/analytics/summary`).

---

## 5. Domain Business Rules (`BR-xx`)

- **`BR-01` (Single Active Ticket Per Category Invariant):** A Customer may hold at most **one active ticket** (`WAITING`, `CALLED` or `SERVING`) per service category at any time. Attempting to create another ticket in the same category while one is active returns HTTP `409 Conflict` (`DUPLICATE_ACTIVE_TICKET`). The rule holds when requests arrive concurrently: it is enforced inside the join transaction and backed by a partial unique index, not only by an application check.
- **`BR-02` (Paused Category Intake Gate):** New walk-in tickets may only be created for categories where `is_open = true`. Attempting to join a closed or paused category returns HTTP `409 Conflict` (`CATEGORY_CLOSED`).
- **`BR-03` (Party Size & Input Boundaries):** `partySize` must be an integer between `1` and `8` inclusive. `specialRequests` is optional but capped at `280` characters. Invalid inputs return HTTP `400 Bad Request` (`VALIDATION_ERROR`).
- **`BR-04` (Strict State Machine Invariant):** Tickets must follow legal lifecycle transitions:
  - `WAITING` can transition only to `CALLED` or `CANCELLED`.
  - `CALLED` can transition only to `SERVING`, `NO_SHOW` or `CANCELLED`.
  - `SERVING` can transition only to `COMPLETED`.
  - `COMPLETED`, `NO_SHOW` and `CANCELLED` are terminal states; any mutation attempt returns HTTP `409 Conflict` (`INVALID_STATE_TRANSITION`).
- **`BR-05` (Mandatory Outcome Summaries):**
  - Transitioning to `COMPLETED` requires a trimmed `completionSummary` of 5-500 characters.
  - Transitioning to `CANCELLED` requires a trimmed `cancelReason` of 3-200 characters.
  - Transitioning to `NO_SHOW` requires a trimmed `noShowNote` of 3-200 characters.
  - Missing or blank notes return HTTP `400 Bad Request`.
- **`BR-06` (Customer Ownership Isolation & Cancellation Window):** A `CUSTOMER` may only read or cancel tickets where `ticket.customer_id === req.user.id` (returns HTTP `403 Forbidden` on foreign tickets). Furthermore, a `CUSTOMER` may only self-cancel while `status === 'WAITING'`; once a ticket is `CALLED` or `SERVING`, cancellation must be performed by Staff (returns HTTP `409 Conflict`).
- **`BR-07` (Monotonic Counter Ticket Sequences):** Each ticket receives a deterministic code formatted as `<PREFIX>-<NNN>` (e.g., `SB-001`, `EB-002`) generated from a persistent per-category counter (`service_categories.next_seq`) incremented inside the join transaction. Numbers are never reset (no daily reset) or reused; after `999` the number grows to four digits (`SB-1000`). Concurrent joins never receive the same code.
- **`BR-08` (Single Feedback Submission - Sprint 3):** Feedback ratings (1-5 stars) can only be submitted once per ticket and only on tickets in `COMPLETED` status. Duplicate feedback returns HTTP `409 Conflict`.
- **`BR-09` (Staff Counter Scope & Ticket Creation):** A `STAFF` user may list, call, serve, complete, mark no-show or cancel tickets only in categories assigned to them in `staff_counters`; any other category returns HTTP `403 Forbidden` (`FORBIDDEN`). `ADMIN` users act on every category. Only `CUSTOMER` accounts create tickets; `POST /api/tickets` by `STAFF` or `ADMIN` returns `403`.
- **`BR-10` (Call-Next FIFO Ordering):** Calling a customer always takes the oldest `WAITING` ticket (lowest `seq_no`) of the chosen category; the client cannot choose which ticket is called. An empty queue returns HTTP `409 Conflict` (`QUEUE_EMPTY`). Two simultaneous call-next requests on one category call two different tickets.

---

## 6. Non-Functional Requirements (`NFR-xx`)

| ID | Dimension | Measurable Requirement Statement | Verification Method | Target Sprint |
| :--- | :--- | :--- | :--- | :---: |
| **`NFR-01`** | **Security** | All stored passwords must be hashed with salted `bcrypt` (cost >= 10); plaintext passwords must never appear in logs, responses or storage. Responses from `/api/auth/me` and `/api/tickets` must never expose `password_hash`. | Automated integration test `TEST-01` inspecting database records and JSON keys. | Sprint 1 |
| **`NFR-02`** | **Configuration** | 100% of runtime configuration (`DATABASE_URL`, `SESSION_SECRET`, `PORT`, seed passwords) shall be injected via environment variables; `.env.example` must contain only placeholders with zero committed secrets; in `production` the server refuses to start when `SESSION_SECRET` is missing or still the placeholder. | `TEST-20`: a `git grep` secret scan over the repository and a startup test of the production guard; clean-clone build check. | Sprint 1 |
| **`NFR-03`** | **Data Persistence** | All domain entities (`users`, `categories`, `tickets`, `events`) and active user sessions shall reside in PostgreSQL 16; zero persistent state shall rely on local container storage. | Sprint 1: `TEST-01` and `TEST-04` read sessions and tickets back from PostgreSQL, and manual check `MC-01` restarts the server process and reuses the same cookie (`GET /api/auth/me` still `200`, ticket still listed). Lab 5: the same check across a container restart. | Sprint 1 (container check in Lab 5) |
| **`NFR-04`** | **Availability & Performance** | Public endpoints `/api/health` and `/api/ready` (executing `SELECT 1` on PostgreSQL) shall respond in `< 500 ms` with `200 OK` under normal conditions and `/api/ready` shall return `503` if the database is unreachable. | Automated smoke test script and integration test `TEST-12`. | Sprint 1 |
| **`NFR-05`** | **Responsive Design** | The web UI shall render without horizontal scrolling or overlapping controls across Desktop (`1280x800`), Tablet (`768x1024`) and Mobile (`375x667`), supporting explicit loading, empty and validation error states. | Playwright end-to-end test `TEST-19` at `375`, `768` and `1280` px (no horizontal scroll) plus component tests `TEST-13` and `TEST-14` for loading, empty and error states. | Sprint 1 (re-checked in Sprints 2-3) |
| **`NFR-06`** | **Concurrency Safety** | 20 parallel joins by one customer to one category store exactly 1 active ticket; 10 customers joining one category in parallel receive 10 distinct consecutive codes; 2 parallel call-next requests on one category call 2 different tickets. | API + DB integration test `TEST-18` (`Promise.all` against real PostgreSQL). | Sprint 1 |

---

## 7. Architectural Decisions & Resolutions

1. **Pure PostgreSQL 16 Strategy:** Selected Pure PostgreSQL 16 over third-party BaaS (Supabase) to strictly satisfy Lab 5 Google Cloud SQL deployment requirements and offline Docker reproducibility.
2. **Session Persistence via `connect-pg-simple`:** User authentication uses HTTP-only cookies backed by a `user_sessions` table in PostgreSQL, ensuring that user logins survive stateless Cloud Run container restarts and redeployments. Login calls `req.session.regenerate()` (no session fixation); the cookie is `httpOnly`, `SameSite=Lax` and `Secure` in production; a session expires 8 hours after login (`maxAge`, expired rows pruned); logout destroys the row and clears the cookie, after which the old cookie returns `401`.
3. **Category-Scoped Walk-In Queuing:** Tickets belong to distinct service categories rather than a single monolithic line. A customer may hold an active ticket in `SLOW_BAR` and separately enter `ROASTERY_CONSULT` after completion, but cannot flood the same category (`BR-01`).
4. **Idempotent Seed Data:** Development and testing use idempotent seeds (`ON CONFLICT DO UPDATE/NOTHING`, keyed on natural keys such as `email` and `code`) providing 5 pre-configured accounts, with passwords read only from `SEED_*_PASSWORD` environment variables:
   - `admin@omkoi.coffee` (`ADMIN` - Station Manager: Khun Mee)
   - `barista@omkoi.coffee` (`STAFF` - Head Barista: Khun Noble, assigned to `SLOW_BAR` and `ESPRESSO_BAR`)
   - `dessert@omkoi.coffee` (`STAFF` - Dessert Lead: Khun Fah, assigned to `DESSERT_LOUNGE`)
   - `boom@omkoi.coffee` (`CUSTOMER` - Guest: Boom)
   - `hongtae@omkoi.coffee` (`CUSTOMER` - Guest: Hongtae)
5. **Server-Side Call-Next (`BR-10`):** Staff press **Call next** on a counter and the server takes the oldest `WAITING` ticket (`SELECT ... FOR UPDATE SKIP LOCKED`). Theme 9 requires the operator to call "the next eligible entry", so the client never chooses a ticket id.
6. **Staff Counter Assignment (`BR-09`):** A `staff_counters` link table scopes each `STAFF` account to its counters; `ADMIN` skips the check. Theme 9 requires that operators act only on authorized queues and that this is tested. `ROASTERY_CONSULT` has no assigned staff in the seed, so only the admin serves it.
7. **Only Customers Create Tickets:** The ticket owner is always the guest, so `BR-01` and `BR-06` always apply to the guest. Staff-created walk-in tickets were dropped from Sprint 1 (`Q-01`).
8. **Concurrency Strategy (`BR-01`, `BR-07`, `NFR-06`):** The join transaction first runs `UPDATE service_categories SET next_seq = next_seq + 1 WHERE id = $1 AND is_open RETURNING next_seq - 1`, which takes the category row lock (joins to one counter run one at a time), enforces `BR-02` and yields the number. A partial unique index on active tickets backs up `BR-01`.
9. **Migrations:** Schema changes are numbered SQL migrations in `server/db/migrations/`, applied in order by `node-pg-migrate` (`npm run db:migrate`) and recorded in its `pgmigrations` table. Tests run against a migrated and seeded PostgreSQL database.

---

## 8. Assumptions

| ID | Assumption | Consequence if wrong |
| :--- | :--- | :--- |
| `A-01` | One café site with four seeded counters; a counter belongs to exactly one site. | Multi-site support would need a `site_id` on categories and accounts. |
| `A-02` | Every account has exactly one role (`CUSTOMER`, `STAFF` or `ADMIN`). | A multi-role account would need a role selector checked on the server. |
| `A-03` | Guests join and track their ticket on their own device while signed in. | A shared kiosk would need staff-created tickets (`Q-01`). |
| `A-04` | Ticket numbers only need to be unique for the life of the database; demo resets re-run migrations and seed. | A daily reset would need a service date in the code and in the unique key (`Q-03`). |
| `A-05` | Seeded test accounts are sufficient for Deliverable 1; self-registration and password recovery are excluded by the course. | None for Sprint 1. |

---

## 9. Open Questions & Resolutions

| ID | Question | Resolution | Status |
| :--- | :--- | :--- | :--- |
| `Q-01` | Can staff join a queue on behalf of a walk-in guest? | No. Guests join with their own account; `POST /api/tickets` is `CUSTOMER`-only (`BR-09`, decision 7). | Resolved (PR #4 review) |
| `Q-02` | Does a barista choose which ticket to call? | No. The server calls the oldest `WAITING` ticket of the counter (`BR-10`, decision 5). | Resolved (PR #4 review) |
| `Q-03` | Do ticket numbers reset daily? | No. Numbers rise per counter and are never reused (`BR-07`, `A-04`). | Resolved (PR #4 review) |
| `Q-04` | Can a customer cancel after being called? | No. Once `CALLED`, only staff cancel (`BR-06`). | Resolved |
| `Q-05` | Which Deliverable 1 deadline applies? The handout (v1) states 8 Nov 2026 23:59; the team plan uses 15 Nov 2026 23:59. | Confirm the extension on LEB2 and cite it in the submitted PDF. | Open |
