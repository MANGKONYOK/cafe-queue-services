# Feature Specification & Contract
**Feature Name:** Immutable Ticket Audit Trail & Barista Recall Tracking  
**Feature ID:** `F-06`  
**Owning Requirements:** `FR-09`, `BR-04`, `BR-05`, `BR-06`, `BR-09`, `BR-14`  
**Dependencies:** `F-01` (auth & roles), `F-02` (`ticket_events` written from Sprint 1), `F-03` (staff counter lifecycle). New migration `005_ticket_recall.sql`.  
**Contract Version:** 1.0 (see section 9)

---

## 1. Feature Overview & User Workflows

Every ticket transition since Sprint 1 already writes an append-only row into `ticket_events`, and `F-06` promotes this into two complete user-facing capabilities:
1. **Immutable Ticket Audit Trail (`FR-09`):** Customers (for their own tickets) and counter-authorized baristas/admins can fetch `GET /api/tickets/:id/events` with actor names and roles to inspect the exact chronological history (`WAITING -> CALLED -> SERVING -> COMPLETED / NO_SHOW / CANCELLED`, plus recall entries) on `/queue` and `/staff`.
2. **Barista Recall Tracking (`BR-14`):** When a `CALLED` guest has not yet stepped up to the counter, assigned `STAFF` or `ADMIN` can press **Recall guest** (`POST /api/tickets/:id/recall`) rather than immediately marking `NO_SHOW`. Each recall increments `recallCount`, updates `lastRecalledAt`, and records an immutable `CALLED -> CALLED` audit row.

---

## 2. API & Data Contract

### 2.1 API Endpoints
Checks run in Sprint 1 order: `401` session → `403` role/ownership/counter scope → `404` → `400` → `409`. A `CUSTOMER` receives `403 FORBIDDEN` for foreign and non-existent ticket IDs alike.

- `GET /api/tickets/:id/events`
  - **Roles:** Owner `CUSTOMER`, assigned-counter `STAFF`, `ADMIN`
  - **Success `200 OK`:** Events ordered chronologically (`id ASC`):
    ```json
    {
      "events": [
        {
          "id": 1,
          "ticketId": 4,
          "fromStatus": null,
          "toStatus": "WAITING",
          "note": "Joined queue",
          "actorId": 4,
          "actorName": "Boom",
          "actorRole": "CUSTOMER",
          "createdAt": "2026-11-24T04:00:00.000Z"
        },
        {
          "id": 2,
          "ticketId": 4,
          "fromStatus": "WAITING",
          "toStatus": "CALLED",
          "note": "Slow Bar 1",
          "actorId": 2,
          "actorName": "Khun Noble",
          "actorRole": "STAFF",
          "createdAt": "2026-11-24T04:05:00.000Z"
        }
      ]
    }
    ```
  - *(Note: existing `GET /api/tickets/:id` continues returning `{ ticket, events }` for backward compatibility.)*
  - **Errors:** `400 VALIDATION_ERROR` (non-INT4 `:id`), `401 UNAUTHENTICATED`, `403 FORBIDDEN`, `404 NOT_FOUND` (`STAFF`/`ADMIN` only)

- `POST /api/tickets/:id/recall`
  - **Roles:** Assigned-counter `STAFF`, `ADMIN` (`CUSTOMER` and unassigned `STAFF` → `403 FORBIDDEN`)
  - **Request Body:** `{ "note": "Called second time at Slow Bar 1" }` (`note` optional; blank or omitted defaults to `"Customer re-called at counter"`; trimmed length `<= 200` chars)
  - **Success `200 OK`:**
    ```json
    {
      "ticket": {
        "id": 4,
        "ticketCode": "SB-001",
        "status": "CALLED",
        "recallCount": 1,
        "lastRecalledAt": "2026-11-24T04:07:30.000Z"
      },
      "event": {
        "id": 3,
        "ticketId": 4,
        "fromStatus": "CALLED",
        "toStatus": "CALLED",
        "note": "Called second time at Slow Bar 1",
        "actorId": 2,
        "actorName": "Khun Noble",
        "actorRole": "STAFF",
        "createdAt": "2026-11-24T04:07:30.000Z"
      }
    }
    ```
  - **Errors:** `400 VALIDATION_ERROR` (`note > 200` chars), `401 UNAUTHENTICATED`, `403 FORBIDDEN`, `404 NOT_FOUND`, `409 INVALID_STATE_TRANSITION` (ticket status is not `CALLED`)

