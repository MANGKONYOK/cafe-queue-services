# Feature Specification & Contract
**Feature Name:** Staff Counter Console & Service Lifecycle Execution  
**Feature ID:** `F-03`  
**Owning Requirements:** `FR-06`, `FR-07`, `BR-04`, `BR-05`, `BR-06`, `BR-09`, `BR-10`, `NFR-03`, `NFR-05`, `NFR-06`  
**Dependencies:** `F-01` (session, roles), `F-02` (tickets). Needs migration `003_staff_counters` and the staff assignments in the seed.  
**Contract Version:** 1.1 (see section 9)  

---

## 1. Feature Overview & User Workflows

Feature `F-03` delivers the barista and station operator console, providing full control over queue flow, counter calling, brewing lifecycle execution and no-show/cancellation handling under strict state machine rules.

### 1.1 Queue Monitoring & Calling Workflow
1. A barista (`STAFF` or `ADMIN`) navigates to `/staff`, which shows one tab per counter assigned to them in `staff_counters` (`ADMIN`: every counter).
2. The client fetches `GET /api/tickets?categoryId=` for the open tab (ordered FIFO by `seq_no ASC`).
3. The barista filters by status (`ACTIVE`, `WAITING`, `CALLED`, etc.).
4. The barista clicks **"Call next"** for the counter; there is no per-ticket call button.
5. The client submits `POST /api/categories/:id/call-next` with an optional station identifier (e.g., `"Slow Bar 1"`).
6. The server checks the counter scope (`BR-09`), locks the oldest `WAITING` ticket of that category (`ORDER BY seq_no LIMIT 1 FOR UPDATE SKIP LOCKED`, `BR-10`), updates its status to `CALLED`, sets `called_at = CURRENT_TIMESTAMP`, sets `counter_name`, assigns `assigned_staff_id = req.user.id` and logs an event in the same transaction. With no `WAITING` ticket it returns `409 QUEUE_EMPTY`.

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
| `WAITING` (oldest of the counter) | `CALLED` | `POST /api/categories/:id/call-next` | `STAFF` (assigned), `ADMIN` | `{"counterName":"Slow Bar 1"}` (optional) | `BR-04`, `BR-09`, `BR-10` (server picks the oldest `WAITING`; `409 QUEUE_EMPTY` if none) |
| `WAITING` | `CANCELLED` | `POST /api/tickets/:id/cancel` | `STAFF` (assigned), `ADMIN` | `{"cancelReason":"Guest left"}` (required) | `BR-05` (3-200 chars) |
| `CALLED` | `SERVING` | `POST /api/tickets/:id/serve` | `STAFF` (assigned), `ADMIN` | None | `BR-04` (must be `CALLED`) |
| `CALLED` | `NO_SHOW` | `POST /api/tickets/:id/no-show` | `STAFF` (assigned), `ADMIN` | `{"noShowNote":"Guest absent"}` (required) | `BR-04`, `BR-05` (3-200 chars) |
| `CALLED` | `CANCELLED` | `POST /api/tickets/:id/cancel` | `STAFF` (assigned), `ADMIN` | `{"cancelReason":"Counter issue"}` (required) | `BR-04`, `BR-05` |
| `SERVING` | `COMPLETED` | `POST /api/tickets/:id/complete` | `STAFF` (assigned), `ADMIN` | `{"completionSummary":"Served..."}` (required) | `BR-04`, `BR-05` (5-500 chars) |
| `COMPLETED` / `NO_SHOW` / `CANCELLED` | *Any* | *All transition endpoints* | *None* | N/A | `BR-04` (Terminal states reject all transitions with `409 Conflict`) |

Every transition is a conditional `UPDATE ... WHERE id = $1 AND status = <expected>` plus one `ticket_events` row in the same transaction; zero updated rows returns `409 INVALID_STATE_TRANSITION`, so two staff acting on one ticket at once cannot both succeed.

### 2.1 Data Contract
- **New table (migration `003_staff_counters`):** `staff_counters` (`staff_id` FK users, `category_id` FK service_categories, `created_at`, primary key `(staff_id, category_id)`).
- **Seed:** `barista@omkoi.coffee` -> `SLOW_BAR`, `ESPRESSO_BAR`; `dessert@omkoi.coffee` -> `DESSERT_LOUNGE`; `ROASTERY_CONSULT` none (admin only).
- **Changed tables:** none; `queue_tickets` and `ticket_events` from `F-02` are written by the transitions.

---

## 3. Business Rules & Validation
- Legal transitions only (`BR-04`, table above); terminal tickets never change.
- `completionSummary` 5-500, `noShowNote` 3-200 and `cancelReason` 3-200 characters after trimming (`BR-05`); `counterName` optional, at most 50 characters.
- `STAFF` act only on categories assigned to them; `ADMIN` on all (`BR-09`). `CUSTOMER` receives `403` on every endpoint of this feature.
- Call-next always takes the oldest `WAITING` ticket; the client never chooses (`BR-10`).
- Check order: `401` -> `403` role -> `403` counter scope -> `404` -> `400` body -> `409` state.

## 4. Failure & Boundary Cases
| Case | Result |
| :--- | :--- |
| `serve`/`complete` on `WAITING`; any action on `COMPLETED`, `NO_SHOW`, `CANCELLED` | `409 INVALID_STATE_TRANSITION`, ticket unchanged |
| `no-show` on `WAITING` or `SERVING` | `409 INVALID_STATE_TRANSITION` |
| `completionSummary` `""` or 4 characters; 5 characters | `400`; `200` |
| `noShowNote` or `cancelReason` blank or 2 characters | `400 VALIDATION_ERROR` |
| Call-next on a counter with no `WAITING` ticket | `409 QUEUE_EMPTY` |
| Two parallel call-next requests on a counter with 2 waiting tickets | Two different tickets become `CALLED` |
| `STAFF` acting on an unassigned counter or its tickets | `403 FORBIDDEN`, nothing changes |
| Unknown ticket or category id | `404 NOT_FOUND` |

