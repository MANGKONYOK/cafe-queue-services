# System-Level Software Design Specification (SDS)

## 1. System Architecture & Component Design

The Omkoi Station cafe system uses a three-tier decoupled architecture:
1. **Frontend Presentation Tier (`client/`):** A responsive Single Page Application built with React 18, Vite and Tailwind CSS. Implements the **Natural Luxury** design system (60% warm roasted walnut/terracotta, 30% highland mist lime-wash, 10% pine olive green), managing client-side form validation, role-based screen routing and asynchronous API communication with session cookie credentials (`credentials: 'include'`).
2. **Application & API Services Tier (`server/`):** A stateless Node.js 20 application built with Express. Enforces authentication via HTTP-only session cookies, Role-Based Access Control (RBAC) and domain business logic (`BR-01` to `BR-07`, `BR-09`, `BR-10`) in a dedicated service layer before invoking database operations.
3. **Data Persistence Tier (Pure PostgreSQL 16):** A relational database storing users, persistent session data, service counter configurations, queue tickets and immutable lifecycle transition events.

```mermaid
flowchart TD
    subgraph Client["Frontend Client (React 18 + Vite)"]
        UI_Login["Sign-In Screen\n(/login)"]
        UI_Customer["Customer Queue Portal\n(/queue)\n- Category Cards\n- Join Form\n- My Tickets & Cancel"]
        UI_Staff["Barista Counter Console\n(/staff)\n- Assigned Counter Tabs\n- Call Next / Serve / Complete / No-Show"]
    end

    subgraph Server["Backend API Server (Node.js 20 + Express on PORT=3000)"]
        MW_Session["Session Middleware\n(express-session + connect-pg-simple)"]
        MW_Auth["Auth & RBAC Middleware\n(requireAuth, requireRole, assertOwnership, assertStaffScope)"]
        
        Router_Auth["/api/auth\n(login, logout, me)"]
        Router_Cat["/api/categories\n(list, get, call-next)"]
        Router_Ticket["/api/tickets\n(create, my, list, get, cancel, serve, complete, no-show)"]
        Router_Health["/api/health & /api/ready\n(liveness & DB readiness)"]
        
        SVC_Queue["Queue Domain Service\n(Enforces BR-01..BR-07, BR-09, BR-10)"]
    end

    subgraph Database["Pure PostgreSQL 16 (Local Docker / Cloud SQL)"]
        DB_Sessions[("user_sessions\n(sid, sess, expire)")]
        DB_Users[("users\n(id, email, password_hash, role)")]
        DB_Categories[("service_categories\n(id, code, prefix, est_mins, is_open)")]
        DB_Tickets[("queue_tickets\n(id, code, category_id, customer_id, status, timestamps)")]
        DB_Events[("ticket_events\n(id, ticket_id, actor_id, from_status, to_status, note)")]
        DB_Staff[("staff_counters\n(staff_id, category_id)")]
    end

    Client -->|HTTP JSON + Cookie| MW_Session
    MW_Session --> DB_Sessions
    MW_Session --> MW_Auth
    
    MW_Auth --> Router_Auth
    MW_Auth --> Router_Cat
    MW_Auth --> Router_Ticket
    MW_Auth --> Router_Health
    
    Router_Ticket --> SVC_Queue
    Router_Cat --> SVC_Queue
    
    SVC_Queue --> DB_Users
    SVC_Queue --> DB_Categories
    SVC_Queue --> DB_Tickets
    SVC_Queue --> DB_Events
    SVC_Queue --> DB_Staff
    Router_Health -->|SELECT 1| Database
```

---

## 2. Database Schema & Data Models

### 2.1 Entity-Relationship Diagram