- **Ticket Response Addition (`toTicket`):**
  - Additive fields `recallCount` (`INTEGER >= 0`, default `0`) and `lastRecalledAt` (`string | null`) included on every returned ticket.

### 2.2 Data Contract (`server/db/migrations/005_ticket_recall.sql`)
- Additive migration on `queue_tickets`:
  ```sql
  ALTER TABLE queue_tickets
    ADD COLUMN recall_count     INTEGER NOT NULL DEFAULT 0 CHECK (recall_count >= 0),
    ADD COLUMN last_recalled_at TIMESTAMPTZ;
  ```
- Reuses `ticket_events` from `002_queue_tickets.sql`. No `UPDATE` or `DELETE` endpoint exists for `ticket_events` (append-only immutability).
- Inside `recallTicket` transaction: executes conditional `UPDATE queue_tickets SET recall_count = recall_count + 1, last_recalled_at = CURRENT_TIMESTAMP WHERE id = $1 AND status = 'CALLED' RETURNING ...`; zero rows triggers `409 INVALID_STATE_TRANSITION`; inserts the `CALLED -> CALLED` row into `ticket_events` in the same transaction.

---

## 3. Business Rules & Validation (`BR-14`)
- **Audit Immutability:** `ticket_events` rows are strictly append-only (`POST /recall` and lifecycle transitions only `INSERT`). Ordering is deterministic (`ORDER BY e.id ASC`).
- **Recall State Gate (`BR-14`):** Only a ticket in `CALLED` status can be recalled. Calling `/recall` on `WAITING`, `SERVING`, `COMPLETED`, `NO_SHOW`, or `CANCELLED` returns `409 INVALID_STATE_TRANSITION` without incrementing `recall_count` or logging an event.
- **Recall Note Validation:** `note` is optional; if supplied and non-blank after trimming, it must be `<= 200` characters. If omitted or whitespace-only, the server stores `"Customer re-called at counter"`.

---

## 4. Failure & Boundary Cases

| Case | Result |
| :--- | :--- |
| `POST /recall` on a `CALLED` ticket twice with default note then 200-char note | `200 OK` both times; `recallCount` becomes `1`, then `2`; 2 new events logged |
| `POST /recall` with `note` of `201` chars | `400 VALIDATION_ERROR`, `recallCount` unchanged |
| `POST /recall` on `WAITING`, `SERVING`, `COMPLETED`, `NO_SHOW`, or `CANCELLED` | `409 INVALID_STATE_TRANSITION`, `recallCount` unchanged |
| `CUSTOMER` calls `POST /api/tickets/:id/recall` (even on own ticket) | `403 FORBIDDEN` |
| Unassigned `STAFF` calls `GET /events` or `POST /recall` | `403 FORBIDDEN` (`BR-09`) |
| Foreign `CUSTOMER` calls `GET /api/tickets/:id/events` | `403 FORBIDDEN` (`BR-06`) |
| Unauthenticated call to `/events` or `/recall` | `401 UNAUTHENTICATED` |

---

## 5. Permissions

| Operation | `CUSTOMER` (Owner) | `CUSTOMER` (Other) | `STAFF` (Assigned) | `STAFF` (Unassigned) | `ADMIN` |
| :--- | :---: | :---: | :---: | :---: | :---: |
| `GET /api/tickets/:id/events` | Allowed | `403` | Allowed | `403` | Allowed |
| `POST /api/tickets/:id/recall` | `403` | `403` | Allowed (`CALLED`) | `403` | Allowed (`CALLED`) |

