# Feature Specification & Contract
**Feature Name:** Customer Walk-In Queue Joining & Tracking  
**Feature ID:** `F-02`  
**Owning Requirements:** `FR-03`, `FR-04`, `FR-05`, `BR-01`, `BR-02`, `BR-03`, `BR-05`, `BR-06`, `BR-07`, `NFR-03`, `NFR-05`  

---

## 1. Feature Overview & User Workflows

Feature `F-02` delivers the customer-facing core of Omkoi Station, enabling walk-in guests to join specialty service queues, track their queue progress in real-time and manage their waiting tickets.

### 1.1 Walk-In Queue Joining Workflow
1. An authenticated customer views available Omkoi service categories on the `/queue` screen.
2. The customer selects an active category (e.g., `SLOW_BAR`), inputs their party size (`1-8`) and optionally enters special requests (e.g., *"Mae Tuen Washed, Origami drip, medium grind"*).
3. The customer clicks **"Join Omkoi Queue"**.
4. The server validates input bounds (`BR-03`), verifies the category is open (`BR-02`) and checks that the customer has no active ticket in that category (`BR-01`).
5. The server increments `service_categories.next_seq`, generates the ticket code (e.g., `SB-001`), creates a `queue_tickets` row in `WAITING` status and logs an initial event in `ticket_events`.
6. The client displays the active ticket card showing code, status and tickets waiting ahead (`aheadCount`).

### 1.2 Queue Tracking & Self-Cancellation Workflow
1. The customer monitors their ticket on `/queue` or views historical tickets via `GET /api/tickets/my`.
2. The server dynamically calculates `aheadCount`:
   ```sql
   SELECT COUNT(*) FROM queue_tickets
   WHERE category_id = $1 AND status = 'WAITING' AND created_at < $2;
   ```
3. If the customer needs to leave while their ticket is still `WAITING`, they click **"Cancel Ticket"**.
4. A modal requires a non-empty `cancelReason` (3-200 characters). Upon submission, the server transitions the ticket to `CANCELLED`, records `cancelled_at` and `cancel_reason` and logs the event (`BR-05`).

---

## 2. API & Data Contract

### 2.1 API Endpoints
- `POST /api/tickets`
  - Body:
    ```json
    {
      "categoryId": 1,
      "partySize": 2,
      "specialRequests": "Omkoi Mae Tuen Washed Pour-Over"
    }
    ```
  - Success `201 Created`:
    ```json
    {
      "ticket": {
        "id": 10,
        "ticketCode": "SB-001",
        "categoryId": 1,
        "categoryName": "Omkoi Specialty Slow Bar (Pour-Over & Syphon)",
        "customerId": 3,
        "partySize": 2,
        "specialRequests": "Omkoi Mae Tuen Washed Pour-Over",
        "status": "WAITING",
        "createdAt": "2026-11-09T10:00:00Z",
        "aheadCount": 0
      }
    }
    ```
  - Errors:
    - `400 Bad Request`: `VALIDATION_ERROR` (e.g., `partySize` < 1 or > 8, `specialRequests` > 280 chars)
    - `401 Unauthorized`: `UNAUTHORIZED`
    - `409 Conflict`: `DUPLICATE_ACTIVE_TICKET` (holding an active ticket in this category)
    - `409 Conflict`: `CATEGORY_CLOSED` (category intake is paused / `isOpen = false`)
- `GET /api/tickets/my`
  - Success `200 OK`: `{ "tickets": [ ... ] }` (contains all tickets belonging to caller, each with dynamic `aheadCount`)
- `GET /api/tickets/:id`
  - Success `200 OK`: `{ "ticket": { ... }, "events": [ ... ] }`
  - Errors: `403 Forbidden` if caller is a `CUSTOMER` who does not own the ticket (`BR-06`)
- `POST /api/tickets/:id/cancel`
  - Body: `{ "cancelReason": "Need to catch highland minivan" }`
  - Success `200 OK`: `{ "ticket": { "id": 10, "status": "CANCELLED", "cancelReason": "...", "cancelledAt": "..." } }`
  - Errors:
    - `400 Bad Request`: Missing or blank `cancelReason` (`BR-05`)
    - `403 Forbidden`: Non-owner attempting to cancel (`BR-06`)
    - `409 Conflict`: Ticket is already `CALLED`, `SERVING` or terminal (`BR-04`, `BR-06`)

---

## 3. Acceptance Criteria (`AC-xx` - Given-When-Then)

### `AC-04` (Customer Joins Open Queue & Tracks Position - Positive)
- **Given** an authenticated customer who holds no active ticket in `SLOW_BAR` (`isOpen = true`),
- **When** the customer submits `POST /api/tickets` with `{ "categoryId": 1, "partySize": 2, "specialRequests": "Pour-Over" }`,
- **Then** the server responds `201 Created` with `status: "WAITING"`, sequential ticket code `SB-001` and `aheadCount: 0` and the ticket appears in `GET /api/tickets/my`.

### `AC-05` (Duplicate Active Ticket Invariant `BR-01` - Business Rule Negative)
- **Given** a customer who already holds a ticket in `WAITING`, `CALLED` or `SERVING` status for `SLOW_BAR`,
- **When** the customer attempts to submit `POST /api/tickets` for `SLOW_BAR` again,
- **Then** the server rejects the request with HTTP `409 Conflict` (`DUPLICATE_ACTIVE_TICKET`) and creates no new ticket.

### `AC-06` (Paused Category Intake Gate `BR-02` - Business Rule Negative)
- **Given** category `ROASTERY_CONSULT` has `isOpen = false`,
- **When** a customer attempts to submit `POST /api/tickets` targeting `ROASTERY_CONSULT`,
- **Then** the server rejects the request with HTTP `409 Conflict` (`CATEGORY_CLOSED`).

### `AC-07` (Party Size & Special Request Boundary Validation `BR-03` - Boundary Negative)
- **Given** an authenticated user submitting `POST /api/tickets`,
- **When** `partySize` is `0`, `9` or negative or `specialRequests` exceeds `280` characters,
- **Then** the server rejects the request with HTTP `400 Bad Request` (`VALIDATION_ERROR`).

### `AC-08` (Customer Self-Cancellation with Reason - Positive & Boundary)
- **Given** a customer who owns a ticket in `WAITING` status,
- **When** they call `POST /api/tickets/:id/cancel` with a valid `cancelReason`,
- **Then** the server updates status to `CANCELLED` and responds `200 OK`; but if `cancelReason` is blank or missing, the server responds `400 Bad Request` (`BR-05`).

### `AC-09` (Customer Ownership & RBAC Restriction `BR-06` - Security Negative)
- **Given** customer `boom@omkoi.coffee` is authenticated,
- **When** they attempt to read or cancel `hongtae@omkoi.coffee`'s ticket or attempt to access `GET /api/tickets`,
- **Then** the server rejects every attempt with HTTP `403 Forbidden` (`FORBIDDEN`).