## 5. Permissions
| Operation | `CUSTOMER` | `STAFF` | `ADMIN` |
| :--- | :---: | :---: | :---: |
| `GET /api/tickets`, `GET /api/tickets/:id` (any ticket) | `403` (own ticket only via `F-02`) | Assigned counters | All |
| `POST /api/categories/:id/call-next` | `403` | Assigned counters | All |
| `serve`, `complete`, `no-show`, staff `cancel` | `403` | Assigned counters | All |

## 6. UI Specification
- **`/staff`:** one tab per assigned counter; each tab shows waiting count, **Call next** (disabled when no ticket is waiting), and the list oldest first with status badges.
- **Row actions:** `CALLED` -> **Start serving**, **No-show**, **Cancel**; `SERVING` -> **Complete**. Buttons are disabled while their request is pending.
- **Dialogs:** Complete (summary 5-500), No-show (note 3-200), Cancel (reason 3-200), each with a character counter and field error.
- **States:** loading skeleton; empty "No guests waiting"; `403`/`409` banners show the server message and refresh the list; the console refreshes every 10 seconds and after each action.

---

## 7. Acceptance Criteria (`AC-xx` - Given-When-Then)

### `AC-10` (Staff Full Happy-Path Lifecycle - Positive)
- **Given** an authenticated barista (`STAFF`) and a ticket in `WAITING` status,
- **When** the staff sequentially calls `POST /api/categories/:id/call-next` for that ticket's counter, then `/serve` and finally `/complete` with `{ "completionSummary": "Served 2x V60 Mae Tuen Washed" }`,
- **Then** each step responds `200 OK`, transitions status correctly (`CALLED -> SERVING -> COMPLETED`), sets all corresponding timestamps, populates `assigned_staff_id` and logs 3 transition rows in `ticket_events`.

### `AC-11` (Illegal State Jump & Blank Summary Rejection - Negative)
- **Given** an authenticated staff member,
- **When** they attempt to transition a `WAITING` ticket directly to `SERVING` or `COMPLETED` (skipping `CALLED`) or attempt to complete a `SERVING` ticket with a blank completion summary (`""`),
- **Then** the illegal jump responds with HTTP `409 Conflict` (`INVALID_STATE_TRANSITION`) and the blank summary responds with HTTP `400 Bad Request` (`VALIDATION_ERROR`).

### `AC-12` (Staff Marks CALLED Ticket as NO_SHOW With Mandatory Note - Positive & Boundary)
- **Given** an authenticated staff member and a ticket in `CALLED` status,
- **When** the staff submits `POST /api/tickets/:id/no-show` with `{ "noShowNote": "Called 3 times over 5 mins; guest absent" }`,
- **Then** the server updates status to `NO_SHOW`, sets `no_show_at` and responds `200 OK`; but if `noShowNote` is missing or the ticket is still `WAITING`, the server responds `400 Bad Request` or `409 Conflict` respectively. A staff member cancelling a `CALLED` ticket with a valid `cancelReason` receives `200 OK` with status `CANCELLED`.

### `AC-14` (Staff Counter Scope `BR-09` - Security Negative)
- **Given** `barista@omkoi.coffee` is assigned to `SLOW_BAR` and `ESPRESSO_BAR` only, and a `DESSERT_LOUNGE` ticket is `WAITING`,
- **When** the barista calls `POST /api/categories/3/call-next`, `GET /api/tickets?categoryId=3`, or `serve`/`complete`/`GET` on a `DESSERT_LOUNGE` ticket, and any `STAFF` or `ADMIN` account calls `POST /api/tickets`,
- **Then** every request is rejected with HTTP `403 Forbidden` and no ticket changes, while the same `DESSERT_LOUNGE` requests succeed for `dessert@omkoi.coffee` and for `admin@omkoi.coffee`.

### `AC-15` (Call-Next FIFO Ordering `BR-10` - Positive & Boundary)
- **Given** `SB-001`, `SB-002` and `SB-003` are `WAITING` in `SLOW_BAR`,
- **When** the barista calls `POST /api/categories/1/call-next` repeatedly, and separately two call-next requests are sent in parallel on a counter with two waiting tickets,
- **Then** the calls return `SB-001`, then `SB-002`, then `SB-003`, a fourth call returns `409 Conflict` (`QUEUE_EMPTY`), and the two parallel requests call two different tickets.

---

## 8. Verification
| AC | Tests (see `sts-and-dod.md`) |
| :--- | :--- |
| `AC-10` | `TEST-10`, `TEST-14`, `TEST-19` |
| `AC-11` | `TEST-11` |
| `AC-12` | `TEST-11` |
| `AC-14` | `TEST-16` |
| `AC-15` | `TEST-17`, `TEST-18` |

---

## 9. Version History
| Version | Date | Commit | Author | Change |
| :--- | :--- | :--- | :--- | :--- |
| 1.0 | 2026-11-09 | `a9c7a02` | @MANGKONYOK | First contract: staff console and lifecycle; `AC-10`-`AC-12`. |
| 1.1 | 2026-11-14 | PR #4 review commit | @kmood-Sakura | Server-side call-next (`BR-10`) replaces `/:id/call`; staff counter scope (`BR-09`) with `staff_counters`; conditional-update transitions; staff cancel in `AC-12`; `AC-14`, `AC-15`; data, rules, failure cases, permissions, UI (`C-01`, `C-02`, `C-05`). |
