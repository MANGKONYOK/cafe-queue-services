# Feature Specification & Contract
**Feature Name:** Customer Post-Service Tasting Rating & Review  
**Feature ID:** `F-07`  
**Owning Requirements:** `FR-10`, `BR-06`, `BR-08`  
**Dependencies:** `F-01` (auth & roles), `F-02` (customer tickets), `F-03` (`COMPLETED` ticket status). New migration `006_ticket_feedback.sql`.  
**Delivery Schedule Note:** *Targeted for implementation and verification in Deliverable 2 (Issue `#26`, Part C Sprint 3 working progress).*  
**Contract Version:** 1.0 (see section 9)

---

## 1. Feature Overview & User Workflows

Feature `F-07` closes the Omkoi Station service loop by allowing the guest who owns a `COMPLETED` ticket to submit a single 1-to-5 star tasting rating and optional review note (`BR-08`).

### 1.1 Customer Rating Workflow (`/queue`)
1. On `/queue` under **Earlier tickets**, any `COMPLETED` ticket without existing feedback displays an inline **"Rate your tasting"** card (1–5 star selector + optional `comment` input up to 500 chars).
2. Submitting calls `POST /api/tickets/:id/feedback`. On `201 Created`, the form immediately transitions to a read-only star rating & tasting note display.
3. Tickets in `WAITING`, `CALLED`, `SERVING`, `CANCELLED`, or `NO_SHOW` do not show the rating form.

### 1.2 Staff & Admin Read Visibility (`/staff`)
1. When inspecting completed tickets on `/staff`, any submitted tasting rating and comment are shown read-only (via `ticket.feedback` or `GET /api/tickets/:id/feedback`). Staff and Admin cannot submit or modify customer feedback.

---

## 2. API & Data Contract

### 2.1 API Endpoints
Checks run in Sprint 1 order: `401` session → `403` role/ownership/counter scope → `404` → `400` body → `409` rule. Consistent with `BR-06`, a `CUSTOMER` receives `403 FORBIDDEN` for foreign or missing ticket IDs.

- `POST /api/tickets/:id/feedback`
  - **Roles:** Owner `CUSTOMER` only (`STAFF`, `ADMIN`, and non-owner `CUSTOMER` receive `403 FORBIDDEN`)
  - **Request Body:** `{ "rating": 5, "comment": "Crisp bergamot finish on the Mae Tuen Gesha V60." }` (`comment` optional)
  - **Success `201 Created`:**
    ```json
    {
      "feedback": {
        "id": 1,
        "ticketId": 4,
        "customerId": 4,
        "rating": 5,
        "comment": "Crisp bergamot finish on the Mae Tuen Gesha V60.",
        "createdAt": "2026-11-26T09:15:00.000Z"
      }
    }
    ```
  - **Errors:**
    - `400 VALIDATION_ERROR` (`rating` not an integer `1..5`, or trimmed `comment` > `500` chars)
    - `401 UNAUTHENTICATED`
    - `403 FORBIDDEN` (`STAFF`, `ADMIN`, or foreign/missing ticket for `CUSTOMER`)
    - `409 INVALID_STATE_TRANSITION` (ticket status is not `COMPLETED`)
    - `409 DUPLICATE_FEEDBACK` (feedback already exists for `:id`)

- `GET /api/tickets/:id/feedback`
  - **Roles:** Owner `CUSTOMER`, assigned-counter `STAFF`, `ADMIN`
  - **Success `200 OK`:** `{ "feedback": { "id": 1, "ticketId": 4, "customerId": 4, "rating": 5, "comment": "...", "createdAt": "..." } }` or `{ "feedback": null }` if none submitted yet.
  - **Errors:** `400 VALIDATION_ERROR` (non-INT4 `:id`), `401 UNAUTHENTICATED`, `403 FORBIDDEN`, `404 NOT_FOUND` (`STAFF`/`ADMIN` only)

- **Ticket Response Addition (`toTicket`):**
  - Additive nullable field `feedback: { rating: number; comment: string | null; createdAt: string } | null` on ticket objects returned by `GET /api/tickets/my`, `GET /api/tickets`, and `GET /api/tickets/:id`.

### 2.2 Data Contract (`server/db/migrations/006_ticket_feedback.sql`)
- **`ticket_feedback` Table:**
  ```sql
  CREATE TABLE ticket_feedback (
    id          SERIAL PRIMARY KEY,
    ticket_id   INTEGER     NOT NULL UNIQUE REFERENCES queue_tickets (id) ON DELETE CASCADE,
    customer_id INTEGER     NOT NULL REFERENCES users (id),
    rating      INTEGER     NOT NULL CHECK (rating BETWEEN 1 AND 5),
    comment     VARCHAR(500),
    created_at  TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
  ```
- **Single-Submission Concurrency Backstop (`BR-08`):** `UNIQUE (ticket_id)` guarantees at most one rating row per ticket even under parallel `POST /feedback` requests; PostgreSQL error code `23505` maps cleanly to `409 DUPLICATE_FEEDBACK`.

---

## 3. Business Rules & Validation (`BR-08`)
- `rating`: required integer between `1` and `5` inclusive.
- `comment`: optional trimmed string, at most `500` characters (blank/empty after trim is stored as `null`).
- **Owner-Only Customer Rule:** Only the `CUSTOMER` whose `customer_id === req.user.id` may submit feedback (`STAFF` and `ADMIN` are rejected with `403 FORBIDDEN`).
- **Completed-Only Gate (`BR-08`):** Tickets in `WAITING`, `CALLED`, `SERVING`, `NO_SHOW`, or `CANCELLED` return `409 INVALID_STATE_TRANSITION`.
- **Single Submission (`BR-08`):** Once rated, no edits or second submissions are accepted; a repeat `POST` returns `409 DUPLICATE_FEEDBACK`.

