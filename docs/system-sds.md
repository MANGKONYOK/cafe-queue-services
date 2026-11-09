# System-Level Software Design Specification (SDS)

## 1. System Architecture & Component Design

The Omkoi Station cafe system uses a three-tier decoupled architecture:
1. **Frontend Presentation Tier (`client/`):** A responsive Single Page Application built with React 18, Vite and Tailwind CSS. Implements the **Natural Luxury** design system (60% warm roasted walnut/terracotta, 30% highland mist lime-wash, 10% pine olive green), managing client-side form validation, role-based screen routing and asynchronous API communication with session cookie credentials (`credentials: 'include'`).
2. **Application & API Services Tier (`server/`):** A stateless Node.js 20 application built with Express. Enforces authentication via HTTP-only session cookies, Role-Based Access Control (RBAC) and domain business logic (`BR-01` to `BR-07`) in a dedicated service layer before invoking database operations.
3. **Data Persistence Tier (Pure PostgreSQL 16):** A relational database storing users, persistent session data, service counter configurations, queue tickets and immutable lifecycle transition events.

```mermaid
flowchart TD
    subgraph Client["Frontend Client (React 18 + Vite)"]
        UI_Login["Sign-In Screen\n(/login)"]
        UI_Customer["Customer Queue Portal\n(/queue)\n- Category Cards\n- Join Form\n- My Tickets & Cancel"]
        UI_Staff["Barista Counter Console\n(/staff)\n- Queue Filter Bar\n- Call / Serve / Complete / No-Show"]
    end

    subgraph Server["Backend API Server (Node.js 20 + Express on PORT=3000)"]
        MW_Session["Session Middleware\n(express-session + connect-pg-simple)"]
        MW_Auth["Auth & RBAC Middleware\n(requireAuth, requireRole, assertOwnership)"]
        
        Router_Auth["/api/auth\n(login, logout, me)"]
        Router_Cat["/api/categories\n(list, get)"]
        Router_Ticket["/api/tickets\n(create, my, list, get, cancel, call, serve, complete, no-show)"]
        Router_Health["/api/health & /api/ready\n(liveness & DB readiness)"]
        
        SVC_Queue["Queue Domain Service\n(Enforces BR-01..BR-07 State Machine)"]
    end

    subgraph Database["Pure PostgreSQL 16 (Local Docker / Cloud SQL)"]
        DB_Sessions[("user_sessions\n(sid, sess, expire)")]
        DB_Users[("users\n(id, email, password_hash, role)")]
        DB_Categories[("service_categories\n(id, code, prefix, est_mins, is_open)")]
        DB_Tickets[("queue_tickets\n(id, code, category_id, customer_id, status, timestamps)")]
        DB_Events[("ticket_events\n(id, ticket_id, actor_id, from_status, to_status, note)")]
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
        string ticket_type "DEFAULT 'DINE_IN' CHECK ('DINE_IN','TAKEAWAY','DELIVERY_PICKUP')"
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
3. **`service_categories` Table:**
   - Primary key: `id SERIAL`.
   - Code: `code VARCHAR(30) UNIQUE NOT NULL`.
   - Prefix: `prefix VARCHAR(5) NOT NULL`.
   - Sequence Tracking: `next_seq INTEGER NOT NULL DEFAULT 1`.
4. **`queue_tickets` Table:**
   - Constraints: `party_size BETWEEN 1 AND 8`, `special_requests <= 280 chars`.
   - Status: `CHECK (status IN ('WAITING', 'CALLED', 'SERVING', 'COMPLETED', 'NO_SHOW', 'CANCELLED'))`.
   - Unique active ticket enforcement (`BR-01`): Handled via relational transactional lock `SELECT FOR UPDATE` checking existing tickets with status in `('WAITING', 'CALLED', 'SERVING')` for the same `(customer_id, category_id)`.
5. **`ticket_events` Table:**
   - Append-only audit log capturing every state change, acting user ID and mandatory operational note (`BR-05`).

### 2.3 Idempotent Seed Specification (`npm run db:seed`)
The seed script uses `ON CONFLICT DO UPDATE / NOTHING` to ensure repeatability across development, automated tests and production without corrupting existing data:

```sql
-- Seeded Users (Passwords read from SEED_*_PASSWORD environment variables with local dev fallbacks)
-- 1. Admin: admin@omkoi.coffee (Khun Mee - Station Manager)
-- 2. Staff: barista@omkoi.coffee (Khun Noble - Head Barista)
-- 3. Customer 1: boom@omkoi.coffee (Guest: Boom)
-- 4. Customer 2: hongtae@omkoi.coffee (Guest: Hongtae)

