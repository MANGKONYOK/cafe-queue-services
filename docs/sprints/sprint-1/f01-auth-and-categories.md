# Feature Specification & Contract
**Feature Name:** Authentication, Sessions & Service Counter Directory  
**Feature ID:** `F-01`  
**Owning Requirements:** `FR-01`, `FR-02`, `BR-02`, `NFR-01`, `NFR-02`, `NFR-03`, `NFR-04`  
**Dependencies:** None (first feature). Needs migration `001_auth_and_categories` and the seed.  
**Contract Version:** 1.1 (see section 9)  

---

## 1. Feature Overview & User Workflows

Feature `F-01` establishes the foundational security, identity and service discovery capabilities of Omkoi Station.

### 1.1 User Login & Session Retrieval Workflow
1. The user navigates to `/login` and enters their email and password.
2. The client submits `POST /api/auth/login`.
3. The server queries the `users` table, verifies the submitted password against the stored salted `bcrypt` hash, regenerates the session (`req.session.regenerate()`), issues an `httpOnly`, `SameSite=Lax` session cookie signed by `SESSION_SECRET` (`Secure` in production, `maxAge` 8 hours) and saves session data to PostgreSQL (`user_sessions`).
4. On subsequent page loads, the frontend calls `GET /api/auth/me` with `credentials: 'include'`. The server validates the session and returns `{ id, email, fullName, role }`.
5. When the user logs out, `POST /api/auth/logout` destroys the session in PostgreSQL and clears the browser cookie; the old cookie then returns `401`.
6. A session older than 8 hours is treated as no session (`401`), and the client redirects to `/login`.

### 1.2 Service Counter Directory Workflow
1. Authenticated users (`CUSTOMER`, `STAFF` or `ADMIN`) request `GET /api/categories`.
2. The server queries `service_categories` and returns an array of categories (`SLOW_BAR`, `ESPRESSO_BAR`, `DESSERT_LOUNGE`, `ROASTERY_CONSULT`) containing their code, name, description, prefix, estimated duration and `is_open` status.
3. The client renders the categories with visual indicators (`OPEN` in amber/green vs. `PAUSED` in muted gray) to guide queue selection.

---

## 2. API & Data Contract

### 2.1 API Endpoints
- `POST /api/auth/login`
  - Body: `{ "email": "boom@omkoi.coffee", "password": "<SEED_CUSTOMER_PASSWORD>" }`
  - Success `200 OK`: `{ "user": { "id": 3, "email": "boom@omkoi.coffee", "fullName": "Boom", "role": "CUSTOMER" } }`
  - Error `400 Bad Request`: `{ "error": { "code": "VALIDATION_ERROR", "message": "Email and password are required." } }`
  - Error `401 Unauthorized`: `{ "error": { "code": "INVALID_CREDENTIALS", "message": "Invalid email or password." } }`
- `GET /api/auth/me`
  - Headers: Cookie `connect.sid=...`
  - Success `200 OK`: `{ "user": { "id": 3, "email": "boom@omkoi.coffee", "fullName": "Boom", "role": "CUSTOMER" } }`
  - Error `401 Unauthorized`: `{ "error": { "code": "UNAUTHORIZED", "message": "Authentication required." } }`
- `POST /api/auth/logout`
  - Success `200 OK`: `{ "status": "logged_out" }`; the `user_sessions` row is deleted and `Set-Cookie` clears `connect.sid`
  - Error `401 Unauthorized`: `{ "error": { "code": "UNAUTHORIZED", "message": "Authentication required." } }`
- `GET /api/categories`
  - Success `200 OK`:
    ```json
    {
      "categories": [
        {
          "id": 1,
          "code": "SLOW_BAR",
          "name": "Omkoi Specialty Slow Bar (Pour-Over & Syphon)",
          "prefix": "SB",
          "description": "Handcrafted single-origin highland micro-lots.",
          "estMinsPerTicket": 12,
          "isOpen": true
        },
        {
          "id": 4,
          "code": "ROASTERY_CONSULT",
          "name": "Omkoi Roastery & Bean Wholesale Consultation",
          "prefix": "RC",
          "description": "1-on-1 green and roasted bean cupping.",
          "estMinsPerTicket": 20,
          "isOpen": false
        }
      ]
    }
    ```
- `GET /api/health`
  - Success `200 OK`: `{ "status": "ok" }`
- `GET /api/ready`
  - Success `200 OK`: `{ "status": "ready", "db": "connected" }`
  - Error `503 Service Unavailable`: `{ "status": "not_ready", "db": "disconnected" }`

### 2.2 Data Contract
- **New tables (migration `001_auth_and_categories`):** `users` (`id`, `email` unique, `password_hash`, `full_name`, `role` check `CUSTOMER`/`STAFF`/`ADMIN`, `created_at`); `user_sessions` (`sid` PK, `sess` JSON, `expire` indexed); `service_categories` (`id`, `code` unique, `name`, `prefix`, `description`, `est_mins_per_ticket`, `is_open`, `next_seq`, `updated_at`).
- **Seed:** 5 accounts and 4 categories (SDS 2.4); passwords from `SEED_*_PASSWORD` only.
- **Changed tables:** none (first migration).