---

## 4. Failure & Boundary Cases

| Case | Result |
| :--- | :--- |
| `rating` is `0`, `6`, `-1`, `4.5`, or `"5"` | `400 VALIDATION_ERROR`, nothing stored |
| `rating` is `1` or `5`; `comment` is `500` chars or omitted | `201 Created` |
| `comment` is `501` chars | `400 VALIDATION_ERROR`, nothing stored |
| Ticket status is `WAITING`, `CALLED`, `SERVING`, `NO_SHOW`, or `CANCELLED` | `409 INVALID_STATE_TRANSITION`, nothing stored |
| Second `POST /feedback` on already-rated `COMPLETED` ticket (or 2 concurrent requests) | Second returns `409 DUPLICATE_FEEDBACK`, only 1 row exists |
| Other `CUSTOMER` calls `POST` or `GET /feedback` | `403 FORBIDDEN` (`BR-06`) |
| `STAFF` or `ADMIN` calls `POST /feedback` | `403 FORBIDDEN` |
| Unassigned `STAFF` calls `GET /feedback` | `403 FORBIDDEN` (`BR-09`) |
| Unauthenticated call | `401 UNAUTHENTICATED` |

---

## 5. Permissions

| Operation | `CUSTOMER` (Owner) | `CUSTOMER` (Other) | `STAFF` (Assigned) | `STAFF` (Unassigned) | `ADMIN` |
| :--- | :---: | :---: | :---: | :---: | :---: |
| `POST /api/tickets/:id/feedback` | `COMPLETED` (once) | `403` | `403` | `403` | `403` |
| `GET /api/tickets/:id/feedback` | Allowed | `403` | Allowed | `403` | Allowed |

Unauthenticated requests receive `401`.

---

## 6. UI Specification
- **Customer Portal (`/queue` -> Earlier tickets):**
  - Unrated `COMPLETED` ticket shows a compact 1–5 star selector, optional comment textarea (500-char counter), and **Submit rating** button (disabled while pending).
  - Rated `COMPLETED` ticket renders the submitted stars, comment, and timestamp read-only.
  - Inline validation error if rating is unselected or comment exceeds 500 chars; server `409` displays in an alert banner and refreshes the ticket.
- **Staff Console (`/staff`):**
  - Displays submitted star rating + tasting note on `COMPLETED` tickets when filtered to `COMPLETED` or all statuses.
- **Responsive (`NFR-05`):** Zero horizontal overflow at `375px`, `768px`, and `1280px`.

---

## 7. Acceptance Criteria (`AC-xx` - Given-When-Then)

### `AC-28` (Customer Submits Post-Service Tasting Rating `FR-10`, `BR-08` - Positive)
- **Given** `boom@omkoi.coffee` owns a `COMPLETED` ticket `SB-001` with no existing feedback,
- **When** the customer submits `POST /api/tickets/:id/feedback` with `rating: 5` and `comment: "Clean floral finish"`, then queries `GET /api/tickets/:id/feedback` and `GET /api/tickets/my`,
- **Then** `POST` returns `201 Created`, the rating persists in `ticket_feedback`, `GET /feedback` returns the saved record, and `ticket.feedback` appears on `/api/tickets/my`.

### `AC-29` (Single-Submission, Completed-State & Boundary Rules `BR-08` - Boundary & Negative)
- **Given** `boom@omkoi.coffee` holds a `WAITING` ticket, a `CANCELLED` ticket, and an already-rated `COMPLETED` ticket,
- **When** the customer submits feedback on the `WAITING` or `CANCELLED` ticket, submits a second rating on the already-rated `COMPLETED` ticket, submits invalid values (`rating` `0`, `6`, `3.5`; `comment` `501` chars), and also submits boundary valid values (`rating: 1`, `comment` `500` chars) on a fresh `COMPLETED` ticket,
- **Then** non-`COMPLETED` returns `409 INVALID_STATE_TRANSITION`, duplicate returns `409 DUPLICATE_FEEDBACK`, invalid inputs return `400 VALIDATION_ERROR`, and valid boundaries return `201 Created`.

### `AC-30` (Ownership & Role Enforcement on Feedback `BR-06`, `BR-08`, `BR-09` - Security Negative)
- **Given** `hongtae@omkoi.coffee` owns a `COMPLETED` ticket in `DESSERT_LOUNGE`,
- **When** `boom@omkoi.coffee` calls `GET` or `POST /feedback`, `dessert@omkoi.coffee` or `admin@omkoi.coffee` calls `POST /feedback`, and `barista@omkoi.coffee` (unassigned to `DL`) calls `GET /feedback`,
- **Then** every unauthorized call returns `403 FORBIDDEN` and `ticket_feedback` remains unchanged.

---

## 8. Verification
| AC | Tests (see `sts-and-dod.md`) |
| :--- | :--- |
| `AC-28` | `TEST-34`, `TEST-36` |
| `AC-29` | `TEST-35` |
| `AC-30` | `TEST-35` |

---

## 9. Version History
| Version | Date | Commit | Author | Change |
| :--- | :--- | :--- | :--- | :--- |
| 1.0 | 2026-11-23 | issue #23 (F-07 contract, before code) | @MANGKONYOK | Initial Sprint 3 contract for customer tasting feedback (`FR-10`, `BR-08`, `006_ticket_feedback.sql`, `AC-28`–`AC-30`, `TEST-34`–`TEST-36`), targeted for Deliverable 2 Part C implementation. |
