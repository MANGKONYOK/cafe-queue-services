# Feature Specification & Contract
**Feature Name:** Station Operational Analytics & Wait-Time Dashboard  
**Feature ID:** `F-08`  
**Owning Requirements:** `FR-10`, `BR-09`, `NFR-05`  
**Dependencies:** `F-03` (ticket lifecycle timestamps), `F-06` (audit/recall metrics), `F-07` (`ticket_feedback` ratings). **No new migration.**  
**Delivery Schedule Note:** *Fully contracted here for Deliverable 2 Part C; scheduled for implementation and verification in Final Delivery (13 Dec 2026).*  
**Contract Version:** 1.0 (see section 9)

---

## 1. Feature Overview & User Workflows

Feature `F-08` gives baristas and the Station Manager an operational analytics view (`/analytics`) summarizing queue throughput, wait durations, active preparation times, no-show rates, and customer tasting ratings over existing PostgreSQL records.

### 1.1 Operational Analytics Workflow (`/analytics`)
1. `STAFF` and `ADMIN` users open **Analytics** (`/analytics`) from the top navigation bar (hidden for `CUSTOMER` accounts).
2. The client requests `GET /api/analytics/summary` (optionally scoped by `?from=YYYY-MM-DD&to=YYYY-MM-DD` query dates).
3. `ADMIN` sees station-wide totals and a breakdown across every counter (`SB`, `EB`, `DL`, `RC`, plus any admin-created counters). `STAFF` sees totals and breakdown rows restricted strictly to counters assigned to them in `staff_counters` (`BR-09`).
4. Users can adjust the date filter or see explicit empty/zero-safe state when no tickets fall inside the selected window.

---

## 2. API & Data Contract

### 2.1 API Endpoints
- `GET /api/analytics/summary`
  - **Roles:** `STAFF` (assigned counters only), `ADMIN` (all counters). `CUSTOMER` receives `403 FORBIDDEN`; unauthenticated receives `401 UNAUTHENTICATED`.
  - **Query Parameters:**
    - `from` (optional ISO date `YYYY-MM-DD` or ISO timestamp; empty string treated as omitted)
    - `to` (optional ISO date `YYYY-MM-DD` or ISO timestamp; empty string treated as omitted; must satisfy `from <= to`)
  - **Success `200 OK`:**
    ```json
    {
      "range": {
        "from": "2026-11-01",
        "to": "2026-11-29"
      },
      "station": {
        "totalTickets": 24,
        "completedCount": 18,
        "noShowCount": 2,
        "cancelledCount": 1,
        "activeCount": 3,
        "noShowRatePct": 10.0,
        "avgWaitMins": 8.4,
        "avgServiceMins": 11.2,
        "avgRating": 4.7,
        "ratingCount": 15
      },
      "byCategory": [
        {
          "categoryId": 1,
          "code": "SLOW_BAR",
          "name": "Omkoi Specialty Slow Bar (Pour-Over & Syphon)",
          "prefix": "SB",
          "totalTickets": 12,
          "completedCount": 10,
          "noShowCount": 1,
          "cancelledCount": 0,
          "activeCount": 1,
          "noShowRatePct": 9.1,
          "avgWaitMins": 10.5,
          "avgServiceMins": 12.1,
          "avgRating": 4.8,
          "ratingCount": 8
        }
      ],
      "hourlyThroughput": [
        { "hour": 9, "count": 4 },
        { "hour": 10, "count": 7 }
      ]
    }
    ```
  - **Errors:** `400 VALIDATION_ERROR` (malformed `from`/`to` date or `from > to`), `401 UNAUTHENTICATED`, `403 FORBIDDEN` (`CUSTOMER`)

### 2.2 Data Contract & Metric Formulas
- **Schema & Migrations:** **No new migration or database table required.** Aggregates directly over `service_categories`, `queue_tickets`, `staff_counters`, and `ticket_feedback`.
- **Metric Definitions:**
  - `avgWaitMins`: `ROUND(AVG(EXTRACT(EPOCH FROM (called_at - created_at)) / 60.0)::numeric, 1)` over tickets where `called_at IS NOT NULL` (`null` when 0 called tickets).
  - `avgServiceMins`: `ROUND(AVG(EXTRACT(EPOCH FROM (completed_at - serving_started_at)) / 60.0)::numeric, 1)` over tickets where `serving_started_at IS NOT NULL AND completed_at IS NOT NULL` (`null` when 0 completed tickets).
  - `noShowRatePct`: `ROUND(no_show_count * 100.0 / NULLIF(completed_count + no_show_count, 0), 1)` (`0.0` when `completed_count + no_show_count = 0`).
  - `avgRating`: `ROUND(AVG(tf.rating)::numeric, 1)` (`null` when `ratingCount = 0`).
  - `hourlyThroughput`: count of tickets grouped by `EXTRACT(HOUR FROM created_at)` ordered `hour ASC` (empty array `[]` when no matching tickets).

---

## 3. Business Rules & Validation
- **Role & Counter Scope (`BR-09`):** `CUSTOMER` is strictly denied (`403 FORBIDDEN`). `STAFF` queries include `category_id IN (assignedCategoryIds)`; if a `STAFF` member has 0 assigned counters, returns zeroed station totals, empty `byCategory: []`, and `hourlyThroughput: []`. `ADMIN` sees all counters.
- **Date Range Integrity:** Both `from` and `to` are validated before querying PostgreSQL; when `to` is a `YYYY-MM-DD` date string, it includes the full calendar day up to `23:59:59.999` UTC/offset. `from > to` returns `400 VALIDATION_ERROR`.
- **Zero-Safe Division:** Empty tables or date ranges with zero matching tickets must never fail with division-by-zero (`NaN`/`Infinity`/SQL 500); counts return `0` and averages return `null`.

