# Feature Specification & Contract
**Feature Name:** Customer Walk-In Queue Joining & Tracking  
**Feature ID:** `F-02`  
**Owning Requirements:** `FR-03`, `FR-04`, `FR-05`, `BR-01`, `BR-02`, `BR-03`, `BR-05`, `BR-06`, `BR-07`, `BR-09`, `NFR-03`, `NFR-05`, `NFR-06`  
**Dependencies:** `F-01` (session, roles, categories). Needs migration `002_queue_tickets`.  
**Contract Version:** 1.1 (see section 9)  

---

## 1. Feature Overview & User Workflows

Feature `F-02` delivers the customer-facing core of Omkoi Station, enabling walk-in guests to join specialty service queues, track their queue progress in real-time and manage their waiting tickets.

### 1.1 Walk-In Queue Joining Workflow
1. An authenticated customer views available Omkoi service categories on the `/queue` screen.
2. The customer selects an active category (e.g., `SLOW_BAR`), inputs their party size (`1-8`) and optionally enters special requests (e.g., *"Mae Tuen Washed, Origami drip, medium grind"*).
3. The customer clicks **"Join Omkoi Queue"**.
4. The server checks the role (`CUSTOMER` only, `BR-09`) and validates input bounds (`BR-03`).
5. In one transaction the server runs `UPDATE service_categories SET next_seq = next_seq + 1 WHERE id = $1 AND is_open RETURNING next_seq - 1`, which locks the category row (concurrent joins to the same counter wait), rejects a paused category (`BR-02`) and yields `seq_no`. It then checks that the customer has no active ticket in that category (`BR-01`, backed by the `one_active_ticket` unique index), generates the ticket code (e.g., `SB-001`), creates a `queue_tickets` row in `WAITING` status and logs a `null -> WAITING` event in `ticket_events`. Any failure rolls back the whole transaction, so no number is consumed by a rejected join.
6. The client displays the active ticket card showing code, status and tickets waiting ahead (`aheadCount`).