```mermaid
erDiagram
    USERS ||--o{ QUEUE_TICKETS : "customer_id (joins)"
    USERS ||--o{ QUEUE_TICKETS : "assigned_staff_id (serves)"
    USERS ||--o{ TICKET_EVENTS : "actor_id (triggers)"
    SERVICE_CATEGORIES ||--o{ QUEUE_TICKETS : "category_id (belongs to)"
    QUEUE_TICKETS ||--o{ TICKET_EVENTS : "ticket_id (logs history)"
    USERS ||--o{ STAFF_COUNTERS : "staff_id (assigned)"
    SERVICE_CATEGORIES ||--o{ STAFF_COUNTERS : "category_id (staffed by)"

    USERS {
        int id PK
        string email UK "NOT NULL"
        string password_hash "NOT NULL (bcrypt)"
        string full_name "NOT NULL"
        string role "CHECK ('CUSTOMER','STAFF','ADMIN')"
        timestamp created_at "DEFAULT CURRENT_TIMESTAMP"
    }

    SERVICE_CATEGORIES {
        int id PK
        string code UK "NOT NULL ('SLOW_BAR','ESPRESSO_BAR','DESSERT_LOUNGE','ROASTERY_CONSULT')"
        string name "NOT NULL"
        string prefix "NOT NULL ('SB','EB','DL','RC')"
        string description "TEXT"
        int est_mins_per_ticket "DEFAULT 10"
        boolean is_open "DEFAULT true"
        int next_seq "DEFAULT 1"
        timestamp updated_at "DEFAULT CURRENT_TIMESTAMP"
    }

    QUEUE_TICKETS {
        int id PK
        string ticket_code UK "NOT NULL (e.g., 'SB-001')"
        int category_id FK "NOT NULL REFERENCES service_categories(id)"
        int customer_id FK "NOT NULL REFERENCES users(id)"
        int assigned_staff_id FK "NULLABLE REFERENCES users(id)"
        int seq_no "NOT NULL, UNIQUE (category_id, seq_no)"
        int party_size "CHECK (party_size >= 1 AND party_size <= 8)"
        string special_requests "VARCHAR(280)"
        string status "CHECK ('WAITING','CALLED','SERVING','COMPLETED','NO_SHOW','CANCELLED')"
        string counter_name "VARCHAR(50)"
        string completion_summary "VARCHAR(500)"
        string cancel_reason "VARCHAR(200)"
        string no_show_note "VARCHAR(200)"
        timestamp created_at "DEFAULT CURRENT_TIMESTAMP"
        timestamp called_at "NULLABLE"
        timestamp serving_started_at "NULLABLE"
        timestamp completed_at "NULLABLE"
        timestamp cancelled_at "NULLABLE"
        timestamp no_show_at "NULLABLE"
    }

    TICKET_EVENTS {
        int id PK
        int ticket_id FK "NOT NULL REFERENCES queue_tickets(id) ON DELETE CASCADE"
        int actor_id FK "NOT NULL REFERENCES users(id)"
        string from_status "NULLABLE"
        string to_status "NOT NULL"
        string note "TEXT"
        timestamp created_at "DEFAULT CURRENT_TIMESTAMP"
    }

    STAFF_COUNTERS {
        int staff_id PK "REFERENCES users(id), role STAFF"
        int category_id PK "REFERENCES service_categories(id)"
        timestamp created_at "DEFAULT CURRENT_TIMESTAMP"
    }
```

### 2.2 Table Definitions & Data Integrity Constraints
1. **`users` Table:**
   - Primary key: `id SERIAL`.
   - Unique: `email VARCHAR(120) UNIQUE NOT NULL`.
   - Password: `password_hash VARCHAR(255) NOT NULL` (salted bcrypt hash, cost factor 10).
   - Role constraint: `CHECK (role IN ('CUSTOMER', 'STAFF', 'ADMIN'))`.
2. **`user_sessions` Table (Managed by `connect-pg-simple`):**
   - Standard session schema: `sid VARCHAR NOT NULL PRIMARY KEY`, `sess JSON NOT NULL`, `expire TIMESTAMP NOT NULL`.
   - Index on `expire` for automatic pruning.
   - Lifetime: `expire` is set 8 hours after login (cookie `maxAge`); expired rows are rejected and pruned; logout deletes the row (see section 5).