---

## 4. Failure & Boundary Cases

| Case | Result |
| :--- | :--- |
| `CUSTOMER` calls `GET /api/analytics/summary` | `403 FORBIDDEN` |
| `STAFF` assigned to `SB` & `EB` calls `/summary` when `DL` & `RC` also have tickets | `200 OK`; `station` and `byCategory` include `SB` & `EB` only (never `DL`/`RC`) |
| `from=invalid` or `from=2026-12-10&to=2026-12-01` | `400 VALIDATION_ERROR` |
| Empty date window (`from=2099-01-01&to=2099-01-02`) or 0 rated tickets | `200 OK`; `totalTickets: 0`, `noShowRatePct: 0`, `avgWaitMins: null`, `avgServiceMins: null`, `avgRating: null`, `hourlyThroughput: []` |
| Unauthenticated request | `401 UNAUTHENTICATED` |

---

## 5. Permissions

| Operation | `CUSTOMER` | `STAFF` | `ADMIN` |
| :--- | :---: | :---: | :---: |
| `GET /api/analytics/summary` | `403` | Allowed (assigned counters only) | Allowed (all counters) |

Unauthenticated requests receive `401`.

---

## 6. UI Specification
- **Header Navigation:** Shows **Analytics** (`/analytics`) link for `STAFF` and `ADMIN`; `/analytics` redirects `CUSTOMER` to `/queue` and anonymous users to `/login`.
- **Dashboard Layout (`/analytics`):**
  - Date filter bar (**From**, **To**, **Apply**, **Reset**).
  - Top KPI summary cards: Total Tickets, Completed, No-Show Rate (`%`), Avg Wait (`mins`), Avg Service (`mins`), Avg Tasting Rating (`★`).
  - Per-counter breakdown table (`byCategory`) and hourly throughput bar breakdown (`hourlyThroughput`).
  - Loading skeleton while fetching, empty-state banner (`"No ticket activity in selected date range"`), validation error message for inverted dates, and zero horizontal scroll at `375px`, `768px`, and `1280px` (`NFR-05`).

---

## 7. Acceptance Criteria (`AC-xx` - Given-When-Then)

### `AC-31` (Accurate Operational Metrics Aggregation `FR-10` - Positive)
- **Given** a database containing `COMPLETED` tickets (with known `created_at`, `called_at`, `serving_started_at`, `completed_at`), `NO_SHOW` tickets, `CANCELLED` tickets, and `ticket_feedback` ratings,
- **When** an `ADMIN` calls `GET /api/analytics/summary`,
- **Then** `200 OK` returns exact `station` totals, per-counter rows in `byCategory`, `noShowRatePct`, `avgWaitMins`, `avgServiceMins`, `avgRating`, and `hourlyThroughput`.

### `AC-32` (Analytics Role & Counter-Scope Enforcement `BR-09` - Security Negative & Scoped Positive)
- **Given** tickets exist in `SLOW_BAR` and `DESSERT_LOUNGE`,
- **When** `boom@omkoi.coffee` (`CUSTOMER`) calls `GET /api/analytics/summary`, and `barista@omkoi.coffee` (`STAFF` assigned only to `SLOW_BAR` and `ESPRESSO_BAR`) calls `GET /api/analytics/summary`,
- **Then** the customer receives `403 FORBIDDEN`, and the barista receives `200 OK` containing only `SLOW_BAR` and `ESPRESSO_BAR` data with `DESSERT_LOUNGE` excluded from both `byCategory` and `station` totals.

### `AC-33` (Date Filter Validation & Zero-Safe Empty Window `FR-10` - Boundary & Negative)
- **Given** an authenticated `ADMIN`,
- **When** they request `?from=2026-12-10&to=2026-12-01` or `?from=not-a-date`, and then request `?from=2099-01-01&to=2099-01-02`,
- **Then** invalid/inverted dates return `400 VALIDATION_ERROR`, and the empty window returns `200 OK` with `totalTickets: 0`, `noShowRatePct: 0`, and `null` averages (no `500` or `NaN`).

---

## 8. Verification
| AC | Tests (see `sts-and-dod.md`) | Delivery Status |
| :--- | :--- | :--- |
| `AC-31` | `TEST-37`, `TEST-38` | Planned (Final Delivery — 13 Dec) |
| `AC-32` | `TEST-37` | Planned (Final Delivery — 13 Dec) |
| `AC-33` | `TEST-37`, `TEST-38` | Planned (Final Delivery — 13 Dec) |

---

## 9. Version History
| Version | Date | Commit | Author | Change |
| :--- | :--- | :--- | :--- | :--- |
| 1.0 | 2026-11-23 | issue #23 (F-08 contract, before code) | @MANGKONYOK | Initial Sprint 3 contract for operational analytics (`FR-10`, `BR-09`, `AC-31`–`AC-33`, `TEST-37`–`TEST-38`). Contracted in Deliverable 2; scheduled for Final Delivery by 13 Dec 2026. |
