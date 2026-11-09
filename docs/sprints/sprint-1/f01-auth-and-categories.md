# Feature Specification & Contract
**Feature Name:** Authentication, Sessions & Service Counter Directory  
**Feature ID:** `F-01`  
**Owning Requirements:** `FR-01`, `FR-02`, `BR-02`, `NFR-01`, `NFR-02`, `NFR-03`, `NFR-04`  

---

## 1. Feature Overview & User Workflows

Feature `F-01` establishes the foundational security, identity and service discovery capabilities of Omkoi Station.

### 1.1 User Login & Session Retrieval Workflow
1. The user navigates to `/login` and enters their email and password.
2. The client submits `POST /api/auth/login`.
3. The server queries the `users` table, verifies the submitted password against the stored salted `bcrypt` hash, issues an HTTP-only session cookie signed by `SESSION_SECRET` and saves session data to PostgreSQL (`user_sessions`).
4. On subsequent page loads, the frontend calls `GET /api/auth/me` with `credentials: 'include'`. The server validates the session and returns `{ id, email, fullName, role }`.
5. When the user logs out, `POST /api/auth/logout` destroys the session in PostgreSQL and clears the browser cookie.

### 1.2 Service Counter Directory Workflow
1. Authenticated users (`CUSTOMER`, `STAFF` or `ADMIN`) request `GET /api/categories`.
2. The server queries `service_categories` and returns an array of categories (`SLOW_BAR`, `ESPRESSO_BAR`, `DESSERT_LOUNGE`, `ROASTERY_CONSULT`) containing their code, name, description, prefix, estimated duration and `is_open` status.
3. The client renders the categories with visual indicators (`OPEN` in amber/green vs. `PAUSED` in muted gray) to guide queue selection.

---

## 2. API & Data Contract

### 2.1 API Endpoints
- `POST /api/auth/login`
  - Body: `{ "email": "boom@omkoi.coffee", "password": "GuestOmkoi123!" }`
  - Success `200 OK`: `{ "user": { "id": 3, "email": "boom@omkoi.coffee", "fullName": "Boom", "role": "CUSTOMER" } }`
  - Error `400 Bad Request`: `{ "error": { "code": "VALIDATION_ERROR", "message": "Email and password are required." } }`
  - Error `401 Unauthorized`: `{ "error": { "code": "INVALID_CREDENTIALS", "message": "Invalid email or password." } }`
- `GET /api/auth/me`
  - Headers: Cookie `connect.sid=...`
  - Success `200 OK`: `{ "user": { "id": 3, "email": "boom@omkoi.coffee", "fullName": "Boom", "role": "CUSTOMER" } }`
  - Error `401 Unauthorized`: `{ "error": { "code": "UNAUTHORIZED", "message": "Authentication required." } }`
- `POST /api/auth/logout`
  - Success `200 OK`: `{ "status": "logged_out" }`
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

---

## 3. Acceptance Criteria (`AC-xx` - Given-When-Then)

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