3. **`service_categories` Table:**
   - Primary key: `id SERIAL`.
   - Code: `code VARCHAR(30) UNIQUE NOT NULL`.
   - Prefix: `prefix VARCHAR(5) NOT NULL`.
   - Sequence Tracking: `next_seq INTEGER NOT NULL DEFAULT 1`, incremented only inside the join transaction (`UPDATE ... RETURNING`), never reset.
4. **`queue_tickets` Table:**
   - Constraints: `party_size BETWEEN 1 AND 8`, `special_requests <= 280 chars`.
   - Status: `CHECK (status IN ('WAITING', 'CALLED', 'SERVING', 'COMPLETED', 'NO_SHOW', 'CANCELLED'))`.
   - Ordering: `seq_no INTEGER NOT NULL` with `UNIQUE (category_id, seq_no)`; `ticket_code` is `prefix || '-' || lpad(seq_no, 3, '0')` and is `UNIQUE`. FIFO order and `aheadCount` use `seq_no`.
   - Join transaction (`BR-01`, `BR-02`, `BR-07`, `NFR-06`): `UPDATE service_categories SET next_seq = next_seq + 1 WHERE id = $1 AND is_open RETURNING next_seq - 1 AS seq_no` takes the category row lock, so joins to one category run one at a time; zero rows means paused (`409 CATEGORY_CLOSED`) or unknown (`404`). The active-ticket check and the insert follow in the same transaction.
   - Unique active ticket backstop (`BR-01`): `CREATE UNIQUE INDEX one_active_ticket ON queue_tickets (customer_id, category_id) WHERE status IN ('WAITING', 'CALLED', 'SERVING')`; a violation maps to `409 DUPLICATE_ACTIVE_TICKET`.
   - Call-next (`BR-10`): `SELECT ... WHERE category_id = $1 AND status = 'WAITING' ORDER BY seq_no LIMIT 1 FOR UPDATE SKIP LOCKED`, then a conditional `UPDATE ... WHERE status = 'WAITING'`, so two parallel calls take two different tickets.
   - Transitions (`BR-04`): every transition is a conditional `UPDATE ... WHERE id = $1 AND status = <expected>`; zero rows means `409 INVALID_STATE_TRANSITION`.
5. **`ticket_events` Table:**
   - Append-only audit log capturing every state change, acting user ID and mandatory operational note (`BR-05`). Written from Sprint 1 in the same transaction as the change; read through an endpoint from Sprint 2 (`FR-09`).
6. **`staff_counters` Table (`BR-09`):**
   - Composite primary key `(staff_id, category_id)`; both columns are foreign keys. Only `STAFF` users are linked; `ADMIN` users bypass the check.

### 2.3 Migrations
Schema changes are numbered SQL files in `server/db/migrations/`, applied in order by `node-pg-migrate` (`npm run db:migrate`) and recorded in its `pgmigrations` table. Migrations are never edited after merge; a change is a new file.

| Migration | Creates | Feature |
| :--- | :--- | :--- |
| `001_auth_and_categories` | `users`, `user_sessions`, `service_categories` | `F-01` |
| `002_queue_tickets` | `queue_tickets` (with `seq_no`, checks and `one_active_ticket` index), `ticket_events` | `F-02` |
| `003_staff_counters` | `staff_counters` | `F-03` |

### 2.4 Idempotent Seed Specification (`npm run db:seed`)
The seed script uses `ON CONFLICT DO UPDATE / NOTHING` on natural keys (`email`, `code`, `(staff_id, category_id)`) and never inserts explicit ids, so the `SERIAL` sequences stay correct for rows created later (for example by `F-04`). It refuses to run when a `SEED_*_PASSWORD` variable is missing:

```sql
-- Seeded Users (passwords read only from SEED_*_PASSWORD environment variables)
-- 1. Admin: admin@omkoi.coffee (Khun Mee - Station Manager)
-- 2. Staff: barista@omkoi.coffee (Khun Noble - Head Barista) -> SLOW_BAR, ESPRESSO_BAR
-- 3. Staff: dessert@omkoi.coffee (Khun Fah - Dessert Lead) -> DESSERT_LOUNGE
-- 4. Customer 1: boom@omkoi.coffee (Guest: Boom)
-- 5. Customer 2: hongtae@omkoi.coffee (Guest: Hongtae)
-- ROASTERY_CONSULT has no assigned staff: only the admin serves it.

-- Seeded Service Categories
INSERT INTO service_categories (code, name, prefix, description, est_mins_per_ticket, is_open)
VALUES
('SLOW_BAR', 'Omkoi Specialty Slow Bar (Pour-Over & Syphon)', 'SB', 'Handcrafted V60, Origami and Syphon single-origin highland micro-lots.', 12, true),
('ESPRESSO_BAR', 'Highland Espresso & Artisan Beverage Bar', 'EB', 'Speed-bar espresso, Omkoi Dirty Coffee and artisan ceremonial matcha.', 5, true),
('DESSERT_LOUNGE', 'Chiang Rai Mist Tea & Highland Dessert Table', 'DL', 'Seated table service for northern pastries and artisanal loose-leaf teas.', 15, true),
('ROASTERY_CONSULT', 'Omkoi Roastery & Bean Wholesale Consultation', 'RC', '1-on-1 green and roasted bean cupping and wholesale consultation.', 20, false)
ON CONFLICT (code) DO UPDATE SET
  name = EXCLUDED.name,
  description = EXCLUDED.description,
  est_mins_per_ticket = EXCLUDED.est_mins_per_ticket;
```
*(Notice: `ROASTERY_CONSULT` is seeded with `is_open = false` for the `BR-02` demonstration. A re-seed does not overwrite `is_open`, so automated tests set the fixture state they need themselves instead of relying on the seed.)*

---

## 3. UI, API & Access Conventions

### 3.1 Screens, Navigation & Shared UI States

| Screen | Route | Roles | Main content | Calls |
| :--- | :--- | :--- | :--- | :--- |
| Sign-In | `/login` | Public | Email/password form; safe `401` banner (no hint which field was wrong). | `POST /api/auth/login` |
| Customer Queue Portal | `/queue` | `CUSTOMER` | Category cards (open/paused), join form, my tickets with status, `aheadCount` and a cancel dialog. | `GET /api/categories`, `POST /api/tickets`, `GET /api/tickets/my`, `POST /api/tickets/:id/cancel` |
| Barista Counter Console | `/staff` | `STAFF`, `ADMIN` | One tab per assigned counter (Admin: all), status filter, **Call next**, Start serving, Complete / No-show / Cancel dialogs. | `GET /api/tickets`, `POST /api/categories/:id/call-next`, transition endpoints |

- **Navigation:** On load the client calls `GET /api/auth/me`. `401` redirects to `/login`; after login `CUSTOMER` lands on `/queue` and `STAFF`/`ADMIN` on `/staff`. A route of another role redirects to the user's home. The header shows the user's name and a **Sign out** button. Hidden routes are a convenience only; the API enforces every permission (section 4).
- **Loading:** Every data region shows a skeleton or spinner until its first response; action buttons are disabled while their request is pending (no double submit).
- **Empty:** "No active tickets - join a counter below" on `/queue`; "No guests waiting" per counter on `/staff`.
- **Validation:** Forms validate on submit with the same limits as the API (`partySize` 1-8, notes 3-200 or 5-500 characters) and show the message under the field. API `400 details` are shown the same way.
- **Errors:** `401` redirects to `/login`; `403`, `404` and `409` show the server's safe `message` in a banner and refresh the list; network or `5xx` errors show "Something went wrong - try again" without technical detail.
- **Refresh:** `/queue` and `/staff` refresh every 10 seconds while the page is visible and after every action.
- **Responsive:** No horizontal scroll at 375, 768 and 1280 px (`NFR-05`).

