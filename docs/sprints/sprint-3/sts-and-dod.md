# Sprint 3 Software Test Specification (STS) & Definition of Done (DoD)

## 1. Software Test Specification (STS Matrix)

The matrix below specifies automated verification cases (`TEST-34` to `TEST-38`) for Sprint 3 Features `F-07` (`AC-28` to `AC-30`) and `F-08` (`AC-31` to `AC-33`).
- **`F-07` (`TEST-34`–`TEST-36`):** Targeted for implementation and verification in **Deliverable 2** (Issue `#26`, 29 Nov 2026).
- **`F-08` (`TEST-37`–`TEST-38`):** Explicitly scheduled as **Planned** for **Final Delivery** (13 Dec 2026).

| Test ID | Linked Criteria | Level | Preconditions / Fixture | Test Action | Expected Result | Target Milestone |
| :---: | :---: | :---: | :--- | :--- | :--- | :---: |
| **`TEST-34`** | `AC-28`, `FR-10`, `BR-08` | API + DB Integration | `boom@` holds `COMPLETED` ticket `SB-001` with no feedback | 1. `POST /api/tickets/:id/feedback` (`rating: 5`, `comment: "Clean floral finish"`)<br>2. `GET /api/tickets/:id/feedback` & `GET /api/tickets/my` | 1 -> `201 Created`, row persisted in `ticket_feedback`<br>2 -> returns saved `rating: 5` and `comment`; `ticket.feedback` populated on `/my`. | Deliverable 2 (29 Nov) |
| **`TEST-35`** | `AC-29`, `AC-30`, `BR-08`, `BR-06` | API Integration & Security | `hongtae@` holds `COMPLETED` `DL` ticket; `boom@` holds `WAITING`, `CANCELLED`, and rated `COMPLETED` tickets | 1. `boom@` submits `POST /feedback` on `WAITING`, `CANCELLED`, and already-rated `COMPLETED` (plus 2 concurrent requests)<br>2. Submit `rating` `0`, `6`, `3.5`, 501-char `comment`; submit boundary `rating: 1`, 500-char `comment`<br>3. `boom@` calls `GET`/`POST /feedback` on `hongtae@`'s ticket; `dessert@`/`admin@` call `POST /feedback`; `barista@` calls `GET /feedback` on `DL` | 1 -> non-`COMPLETED` `409 INVALID_STATE_TRANSITION`; repeat `409 DUPLICATE_FEEDBACK`<br>2 -> invalid `400 VALIDATION_ERROR`; valid boundary `201 Created`<br>3 -> all unauthorized calls `403 FORBIDDEN`. | Deliverable 2 (29 Nov) |
| **`TEST-36`** | `AC-28`, `NFR-05` | Component / UI | `/queue` Earlier tickets list with mocked `COMPLETED` rated & unrated tickets | Select 5 stars, enter tasting note, submit form; verify rated ticket renders read-only | Form submits rating and switches to read-only star display; validation & `409` banner render cleanly. | Deliverable 2 (29 Nov) |
| **`TEST-37`** | `AC-31`, `AC-32`, `AC-33`, `FR-10`, `BR-09` | API + DB Integration | Seeded counters with known `COMPLETED`, `NO_SHOW`, `CANCELLED` timestamps and `ticket_feedback` rows | 1. `ADMIN` calls `GET /api/analytics/summary`<br>2. `barista@` (`SB`/`EB` only) calls `GET /api/analytics/summary`<br>3. `boom@` (`CUSTOMER`) calls `/summary`<br>4. `ADMIN` calls invalid/inverted date range, then empty future range | 1 -> `200 OK` matching SQL averages & rates<br>2 -> `200 OK` scoped strictly to `SB` & `EB`<br>3 -> `403 FORBIDDEN`<br>4 -> `400 VALIDATION_ERROR` on invalid range; `200 OK` zero-safe (`null` averages, `0` counts) on empty window. | Final Delivery (13 Dec) |
| **`TEST-38`** | `AC-31`, `AC-33`, `NFR-05` | Component / UI | `/analytics` page for `ADMIN` and `STAFF` (mocked API) | Render summary cards & per-counter table, apply inverted date filter, render empty-range response | KPI cards and table render; invalid filter shows error; empty range renders empty banner without crashes. | Final Delivery (13 Dec) |

### 1.1 Planned Test Files
| Tests | File | Status Target |
| :--- | :--- | :--- |
| `TEST-34`, `TEST-35` | `server/tests/feedback.test.ts` | Deliverable 2 (`29 Nov`) |
| `TEST-36` | `client/src/__tests__/FeedbackCard.test.tsx` | Deliverable 2 (`29 Nov`) |
| `TEST-37` | `server/tests/analytics.test.ts` | Final Delivery (`13 Dec`) |
| `TEST-38` | `client/src/__tests__/AnalyticsPage.test.tsx` | Final Delivery (`13 Dec`) |

---

## 2. TDD Plan

| Feature & Rule | Test written RED first | Target |
| :--- | :--- | :---: |
| `F-07` / `BR-08`, `BR-06` completed-only gate, single feedback `UNIQUE` backstop & owner-only enforcement | `TEST-34`, `TEST-35` (`server/tests/feedback.test.ts`) | Deliverable 2 |
| `F-08` / `FR-10`, `BR-09` metric formulas, `STAFF` counter scoping & zero-safe empty window | `TEST-37` (`server/tests/analytics.test.ts`) | Final Delivery |

---

## 3. Sprint 3 Definition of Done (DoD) Checklist

### 3.1 Deliverable 2 Checkpoint Scope (Due 29 Nov 2026)
- [ ] **Contracts Complete:** Both `f07-customer-tasting-rating.md` and `f08-operational-analytics.md` and this STS/DoD are merged on `staging` (`#23`).
- [ ] **`F-07` Implemented with TDD:** Migration `006_ticket_feedback.sql`, `POST/GET /api/tickets/:id/feedback`, `/queue` & `/staff` rating UI, and `TEST-34`–`TEST-36` pass with RED/GREEN commits preserved (`#26`).
- [ ] **Integrated Candidate Released (`v3.0.0-rc1`):** Sprint 1 + Sprint 2 + `F-07` pass CI (`test-and-docker`), deploy to Cloud Run via `deploy.yml`, and verify live persistence without breaking Sprint 1 behavior.

### 3.2 Final Delivery Scope (Due 13 Dec 2026)
- [ ] **`F-08` Implemented with TDD:** `GET /api/analytics/summary`, `/analytics` UI, and `TEST-37`–`TEST-38` pass (`0` failures, `0` skipped).
- [ ] **Hardening, UAT & Final Video:** All Lab 6/7 UAT defects resolved and re-tested, responsive/E2E verification complete on the final `main` release tag, and 4-minute demo video delivered.
