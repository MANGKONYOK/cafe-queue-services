# Sprint 2 Software Test Specification (STS) & Definition of Done (DoD)

## 1. Software Test Specification (STS Matrix)

The matrix below extends Sprint 1 (`TEST-01` to `TEST-25`) with all Sprint 2 automated verification cases (`TEST-26` to `TEST-33`) covering Features `F-05` and `F-06` (`AC-21` to `AC-27`). API and database integration tests run against a clean migrated + seeded PostgreSQL 16 test database (`TEST_DATABASE_URL`).

| Test ID | Linked Criteria | Level | Preconditions / Fixture | Test Action | Expected Result |
| :---: | :---: | :---: | :--- | :--- | :--- |
| **`TEST-26`** | `AC-21`, `FR-09` | API + DB Integration | Seeded `menu_items`; `boom@` holds `WAITING` ticket `SB-001` | 1. `GET /api/menu?categoryId=1`<br>2. `POST /api/tickets/:id/items` (`SB_DOI_MON_CHONG`, qty `2`, note `"Less ice"`)<br>3. `GET /api/tickets/:id/items` & `GET /api/tickets/my`<br>4. `DELETE /api/tickets/:id/items/:itemId` | 1 -> `200 OK` (`SLOW_BAR` menu items)<br>2 -> `201 Created`, row persisted in `ticket_items`<br>3 -> `totalItems: 2`, `totalPriceThb: 440`, `ticket.itemCount: 2`<br>4 -> `200 OK`, item deleted (`totalItems: 0`). |
| **`TEST-27`** | `AC-22`, `AC-23`, `BR-13` | API + DB Integration | `WAITING`, `SERVING`, and `COMPLETED` tickets in `SLOW_BAR` | 1. `POST /items` with qty `0`, `21`, `1.5`, 161-char note, and `EB_OMKOI_DIRTY` (wrong counter)<br>2. `POST /items` with qty `1` & `20`, 160-char note<br>3. `CUSTOMER` `POST/DELETE /items` on `SERVING`; `STAFF` `POST /items` on `SERVING`<br>4. `STAFF` `POST /items` on `COMPLETED` | 1 -> `400 VALIDATION_ERROR`, nothing stored<br>2 -> `201 Created`<br>3 -> `CUSTOMER` gets `409 INVALID_STATE_TRANSITION`, `STAFF` gets `201 Created`<br>4 -> `409 INVALID_STATE_TRANSITION`. |
| **`TEST-28`** | `AC-24`, `BR-06`, `BR-09` | API Security | `hongtae@` holds `DESSERT_LOUNGE` ticket; `boom@` and `barista@` (`SB`/`EB` only) logged in | `boom@` and `barista@` call `GET /items`, `POST /items`, `DELETE /items/:itemId` on `hongtae@`'s DL ticket; anonymous client calls `/api/menu` | Authenticated unauthorized calls -> `403 FORBIDDEN`; anonymous -> `401`; `ticket_items` unchanged. |
| **`TEST-29`** | `AC-21`, `NFR-05` | Component / UI | Customer `/queue` ticket card with mocked `/api/menu` & `/items` | Expand **Order Items**, select item, enter qty & brew note, submit, then click **Remove** | Items render with THB totals & `itemCount` badge updates; validation blocks invalid qty; error banner renders on `409`. |
| **`TEST-30`** | `AC-25`, `FR-09` | API + DB Integration | Ticket `SB-001` transitioned `WAITING -> CALLED -> SERVING -> COMPLETED` | Owner customer and assigned barista call `GET /api/tickets/:id/events` | `200 OK`, chronological array of 4 events with `fromStatus`, `toStatus`, `note`, `actorId`, `actorName`, `actorRole`, and `createdAt`. |
| **`TEST-31`** | `AC-26`, `BR-14` | API + DB Integration | `SB-001` in `CALLED`, `EB-001` in `WAITING`, plus terminal ticket | 1. Assigned barista calls `POST /api/tickets/:id/recall` on `SB-001` with `{}` then 200-char `note`<br>2. Call `/recall` with 201-char `note`<br>3. Call `/recall` on `WAITING`, `SERVING`, `COMPLETED` tickets | 1 -> `200 OK` both times; `recallCount` `1 -> 2`, `lastRecalledAt` set, `CALLED -> CALLED` events persisted<br>2 -> `400 VALIDATION_ERROR`<br>3 -> `409 INVALID_STATE_TRANSITION`, `recallCount` unchanged. |
| **`TEST-32`** | `AC-27`, `BR-06`, `BR-09` | API Security | `hongtae@` holds `CALLED` `DESSERT_LOUNGE` ticket | 1. `boom@` calls `GET /events` & `POST /recall`<br>2. `hongtae@` calls `POST /recall`<br>3. `barista@` calls `GET /events` & `POST /recall` on `DL` | All calls return `403 FORBIDDEN`; `recallCount` and `ticket_events` unchanged. |
| **`TEST-33`** | `AC-25`, `AC-26`, `NFR-05` | Component / UI | Staff `/staff` `CALLED` ticket card & Customer `/queue` card (mocked API) | Click **Recall guest** on `/staff` and open **Audit History** drawer | `Recalled 1x` badge renders immediately; Audit History renders chronological events with actor names and status transitions. |

