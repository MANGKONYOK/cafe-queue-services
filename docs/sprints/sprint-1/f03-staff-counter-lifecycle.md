# Feature Specification & Contract
**Feature Name:** Staff Counter Console & Service Lifecycle Execution  
**Feature ID:** `F-03`  
**Owning Requirements:** `FR-06`, `FR-07`, `BR-04`, `BR-05`, `BR-06`, `NFR-03`, `NFR-05`  

---

## 1. Feature Overview & User Workflows

Feature `F-03` delivers the barista and station operator console, providing full control over queue flow, counter calling, brewing lifecycle execution and no-show/cancellation handling under strict state machine rules.

### 1.1 Queue Monitoring & Calling Workflow
1. A barista (`STAFF` or `ADMIN`) navigates to `/staff`.
2. The client fetches `GET /api/tickets` (ordered FIFO by `created_at ASC`).
3. The barista filters by category (e.g., `SLOW_BAR`) or status (`ACTIVE`, `WAITING`, `CALLED`, etc.).
4. The barista clicks **"Call Next Ticket"** on a `WAITING` ticket.
5. The client submits `POST /api/tickets/:id/call` with an optional station identifier (e.g., `"Slow Bar 1"`).
6. The server validates that the ticket is in `WAITING` status (`BR-04`), updates status to `CALLED`, sets `called_at = CURRENT_TIMESTAMP`, sets `counter_name`, assigns `assigned_staff_id = req.user.id` and logs an event.

### 1.2 Service Start & Completion Workflow
1. When the guest arrives at the counter, the barista clicks **"Start Serving"**.
2. The server calls `POST /api/tickets/:id/serve`, transitioning status to `SERVING` and setting `serving_started_at`.
3. After brewing the coffee / serving pastries, the barista clicks **"Complete Service"**.
4. A modal requires a non-empty `completionSummary` (5-500 characters, e.g., *"Served 2x V60 Mae Tuen Washed + Honey Toast"*).
5. The server calls `POST /api/tickets/:id/complete`. Upon validation (`BR-05`), status becomes `COMPLETED`, `completed_at` is timestamped and the ticket enters its final terminal state.

### 1.3 No-Show & Exception Workflow
1. If a called customer does not appear, the barista clicks **"Mark No-Show"**.
2. A modal requires a mandatory `noShowNote` (3-200 characters, e.g., *"Announced 3x at Slow Bar; guest not present"*).
3. The server calls `POST /api/tickets/:id/no-show`, sets status to `NO_SHOW` and records `no_show_at`.

---

## 2. State Transition Matrix & API Contract

| Current Status | Target Status | Endpoint | Permitted Roles | Required Payload | Business Rules Enforced |
| :--- | :--- | :--- | :---: | :--- | :--- |
| `WAITING` | `CALLED` | `POST /api/tickets/:id/call` | `STAFF`, `ADMIN` | `{"counterName":"Slow Bar 1"}` (optional) | `BR-04` (must be `WAITING`) |
| `WAITING` | `CANCELLED` | `POST /api/tickets/:id/cancel` | `STAFF`, `ADMIN` | `{"cancelReason":"Guest left"}` (required) | `BR-05` (3-200 chars) |
| `CALLED` | `SERVING` | `POST /api/tickets/:id/serve` | `STAFF`, `ADMIN` | None / optional `counterName` | `BR-04` (must be `CALLED`) |
| `CALLED` | `NO_SHOW` | `POST /api/tickets/:id/no-show` | `STAFF`, `ADMIN` | `{"noShowNote":"Guest absent"}` (required) | `BR-04`, `BR-05` (3-200 chars) |
| `CALLED` | `CANCELLED` | `POST /api/tickets/:id/cancel` | `STAFF`, `ADMIN` | `{"cancelReason":"Counter issue"}` (required) | `BR-04`, `BR-05` |
| `SERVING` | `COMPLETED` | `POST /api/tickets/:id/complete` | `STAFF`, `ADMIN` | `{"completionSummary":"Served..."}` (required) | `BR-04`, `BR-05` (5-500 chars) |
| `COMPLETED` / `NO_SHOW` / `CANCELLED` | *Any* | *All transition endpoints* | *None* | N/A | `BR-04` (Terminal states reject all transitions with `409 Conflict`) |

---

## 3. Acceptance Criteria (`AC-xx` - Given-When-Then)

### `AC-10` (Staff Full Happy-Path Lifecycle - Positive)
- **Given** an authenticated barista (`STAFF`) and a ticket in `WAITING` status,
- **When** the staff sequentially calls `/call`, then `/serve` and finally `/complete` with `{ "completionSummary": "Served 2x V60 Mae Tuen Washed" }`,
- **Then** each step responds `200 OK`, transitions status correctly (`CALLED -> SERVING -> COMPLETED`), sets all corresponding timestamps, populates `assigned_staff_id` and logs 3 transition rows in `ticket_events`.

### `AC-11` (Illegal State Jump & Blank Summary Rejection - Negative)
- **Given** an authenticated staff member,
- **When** they attempt to transition a `WAITING` ticket directly to `SERVING` or `COMPLETED` (skipping `CALLED`) or attempt to complete a `SERVING` ticket with a blank completion summary (`""`),
- **Then** the illegal jump responds with HTTP `409 Conflict` (`INVALID_STATE_TRANSITION`) and the blank summary responds with HTTP `400 Bad Request` (`VALIDATION_ERROR`).

### `AC-12` (Staff Marks CALLED Ticket as NO_SHOW With Mandatory Note - Positive & Boundary)
- **Given** an authenticated staff member and a ticket in `CALLED` status,
- **When** the staff submits `POST /api/tickets/:id/no-show` with `{ "noShowNote": "Called 3 times over 5 mins; guest absent" }`,
- **Then** the server updates status to `NO_SHOW`, sets `no_show_at` and responds `200 OK`; but if `noShowNote` is missing or the ticket is still `WAITING`, the server responds `400 Bad Request` or `409 Conflict` respectively.