Unauthenticated requests receive `401`.

---

## 6. UI Specification
- **Staff Counter Console (`/staff`):**
  - On `CALLED` ticket cards, add a **Recall guest** button (with optional recall note input or quick default action) alongside **Start serving** and **No-show**.
  - When `recallCount > 0`, show a badge (e.g., `Recalled 2x`) and formatted `lastRecalledAt` timestamp.
  - Add an expandable **Audit History** drawer on each ticket card fetching `GET /api/tickets/:id/events` and displaying `fromStatus -> toStatus`, actor name/role, note, and timestamp.
- **Customer Queue Portal (`/queue`):**
  - When `recallCount > 0` on an active `CALLED` ticket, highlight a subtle notice (`Recalled Nx — please proceed to counter`).
  - Add an expandable **Audit History** toggle on active and earlier tickets calling `GET /api/tickets/:id/events`.
- **States:** Loading indicator while fetching events, button disabled while recall is pending, `409`/`400` banner messages, responsive at `375px`, `768px`, and `1280px` (`NFR-05`).

---

## 7. Acceptance Criteria (`AC-xx` - Given-When-Then)

### `AC-25` (Immutable Chronological Audit Trail `FR-09`, `BR-04` - Positive)
- **Given** ticket `SB-001` was created by `boom@omkoi.coffee`, called by `barista@omkoi.coffee`, served, and completed with a summary,
- **When** the owner customer and assigned barista each call `GET /api/tickets/:id/events`,
- **Then** both receive `200 OK` with events ordered chronologically (`null -> WAITING`, `WAITING -> CALLED`, `CALLED -> SERVING`, `SERVING -> COMPLETED`), including `actorId`, `actorName`, `actorRole`, `note`, and `createdAt`, matching all rows in `ticket_events`.

### `AC-26` (Barista Recall Tracking & State Gate `BR-14` - Positive, Boundary & Negative)
- **Given** `SB-001` is `CALLED` on `SLOW_BAR` and `EB-001` is `WAITING` on `ESPRESSO_BAR`,
- **When** `barista@omkoi.coffee` posts `POST /api/tickets/:id/recall` twice on `SB-001` (once with omitted body, once with a 200-char `note`), posts a 201-char `note`, and posts `/recall` on `EB-001` (`WAITING`),
- **Then** the two valid recalls return `200 OK`, set `recallCount` to `1` then `2`, set `lastRecalledAt`, and append `CALLED -> CALLED` rows in `ticket_events`; the 201-char note returns `400 VALIDATION_ERROR`; and recalling `EB-001` returns `409 INVALID_STATE_TRANSITION`.

### `AC-27` (Audit Trail & Recall Isolation `BR-06`, `BR-09` - Security Negative)
- **Given** `hongtae@omkoi.coffee` holds a `CALLED` ticket in `DESSERT_LOUNGE`,
- **When** `boom@omkoi.coffee` calls `GET /api/tickets/:id/events` or `POST /api/tickets/:id/recall`, `hongtae@` calls `POST /api/tickets/:id/recall`, and `barista@omkoi.coffee` (assigned only to `SB` & `EB`) calls `GET /events` or `POST /recall`,
- **Then** every unauthorized call returns `403 FORBIDDEN` and no recall counter or event row is added.

---

## 8. Verification
| AC | Tests (see `sts-and-dod.md`) |
| :--- | :--- |
| `AC-25` | `TEST-30`, `TEST-33` |
| `AC-26` | `TEST-31`, `TEST-33` |
| `AC-27` | `TEST-32` |

---

## 9. Version History
| Version | Date | Commit | Author | Change |
| :--- | :--- | :--- | :--- | :--- |
| 1.0 | 2026-11-23 | issue #23 (F-06 contract, before code) | @MANGKONYOK | Initial Sprint 2 contract for immutable audit trail read API and barista recall tracking (`FR-09`, `BR-14`, `005_ticket_recall.sql`, `AC-25`–`AC-27`, `TEST-30`–`TEST-33`). |