### 1.2 Queue Tracking & Self-Cancellation Workflow
1. The customer monitors their ticket on `/queue` or views historical tickets via `GET /api/tickets/my`.
2. The server dynamically calculates `aheadCount`:
   ```sql
   SELECT COUNT(*) FROM queue_tickets
   WHERE category_id = $1 AND status = 'WAITING' AND seq_no < $2;
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
    - `403 Forbidden`: `FORBIDDEN` (caller is `STAFF` or `ADMIN`, `BR-09`)
    - `404 Not Found`: `NOT_FOUND` (unknown `categoryId`)
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

### 2.2 Data Contract
- **New tables (migration `002_queue_tickets`):** `queue_tickets` (`id`, `ticket_code` unique, `category_id` FK, `customer_id` FK, `assigned_staff_id` FK nullable, `seq_no` with `UNIQUE (category_id, seq_no)`, `party_size` check 1-8, `special_requests` varchar(280), `status` check, `counter_name`, `completion_summary`, `cancel_reason`, `no_show_note`, `created_at`, `called_at`, `serving_started_at`, `completed_at`, `cancelled_at`, `no_show_at`); partial unique index `one_active_ticket (customer_id, category_id) WHERE status IN ('WAITING','CALLED','SERVING')`; `ticket_events` (`id`, `ticket_id` FK cascade, `actor_id` FK, `from_status`, `to_status`, `note`, `created_at`).
- **Changed tables:** `service_categories.next_seq` is now written by the join transaction (no schema change).
- **Ownership:** `queue_tickets.customer_id` is always the session user; it is never taken from the request body.

---

## 3. Business Rules & Validation
- Only `CUSTOMER` creates tickets (`BR-09`); the ticket owner is the session user.
- `categoryId`: positive integer of an existing category. `partySize`: integer 1-8 (`2.5` or `"2"` rejected). `specialRequests`: optional, at most 280 characters after trimming (`BR-03`).
- The category must be open (`BR-02`); the customer must have no `WAITING`/`CALLED`/`SERVING` ticket in it (`BR-01`); both hold under concurrent requests (`NFR-06`).
- Codes are `<PREFIX>-<NNN>` from `next_seq`, never reset or reused; after `999` they grow to four digits (`BR-07`).
- Self-cancel: owner only (`BR-06`), status `WAITING` only, `cancelReason` 3-200 characters after trimming (`BR-05`).
- `aheadCount` = `WAITING` tickets in the same category with a lower `seq_no`; shown only while `WAITING`.

## 4. Failure & Boundary Cases
| Case | Result |
| :--- | :--- |
| `partySize` 0, 9, `-1`, `2.5`, `"2"`; `specialRequests` 281 characters | `400 VALIDATION_ERROR` with the failing field in `details` |
| `partySize` 1 and 8; `specialRequests` exactly 280 characters | `201 Created` |
| Join while holding an active ticket in the same category | `409 DUPLICATE_ACTIVE_TICKET`, nothing stored |
| Join again after that ticket is `CANCELLED` or `COMPLETED` | `201 Created` with the next code |
| Join a paused category | `409 CATEGORY_CLOSED`, no number consumed |
| Unknown `categoryId` | `404 NOT_FOUND` |
| 20 parallel joins by one customer / 10 customers in parallel | 1 ticket stored / 10 distinct consecutive codes |
| Cancel with `""`, `"   "` or `"ab"` | `400 VALIDATION_ERROR` |
| Customer cancels own `CALLED`/`SERVING` ticket | `409 INVALID_STATE_TRANSITION` |
| Customer reads or cancels another customer's ticket (or a missing id) | `403 FORBIDDEN`, no ticket fields returned |

## 5. Permissions
| Operation | `CUSTOMER` | `STAFF` | `ADMIN` |
| :--- | :---: | :---: | :---: |
| `POST /api/tickets` | Allowed | `403` | `403` |
| `GET /api/tickets/my` | Own tickets | Own tickets (none) | Own tickets (none) |
| `GET /api/tickets/:id` | Own ticket only | Assigned counters (`F-03`) | All |
| `POST /api/tickets/:id/cancel` | Own ticket, `WAITING` only | Assigned counters (`F-03`) | All |

Unauthenticated requests receive `401` on every endpoint above.

## 6. UI Specification
- **`/queue`:** category cards from `F-01`; a paused card shows `PAUSED` and disables **Join**. The join form has `partySize` (1-8) and an optional request with a 280-character counter; **Join Omkoi Queue** is disabled while pending.
- **My tickets:** each active ticket shows code, counter, status badge and `aheadCount`; finished tickets are listed below. Empty state: "No active tickets - join a counter below".
- **Cancel dialog:** reason field (3-200 characters), shown only for `WAITING` tickets.
- **Errors:** `409` and `400` show the server message in a banner or under the field; the list refreshes every 10 seconds and after each action.

---

## 7. Acceptance Criteria (`AC-xx` - Given-When-Then)

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
- **When** `partySize` is `0`, `9`, negative, `2.5` or the string `"2"`, or `specialRequests` is `281` characters long,
- **Then** the server rejects the request with HTTP `400 Bad Request` (`VALIDATION_ERROR`) and stores nothing; with `partySize` `1` or `8` and `specialRequests` of exactly `280` characters the server responds `201 Created`.

### `AC-08` (Customer Self-Cancellation with Reason - Positive & Boundary)
- **Given** a customer who owns a ticket in `WAITING` status,
- **When** they call `POST /api/tickets/:id/cancel` with a valid `cancelReason`,
- **Then** the server updates status to `CANCELLED` and responds `200 OK`; but if `cancelReason` is blank or missing, the server responds `400 Bad Request` (`BR-05`), and if the customer's own ticket is already `CALLED` the server responds `409 Conflict` (`BR-06`).

### `AC-09` (Customer Ownership & RBAC Restriction `BR-06` - Security Negative)
- **Given** customer `boom@omkoi.coffee` is authenticated,
- **When** they attempt to read or cancel `hongtae@omkoi.coffee`'s ticket or attempt to access `GET /api/tickets`,
- **Then** the server rejects every attempt with HTTP `403 Forbidden` (`FORBIDDEN`).

### `AC-16` (Concurrent Joins Keep Numbering & Duplicates Safe `NFR-06` - Boundary)
- **Given** an open `ESPRESSO_BAR` with no tickets and an open `SLOW_BAR` where `boom@omkoi.coffee` holds no active ticket,
- **When** `boom@omkoi.coffee` sends 20 parallel `POST /api/tickets` for `SLOW_BAR`, and 10 different customers send parallel joins for `ESPRESSO_BAR`,
- **Then** exactly one `SLOW_BAR` join returns `201 Created` and the other 19 return `409 Conflict` (`DUPLICATE_ACTIVE_TICKET`) with one row stored, and the 10 `ESPRESSO_BAR` tickets receive 10 distinct consecutive codes (`EB-001` to `EB-010`).

---

## 8. Verification
| AC | Tests (see `sts-and-dod.md`) |
| :--- | :--- |
| `AC-04` | `TEST-04`, `TEST-13`, `TEST-19` |
| `AC-05` | `TEST-05` |
| `AC-06` | `TEST-06` |
| `AC-07` | `TEST-07` |
| `AC-08` | `TEST-08` |
| `AC-09` | `TEST-09` |
| `AC-16` | `TEST-18` |

---

## 9. Version History
| Version | Date | Commit | Author | Change |
| :--- | :--- | :--- | :--- | :--- |
| 1.0 | 2026-11-09 | `a9c7a02` | @MANGKONYOK | First contract: join, track, self-cancel; `AC-04`-`AC-09`. |
| 1.1 | 2026-11-14 | PR #4 review commit | @kmood-Sakura | Join transaction with category row lock and unique index, `seq_no` ordering, customer-only join, accepted boundaries and `CALLED` cancel in `AC-07`/`AC-08`, `AC-16` concurrency, data, rules, failure cases, permissions, UI (`C-03`, `C-05`, `C-08`, `C-09`). |
