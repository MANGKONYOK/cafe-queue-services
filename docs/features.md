# Feature Inventory

## 1. Feature Catalog Overview

The table below catalogs all features planned across Sprints 1, 2 and 3, mapping each feature to its unique identifier, functional scope, linked requirements, technical dependencies and target delivery sprint.

| Feature ID | Feature Name | Description & Functional Scope | Linked Requirements | Dependencies | Target Sprint |
| :---: | :--- | :--- | :--- | :---: | :---: |
| **`F-01`** | **Authentication, Sessions & Service Counter Directory** | Email/password login with salted bcrypt hashing, PostgreSQL-backed session persistence (`connect-pg-simple`), `/api/auth/me` current user profile endpoint, `/api/auth/logout`, backend Role-Based Access Control (RBAC) middleware and read-only directory of service counters (`SLOW_BAR`, `ESPRESSO_BAR`, `DESSERT_LOUNGE`, `ROASTERY_CONSULT`) indicating open/paused intake state. | `FR-01`, `FR-02`, `BR-02`, `NFR-01`, `NFR-02`, `NFR-03`, `NFR-04` | None | **Sprint 1** |
| **`F-02`** | **Customer Walk-In Queue Joining & Tracking** | Walk-in customer portal allowing authenticated guests to select an open service category, specify party size (`1-8`) and add optional requests (`<= 280` chars). Issues a monotonically sequenced ticket code (e.g., `SB-001`), computes real-time `aheadCount`, displays live status (`WAITING`, `CALLED`, `SERVING`, etc.) and enables customer self-cancellation for `WAITING` tickets with a mandatory reason. | `FR-03`, `FR-04`, `FR-05`, `BR-01`, `BR-02`, `BR-03`, `BR-05`, `BR-06`, `BR-07`, `BR-09`, `NFR-03`, `NFR-05`, `NFR-06` | `F-01` | **Sprint 1** |
| **`F-03`** | **Staff Counter Console & Service Lifecycle Execution** | Barista and Station Manager operational dashboard to view the queue of the staff member's assigned counters (Admin: every counter) filtered by category and status, and to call the next waiting guest, chosen by the server (oldest first). Implements the complete state machine (`WAITING -> CALLED -> SERVING -> COMPLETED / NO_SHOW / CANCELLED`) with mandatory completion summaries, no-show notes, timestamps, counter attribution and backend ownership/role enforcement. | `FR-06`, `FR-07`, `BR-04`, `BR-05`, `BR-06`, `BR-09`, `BR-10`, `NFR-03`, `NFR-05`, `NFR-06` | `F-01`, `F-02` | **Sprint 1** |
| **`F-04`** | **Admin Service Counter Management & Queue Pause/Resume** | Administrative control panel allowing the Station Manager (`ADMIN`) to create new service counters, modify estimated preparation times, update category descriptions and toggle the `is_open` flag to dynamically pause or resume walk-in queue intake during peak rushes, and assign staff to counters (`staff_counters`). Moved from Sprint 2 (`C-18`). | `FR-08`, `BR-02`, `BR-09`, `BR-11`, `BR-12` | `F-01`, `F-03` | **Sprint 1** |
| **`F-05`** | **Highland Beverage & Pastry Itemization on Tickets** | Allows owner customers (`WAITING`/`CALLED`) and counter-assigned staff/admin (`WAITING`/`CALLED`/`SERVING`) to attach/remove Omkoi signature menu items (`menu_items`) with `quantity` (1-20) and `brewNote` (<= 160 chars) on a ticket (`ticket_items`), exposing `GET /api/menu`, `/items` routes, and live `itemCount` summaries. | `FR-09`, `BR-04`, `BR-06`, `BR-09`, `BR-13` | `F-01`, `F-02`, `F-03` | **Sprint 2** |
| **`F-06`** | **Immutable Ticket Audit Trail & Barista Recall Tracking** | Read view (`GET /api/tickets/:id/events`) of chronological `ticket_events` rows enriched with actor name/role, plus assigned-counter `STAFF`/`ADMIN` recall tracking (`POST /api/tickets/:id/recall`) incrementing `recall_count`, recording `last_recalled_at`, and logging `CALLED -> CALLED` events before marking `NO_SHOW`. | `FR-09`, `BR-04`, `BR-05`, `BR-06`, `BR-09`, `BR-14` | `F-01`, `F-02`, `F-03` | **Sprint 2** |
| **`F-07`** | **Customer Post-Service Tasting Rating & Review** | Closed-loop customer feedback (`POST /api/tickets/:id/feedback`, `GET /api/tickets/:id/feedback`) allowing guests to rate 1-5 stars and add tasting notes (`<= 500` chars) on their own `COMPLETED` tickets once (`UNIQUE (ticket_id)`). *(Targeted for Deliverable 2 Part C.)* | `FR-10`, `BR-06`, `BR-08` | `F-01`, `F-02`, `F-03` | **Sprint 3** *(Deliverable 2 RC)* |
| **`F-08`** | **Station Operational Analytics & Wait-Time Dashboard** | Role-scoped management dashboard (`/analytics`, `GET /api/analytics/summary`) displaying ticket counts, average wait time (`called_at - created_at`), average service duration (`completed_at - serving_started_at`), no-show rate, average rating, and hourly throughput (`STAFF` scoped to assigned counters; `ADMIN` all counters). | `FR-10`, `BR-09`, `NFR-05` | `F-03`, `F-06`, `F-07` | **Sprint 3** *(Final Delivery, 13 Dec)* |

---

## 2. Feature Dependency Graph

```mermaid
flowchart TD
    F01["F-01: Auth, Sessions & Counter Directory\n(Sprint 1)"] --> F02["F-02: Customer Walk-In Queue & Tracking\n(Sprint 1)"]
    F01 --> F03["F-03: Staff Counter Lifecycle Execution\n(Sprint 1)"]
    F02 --> F03
    
    F01 --> F04["F-04: Admin Counter Management\n(Sprint 1)"]
    F03 --> F04
    F02 --> F05["F-05: Beverage & Pastry Itemization\n(Sprint 2)"]
    F03 --> F05
    F03 --> F06["F-06: Audit Trail & Recall Tracking\n(Sprint 2)"]
    
    F02 --> F07["F-07: Customer Tasting Rating\n(Sprint 3)"]
    F03 --> F07
    F03 --> F08["F-08: Station Operational Analytics\n(Sprint 3)"]
    F06 --> F08
    F07 --> F08
```