---

## 3. Business Rules & Validation
- `email` and `password` are required non-empty strings; `email` is trimmed and lower-cased before lookup.
- Passwords are compared with `bcrypt.compare`; hashes use cost 10 (`NFR-01`).
- A wrong password and an unknown email give the same `401` message (no account enumeration).
- `GET /api/categories` is read-only in Sprint 1; `isOpen` reflects `BR-02` (enforced at join time by `F-02`).
- `/api/health` never touches the database; `/api/ready` runs `SELECT 1` and returns `503` when it fails (`NFR-04`).

## 4. Failure & Boundary Cases
| Case | Result |
| :--- | :--- |
| Missing or blank `email`/`password` | `400 VALIDATION_ERROR`, no session |
| Wrong password / unknown email | `401 INVALID_CREDENTIALS`, same message, no session row |
| No cookie, tampered cookie, expired session, cookie after logout | `401 UNAUTHORIZED` on every protected endpoint, no data |
| Database unreachable | `/api/ready` `503`; other endpoints `500` with a safe message and no stack trace |

## 5. Permissions
| Operation | Public | `CUSTOMER` | `STAFF` | `ADMIN` |
| :--- | :---: | :---: | :---: | :---: |
| `POST /api/auth/login`, `GET /api/health`, `GET /api/ready` | Allowed | Allowed | Allowed | Allowed |
| `GET /api/auth/me`, `POST /api/auth/logout`, `GET /api/categories` | `401` | Allowed | Allowed | Allowed |

## 6. UI Specification
- **`/login`:** email and password fields, **Sign in** button disabled while pending, `401` banner "Invalid email or password.", field errors on empty submit. After success, `CUSTOMER` goes to `/queue` and `STAFF`/`ADMIN` to `/staff`.
- **App shell:** calls `GET /api/auth/me` on load (loading state until it returns); shows the user's name and **Sign out**; `401` from any call redirects to `/login`.
- **Category cards (used by `F-02`):** name, prefix, estimated minutes, `OPEN` or `PAUSED` badge; an empty list shows "No counters available".

---

## 7. Acceptance Criteria (`AC-xx` - Given-When-Then)

### `AC-01` (Valid Authentication & Session Persistence - Positive)
- **Given** an existing seeded user `boom@omkoi.coffee` with a salted bcrypt password in PostgreSQL,
- **When** the client sends `POST /api/auth/login` with correct credentials and subsequently calls `GET /api/auth/me` with the returned session cookie,
- **Then** the server responds with HTTP `200 OK`, returns `{ id, email, fullName, role: "CUSTOMER" }`, records a session row in `user_sessions` and never reveals `password_hash`.

### `AC-02` (Invalid Credentials & Unauthenticated Rejection - Negative/Security)
- **Given** an unauthenticated client or incorrect password,
- **When** the client submits `POST /api/auth/login` with an incorrect password or calls `GET /api/auth/me` without a session cookie,
- **Then** the server responds with HTTP `401 Unauthorized`, creates no session and returns a safe error payload.

### `AC-03` (Service Categories Directory & System Readiness - Positive)
- **Given** an authenticated user and an operational database connection,
- **When** the client requests `GET /api/categories` and a monitoring probe requests `GET /api/ready`,
- **Then** `GET /api/categories` returns HTTP `200 OK` listing the 4 Omkoi service counters with their prefixes and `isOpen` flags and `GET /api/ready` returns HTTP `200 OK` with `{ "status": "ready", "db": "connected" }`.

### `AC-13` (Logout & Session Expiry - Positive & Security)
- **Given** a customer signed in as `boom@omkoi.coffee` with a valid session cookie,
- **When** the client calls `POST /api/auth/logout` and then calls `GET /api/auth/me` with the same cookie, or calls `GET /api/auth/me` with a session whose `expire` is in the past,
- **Then** logout responds `200 OK`, the `user_sessions` row is deleted and the cookie is cleared, and both later `GET /api/auth/me` calls respond `401 Unauthorized` with no user data.

---

## 8. Verification
| AC | Tests (see `sts-and-dod.md`) |
| :--- | :--- |
| `AC-01` | `TEST-01`, `TEST-19` |
| `AC-02` | `TEST-02` |
| `AC-03` | `TEST-03`, `TEST-12` |
| `AC-13` | `TEST-15`, `TEST-19` |

---

## 9. Version History
| Version | Date | Commit | Author | Change |
| :--- | :--- | :--- | :--- | :--- |
| 1.0 | 2026-11-09 | `a9c7a02` | @MANGKONYOK | First contract: login, me, logout, categories, health/ready; `AC-01`-`AC-03`. |
| 1.1 | 2026-11-14 | PR #4 review commit | @kmood-Sakura | Added `AC-13` logout and expiry, cookie and session rules, data, rules, failure cases, permissions, UI; removed the literal seed password (`C-04`, `C-05`, `C-15`). |