### 3.2 Standard API Envelope & Error Handling
All API responses use JSON. Successful responses wrap the payload in a named entity object (e.g., `{ "ticket": { ... } }` or `{ "tickets": [ ... ] }`).

All application errors return standard HTTP error status codes with an `error` envelope:
```json
{
  "error": {
    "code": "DUPLICATE_ACTIVE_TICKET",
    "message": "You already hold an active ticket (SB-001) in Omkoi Specialty Slow Bar.",
    "details": {}
  }
}
```

### 3.3 Complete API Endpoint Contract

| Method | Path | Required Auth & Roles | Request Body | Success Response | Error Status Codes & Conditions |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `GET` | `/api/health` | Public | None | `200 OK` `{"status":"ok"}` | - |
| `GET` | `/api/ready` | Public | None | `200 OK` `{"status":"ready","db":"connected"}` | `503 Service Unavailable` if database ping fails |
| `POST` | `/api/auth/login` | Public | `{"email","password"}` | `200 OK` `{"user":{id,email,fullName,role}}` + Session Cookie | `400` Missing fields, `401` Invalid credentials |
| `POST` | `/api/auth/logout` | `CUSTOMER`, `STAFF`, `ADMIN` | None | `200 OK` `{"status":"logged_out"}`; session row deleted, cookie cleared | `401` Unauthenticated |
| `GET` | `/api/auth/me` | `CUSTOMER`, `STAFF`, `ADMIN` | None | `200 OK` `{"user":{id,email,fullName,role}}` | `401` Unauthenticated |
| `GET` | `/api/categories` | `CUSTOMER`, `STAFF`, `ADMIN` | None | `200 OK` `{"categories":[...]}` | `401` Unauthenticated |
| `POST` | `/api/tickets` | `CUSTOMER` | `{"categoryId":1,"partySize":2,"specialRequests":"V60 Drip"}` | `201 Created` `{"ticket":{...}}` | `400` Invalid party size / length (`BR-03`), `401` Unauth, `403` `STAFF`/`ADMIN` (`BR-09`), `404` Unknown category, `409` Active ticket exists (`BR-01`), `409` Category paused (`BR-02`) |
| `GET` | `/api/tickets/my` | `CUSTOMER`, `STAFF`, `ADMIN` | None | `200 OK` `{"tickets":[...]}` (caller's own tickets with `aheadCount`) | `401` Unauthenticated |
| `GET` | `/api/tickets` | `STAFF` (assigned counters), `ADMIN` | Query: `?categoryId=&status=` | `200 OK` `{"tickets":[...]}` (ordered `seq_no ASC`; without `categoryId`, `STAFF` see only assigned counters) | `400` Invalid filter, `401` Unauth, `403` `CUSTOMER` role or unassigned `categoryId` (`BR-09`) |
| `GET` | `/api/tickets/:id` | Owner `CUSTOMER`, `STAFF`, `ADMIN` | None | `200 OK` `{"ticket":{...},"events":[...]}` | `401` Unauth, `403` Non-owner customer (`BR-06`), `404` Not found |
| `POST` | `/api/tickets/:id/cancel` | Owner `CUSTOMER` (only if `WAITING`), `STAFF` (assigned counter), `ADMIN` | `{"cancelReason":"Schedule changed"}` | `200 OK` `{"ticket":{...}}` | `400` Missing reason (`BR-05`), `403` Non-owner (`BR-06`) or unassigned counter (`BR-09`), `409` Already `CALLED`/`SERVING` for a customer, or terminal (`BR-04`, `BR-06`) |
| `POST` | `/api/categories/:id/call-next` | `STAFF` (assigned counter), `ADMIN` | `{"counterName":"Slow Bar Station 1"}` (optional) | `200 OK` `{"ticket":{...}}` (the oldest `WAITING` ticket, now `CALLED`) | `401` Unauth, `403` if `CUSTOMER` or unassigned counter (`BR-09`), `404` Unknown category, `409` `QUEUE_EMPTY` (`BR-10`) |
| `POST` | `/api/tickets/:id/serve` | `STAFF` (assigned counter), `ADMIN` | None | `200 OK` `{"ticket":{...}}` | `401` Unauth, `403` if `CUSTOMER` or unassigned counter, `404` Not found, `409` Not in `CALLED` state (`BR-04`) |
| `POST` | `/api/tickets/:id/complete` | `STAFF` (assigned counter), `ADMIN` | `{"completionSummary":"Served 2x V60 Mae Tuen Washed"}` | `200 OK` `{"ticket":{...}}` | `400` Missing summary (`BR-05`), `403` if `CUSTOMER` or unassigned counter, `404` Not found, `409` Not in `SERVING` state (`BR-04`) |
| `POST` | `/api/tickets/:id/no-show` | `STAFF` (assigned counter), `ADMIN` | `{"noShowNote":"Called 3x over 5 mins, no response"}` | `200 OK` `{"ticket":{...}}` | `400` Missing note (`BR-05`), `403` if `CUSTOMER` or unassigned counter, `404` Not found, `409` Not in `CALLED` state (`BR-04`) |

Checks run in a fixed order so every endpoint refuses predictably: `401` session -> `403` role -> `403` ownership/counter scope -> `404` -> `400` body -> `409` rule. For a `CUSTOMER`, a ticket that is not theirs returns `403` whether or not it exists.

---

## 4. Role-Based Access Control (RBAC) & Ownership Security Matrix

All authorization checks are enforced server-side inside Express middleware (`requireAuth`, `requireRole`, `assertTicketOwnerOrStaff` and `assertStaffScope`, which looks up `staff_counters` for the ticket's or route's category). Client-side UI controls dynamically hide or show actions based on `user.role`, but any unauthorized HTTP request is rejected with `401 Unauthorized` or `403 Forbidden`.

| System Operation | Unauthenticated | Customer (`CUSTOMER`) | Staff (`STAFF`) | Administrator (`ADMIN`) | Backend Enforcement Mechanism |
| :--- | :---: | :---: | :---: | :---: | :--- |
| `POST /api/auth/login` | Allowed | Allowed | Allowed | Allowed | Public controller |
| `GET /api/auth/me`, `POST /api/auth/logout` | `401` | Allowed | Allowed | Allowed | `requireAuth` middleware |
| `GET /api/categories` | `401` | Allowed | Allowed | Allowed | `requireAuth` middleware |
| `POST /api/tickets` (Join Queue) | `401` | Allowed | `403 Forbidden` | `403 Forbidden` | `requireRole(['CUSTOMER'])` + `BR-01` transaction |
| `GET /api/tickets/my` | `401` | Own tickets only | Own tickets only | Own tickets only | `req.user.id` query scoping |
| `GET /api/tickets/:id` | `401` | Own ticket only (`403` if foreign) | Assigned counters only | Allowed (All) | `assertTicketOwnerOrStaff` + `assertStaffScope` |
| `POST /api/tickets/:id/cancel` | `401` | Own ticket only, `WAITING` only | Assigned counters (`WAITING`/`CALLED`) | Allowed (`WAITING`/`CALLED`) | `assertTicketOwnerOrStaff` + `assertStaffScope` + `BR-06` status check |
| `GET /api/tickets` (Queue Console) | `401` | `403 Forbidden` | Assigned counters only | Allowed (All) | `requireRole(['STAFF', 'ADMIN'])` + `assertStaffScope` |
| `POST /api/categories/:id/call-next` | `401` | `403 Forbidden` | Assigned counters only | Allowed (All) | `requireRole(['STAFF', 'ADMIN'])` + `assertStaffScope` |
| `POST /api/tickets/:id/serve` | `401` | `403 Forbidden` | Assigned counters only | Allowed (All) | `requireRole(['STAFF', 'ADMIN'])` + `assertStaffScope` |
| `POST /api/tickets/:id/complete` | `401` | `403 Forbidden` | Assigned counters only | Allowed (All) | `requireRole(['STAFF', 'ADMIN'])` + `assertStaffScope` |
| `POST /api/tickets/:id/no-show` | `401` | `403 Forbidden` | Assigned counters only | Allowed (All) | `requireRole(['STAFF', 'ADMIN'])` + `assertStaffScope` |
| `POST/PATCH/PUT /api/categories/*` incl. staff assignment (Sprint 2) | `401` | `403 Forbidden` | `403 Forbidden` | Allowed | `requireRole(['ADMIN'])` |

---

## 5. Authentication & Session Lifecycle

| Step | Behaviour |
| :--- | :--- |
| Credentials | Passwords are stored only as salted `bcrypt` hashes (cost 10). Login compares with `bcrypt.compare`; a wrong password and an unknown email return the same `401 INVALID_CREDENTIALS` message. No response, log or error contains a password or `password_hash`. |
| Session creation | On success the server calls `req.session.regenerate()` (prevents session fixation), stores `userId` and `role`, and `connect-pg-simple` writes the row to `user_sessions`. |
| Cookie | `connect.sid`, signed with `SESSION_SECRET`, `httpOnly`, `SameSite=Lax`, `Secure` when `NODE_ENV=production`, `maxAge` 8 hours. The SPA is served from the same origin, so no CORS is needed. |
| Expiry | A session is valid for 8 hours from login (absolute, `rolling: false`). An expired session is treated as no session (`401`); expired rows are pruned by `connect-pg-simple`. |
| Current user | `requireAuth` loads the user by the session's `userId` on every protected request; `GET /api/auth/me` returns `{ id, email, fullName, role }`. The role always comes from the database, never from the client. |
| Logout | `POST /api/auth/logout` destroys the `user_sessions` row and clears the cookie; the old cookie then returns `401` on `GET /api/auth/me`. |

---

## 6. Configuration & Delivery Architecture

### 6.1 Environment Variable Specification (`.env.example`)
Zero credentials or sensitive secrets are committed to version control. The repository provides `.env.example` with placeholders only. On startup with `NODE_ENV=production` the server exits if `SESSION_SECRET` is missing or still the placeholder, and the seed exits if a `SEED_*_PASSWORD` is missing:

| Variable Name | Required | Default (Development) | Purpose |
| :--- | :---: | :--- | :--- |
| `PORT` | Yes | `3000` | Port on which the Express HTTP server listens (bound to `0.0.0.0`). |
| `NODE_ENV` | Yes | `development` | Runtime environment (`development`, `test`, `production`). |
| `DATABASE_URL` | Yes | `postgresql://postgres:postgres@localhost:5432/omkoi_queue` | PostgreSQL 16 connection string. |
| `SESSION_SECRET` | Yes | `change-me` placeholder (each developer sets a local random value) | Secret string used by `express-session` to sign cookie hashes. |
| `SEED_ADMIN_PASSWORD` | For seeding | `change-me` placeholder | Password for seeded `admin@omkoi.coffee`. |
| `SEED_STAFF_PASSWORD` | For seeding | `change-me` placeholder | Password for seeded `barista@omkoi.coffee` and `dessert@omkoi.coffee`. |
| `SEED_CUSTOMER_PASSWORD`| For seeding | `change-me` placeholder | Password for seeded customer accounts. |

Test-account passwords are shared through the private course handoff, never in Git or the PDF.

### 6.2 Delivery Architecture Design
- **Local Development:** Developers run PostgreSQL 16 via Docker, run migrations/seeds using `npm run db:migrate` and `npm run db:seed` and launch the Express backend and Vite client concurrently.
- **Packaging:** Multi-stage `Dockerfile` compiles the React frontend to static assets served by the Express server on `PORT=3000` as non-root `USER node`.
- **Cloud Run Deployment:** Designed for serverless deployment on Google Cloud Run connected to Google Cloud SQL PostgreSQL 16 via Cloud SQL Auth Proxy Unix socket, with runtime secrets injected from Google Secret Manager.