### 1.1 Planned Test Files
| Tests | File |
| :--- | :--- |
| `TEST-26`, `TEST-27`, `TEST-28` | `server/tests/ticket-items.test.ts` |
| `TEST-29` | `client/src/__tests__/TicketItems.test.tsx` |
| `TEST-30`, `TEST-31`, `TEST-32` | `server/tests/audit-recall.test.ts` |
| `TEST-33` | `client/src/__tests__/AuditRecall.test.tsx` |

---

## 2. TDD Plan

For every Sprint 2 rule below, the failing automated test commit (**RED**) precedes the implementation commit (**GREEN**) on the feature branch, and both commit SHAs and outputs are preserved for Deliverable 2:

| Feature & Rule | Test written RED first |
| :--- | :--- |
| `F-05` / `BR-13` itemization boundaries, category match, status lock & persistence | `TEST-26`, `TEST-27` (`server/tests/ticket-items.test.ts`) |
| `F-05` / `BR-06`, `BR-09` ownership & counter-scope isolation | `TEST-28` (`server/tests/ticket-items.test.ts`) |
| `F-06` / `FR-09`, `BR-14` audit order, recall state gate & transaction | `TEST-30`, `TEST-31` (`server/tests/audit-recall.test.ts`) |
| `F-06` / `BR-06`, `BR-09` recall/events access restriction | `TEST-32` (`server/tests/audit-recall.test.ts`) |

---

## 3. Sprint 2 Definition of Done (DoD) Checklist

A Sprint 2 feature is **Done** only when all items below are fulfilled:

- [ ] **Contract-First Compliance:** `f05-ticket-itemization.md`, `f06-audit-trail-and-recall.md`, and this STS/DoD are reviewed and merged on `staging` (`#23`) **before** feature implementation code begins.
- [ ] **TDD Red-to-Green Evidence:** Separate RED (failing) and GREEN (passing) commits are preserved for both `F-05` (`#24`) and `F-06` (`#25`).
- [ ] **Server-Side Enforcement & Persistence:** Migrations `004_ticket_items.sql` and `005_ticket_recall.sql` and idempotent menu seeds apply cleanly; `BR-13`, `BR-14`, `BR-06`, and `BR-09` are enforced on the server; all data persists in PostgreSQL 16.
- [ ] **Full Regression & New Tests Passing:** Sprint 1 (`TEST-01`–`TEST-25`) and Sprint 2 (`TEST-26`–`TEST-33`) suites, `scripts/check-secrets.sh`, and Docker build pass in CI (`test-and-docker`) with `0` failures and `0` skipped tests.
- [ ] **UI & Responsive Polish:** `/queue` and `/staff` itemization panels, recall controls, and audit timeline render without horizontal overflow at `375px`, `768px`, and `1280px` (`NFR-05`), with loading, empty, and error states.
- [ ] **Peer-Reviewed Release & Identifiable Tag:** Feature PRs reviewed by teammate into `staging`, then promoted to `main` via reviewed Release PR, auto-deployed to Cloud Run (`deploy.yml`), and tagged **`v2.7.0`** so the accepted Sprint 2 release stays identifiable on `main`.