-- Seeded Service Categories
INSERT INTO service_categories (id, code, name, prefix, description, est_mins_per_ticket, is_open, next_seq)
VALUES
(1, 'SLOW_BAR', 'Omkoi Specialty Slow Bar (Pour-Over & Syphon)', 'SB', 'Handcrafted V60, Origami and Syphon single-origin highland micro-lots.', 12, true, 1),
(2, 'ESPRESSO_BAR', 'Highland Espresso & Artisan Beverage Bar', 'EB', 'Speed-bar espresso, Omkoi Dirty Coffee and artisan ceremonial matcha.', 5, true, 1),
(3, 'DESSERT_LOUNGE', 'Chiang Rai Mist Tea & Highland Dessert Table', 'DL', 'Seated table service for northern pastries and artisanal loose-leaf teas.', 15, true, 1),
(4, 'ROASTERY_CONSULT', 'Omkoi Roastery & Bean Wholesale Consultation', 'RC', '1-on-1 green and roasted bean cupping and wholesale consultation.', 20, false, 1)
ON CONFLICT (id) DO UPDATE SET
  name = EXCLUDED.name,
  description = EXCLUDED.description,
  est_mins_per_ticket = EXCLUDED.est_mins_per_ticket;
```
*(Notice: Category 4 `ROASTERY_CONSULT` is seeded with `is_open = false` to enable automated verification of `BR-02` out of the box)*

---

## 3. UI, API & Access Conventions

### 3.1 Standard API Envelope & Error Handling
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

### 3.2 Complete API Endpoint Contract

| Method | Path | Required Auth & Roles | Request Body | Success Response | Error Status Codes & Conditions |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `GET` | `/api/health` | Public | None | `200 OK` `{"status":"ok"}` | - |
| `GET` | `/api/ready` | Public | None | `200 OK` `{"status":"ready","db":"connected"}` | `503 Service Unavailable` if database ping fails |
| `POST` | `/api/auth/login` | Public | `{"email","password"}` | `200 OK` `{"user":{id,email,fullName,role}}` + Session Cookie | `400` Missing fields, `401` Invalid credentials |
| `POST` | `/api/auth/logout` | `CUSTOMER`, `STAFF`, `ADMIN` | None | `200 OK` `{"status":"logged_out"}` | `401` Unauthenticated |
| `GET` | `/api/auth/me` | `CUSTOMER`, `STAFF`, `ADMIN` | None | `200 OK` `{"user":{id,email,fullName,role}}` | `401` Unauthenticated |
| `GET` | `/api/categories` | `CUSTOMER`, `STAFF`, `ADMIN` | None | `200 OK` `{"categories":[...]}` | `401` Unauthenticated |
| `POST` | `/api/tickets` | `CUSTOMER`, `STAFF`, `ADMIN` | `{"categoryId":1,"partySize":2,"specialRequests":"V60 Drip"}` | `201 Created` `{"ticket":{...}}` | `400` Invalid party size / length (`BR-03`), `401` Unauth, `409` Active ticket exists (`BR-01`), `409` Category paused (`BR-02`) |
| `GET` | `/api/tickets/my` | `CUSTOMER`, `STAFF`, `ADMIN` | None | `200 OK` `{"tickets":[...]}` (caller's own tickets with `aheadCount`) | `401` Unauthenticated |
| `GET` | `/api/tickets` | `STAFF`, `ADMIN` | Query: `?categoryId=&status=` | `200 OK` `{"tickets":[...]}` (ordered `created_at ASC`) | `401` Unauth, `403` Forbidden if `CUSTOMER` role |
| `GET` | `/api/tickets/:id` | Owner `CUSTOMER`, `STAFF`, `ADMIN` | None | `200 OK` `{"ticket":{...},"events":[...]}` | `401` Unauth, `403` Non-owner customer (`BR-06`), `404` Not found |
| `POST` | `/api/tickets/:id/cancel` | Owner `CUSTOMER` (only if `WAITING`), `STAFF`, `ADMIN` | `{"cancelReason":"Schedule changed"}` | `200 OK` `{"ticket":{...}}` | `400` Missing reason (`BR-05`), `403` Non-owner (`BR-06`), `409` Already `CALLED`/`SERVING` or terminal (`BR-04`, `BR-06`) |
| `POST` | `/api/tickets/:id/call` | `STAFF`, `ADMIN` | `{"counterName":"Slow Bar Station 1"}` | `200 OK` `{"ticket":{...}}` | `401` Unauth, `403` if `CUSTOMER`, `404` Not found, `409` Not in `WAITING` state (`BR-04`) |
| `POST` | `/api/tickets/:id/serve` | `STAFF`, `ADMIN` | `{"counterName":"Slow Bar Station 1"}` | `200 OK` `{"ticket":{...}}` | `401` Unauth, `403` if `CUSTOMER`, `404` Not found, `409` Not in `CALLED` state (`BR-04`) |
| `POST` | `/api/tickets/:id/complete` | `STAFF`, `ADMIN` | `{"completionSummary":"Served 2x V60 Mae Tuen Washed"}` | `200 OK` `{"ticket":{...}}` | `400` Missing summary (`BR-05`), `403` if `CUSTOMER`, `409` Not in `SERVING` state (`BR-04`) |
| `POST` | `/api/tickets/:id/no-show` | `STAFF`, `ADMIN` | `{"noShowNote":"Called 3x over 5 mins, no response"}` | `200 OK` `{"ticket":{...}}` | `400` Missing note (`BR-05`), `403` if `CUSTOMER`, `409` Not in `CALLED` state (`BR-04`) |

---

## 4. Role-Based Access Control (RBAC) & Ownership Security Matrix

All authorization checks are enforced server-side inside Express middleware (`requireAuth`, `requireRole` and `assertTicketOwnerOrStaff`). Client-side UI controls dynamically hide or show actions based on `user.role`, but any unauthorized HTTP request is rejected with `401 Unauthorized` or `403 Forbidden`.

| System Operation | Unauthenticated | Customer (`CUSTOMER`) | Staff (`STAFF`) | Administrator (`ADMIN`) | Backend Enforcement Mechanism |
| :--- | :---: | :---: | :---: | :---: | :--- |
| `POST /api/auth/login` | Allowed | Allowed | Allowed | Allowed | Public controller |
| `GET /api/auth/me`, `POST /api/auth/logout` | `401` | Allowed | Allowed | Allowed | `requireAuth` middleware |
| `GET /api/categories` | `401` | Allowed | Allowed | Allowed | `requireAuth` middleware |
| `POST /api/tickets` (Join Queue) | `401` | Allowed | Allowed | Allowed | `requireAuth` middleware + `BR-01` check |
| `GET /api/tickets/my` | `401` | Own tickets only | Own tickets only | Own tickets only | `req.user.id` query scoping |
| `GET /api/tickets/:id` | `401` | Own ticket only (`403` if foreign) | Allowed (All) | Allowed (All) | `assertTicketOwnerOrStaff` guard |
| `POST /api/tickets/:id/cancel` | `401` | Own ticket only, `WAITING` only | Allowed (`WAITING`/`CALLED`) | Allowed (`WAITING`/`CALLED`) | `assertTicketOwnerOrStaff` + `BR-06` status check |
| `GET /api/tickets` (Full Queue Console) | `401` | `403 Forbidden` | Allowed | Allowed | `requireRole(['STAFF', 'ADMIN'])` |
| `POST /api/tickets/:id/call` | `401` | `403 Forbidden` | Allowed | Allowed | `requireRole(['STAFF', 'ADMIN'])` |
| `POST /api/tickets/:id/serve` | `401` | `403 Forbidden` | Allowed | Allowed | `requireRole(['STAFF', 'ADMIN'])` |
| `POST /api/tickets/:id/complete` | `401` | `403 Forbidden` | Allowed | Allowed | `requireRole(['STAFF', 'ADMIN'])` |
| `POST /api/tickets/:id/no-show` | `401` | `403 Forbidden` | Allowed | Allowed | `requireRole(['STAFF', 'ADMIN'])` |
| `POST/PATCH /api/categories/*` (Sprint 2) | `401` | `403 Forbidden` | `403 Forbidden` | Allowed | `requireRole(['ADMIN'])` |

---

## 5. Configuration & Delivery Architecture

### 5.1 Environment Variable Specification (`.env.example`)
Zero credentials or sensitive secrets are committed to version control. The repository provides `.env.example` with clear documentation:

| Variable Name | Required | Default (Development) | Purpose |
| :--- | :---: | :--- | :--- |
| `PORT` | Yes | `3000` | Port on which the Express HTTP server listens (bound to `0.0.0.0`). |
| `NODE_ENV` | Yes | `development` | Runtime environment (`development`, `test`, `production`). |
| `DATABASE_URL` | Yes | `postgresql://postgres:postgres@localhost:5432/omkoi_queue` | PostgreSQL 16 connection string. |
| `SESSION_SECRET` | Yes | `dev-insecure-secret-key-change-in-production` | Secret string used by `express-session` to sign cookie hashes. |
| `SEED_ADMIN_PASSWORD` | No | `AdminOmkoi123!` | Password for seeded `admin@omkoi.coffee`. |
| `SEED_STAFF_PASSWORD` | No | `StaffOmkoi123!` | Password for seeded `barista@omkoi.coffee`. |
| `SEED_CUSTOMER_PASSWORD`| No | `GuestOmkoi123!` | Password for seeded customer accounts. |

### 5.2 Delivery Architecture Design
- **Local Development:** Developers run PostgreSQL 16 via Docker, run migrations/seeds using `npm run db:migrate` and `npm run db:seed` and launch the Express backend and Vite client concurrently.
- **Packaging:** Multi-stage `Dockerfile` compiles the React frontend to static assets served by the Express server on `PORT=3000` as non-root `USER node`.
- **Cloud Run Deployment:** Designed for serverless deployment on Google Cloud Run connected to Google Cloud SQL PostgreSQL 16 via Cloud SQL Auth Proxy Unix socket, with runtime secrets injected from Google Secret Manager.