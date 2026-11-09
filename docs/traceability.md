# Requirement Traceability Matrix
 
## 1. Traceability Chain Overview

Every requirement (`FR-xx`), domain business rule (`BR-xx`) and non-functional requirement (`NFR-xx`) established in `docs/srs.md` is mapped below to its parent feature, target development sprint, specific Acceptance Criteria (`AC-xx`) and automated verification tests (`TEST-xx`).

---

## 2. Master Traceability Table

| Requirement ID | Requirement Type & Summary | Mapped Feature | Planned Sprint | Acceptance Criteria (Given-When-Then) | Verification Tests (STS) | Implementation Status |
| :---: | :--- | :---: | :---: | :--- | :--- | :---: |
| **`FR-01`** | Email/password login, bcrypt hash verification, DB session persistence, `/api/auth/me`, logout. | `F-01` | **Sprint 1** | `AC-01`, `AC-02` | `TEST-01`, `TEST-02`, `TEST-13` | Specified (Sprint 1) |
| **`FR-02`** | List service categories, prefixes, estimated wait times and open/paused intake state. | `F-01` | **Sprint 1** | `AC-03` | `TEST-03` | Specified (Sprint 1) |
| **`FR-03`** | Customer joins walk-in queue for open category (`partySize` 1-8, optional note), receives sequenced ticket code (`SB-001`). | `F-02` | **Sprint 1** | `AC-04`, `AC-05`, `AC-06`, `AC-07` | `TEST-04`, `TEST-05`, `TEST-06`, `TEST-07`, `TEST-13` | Specified (Sprint 1) |
| **`FR-04`** | Customer tracks own tickets (`GET /api/tickets/my`, `GET /api/tickets/:id`), view live status and queue `aheadCount`. | `F-02` | **Sprint 1** | `AC-04`, `AC-09` | `TEST-04`, `TEST-09` | Specified (Sprint 1) |
| **`FR-05`** | Customer self-cancels own ticket in `WAITING` status with mandatory `cancelReason`. | `F-02` | **Sprint 1** | `AC-08`, `AC-09` | `TEST-08`, `TEST-09` | Specified (Sprint 1) |
| **`FR-06`** | Staff/Admin lists full station queue with category and status filters (`created_at ASC`). | `F-03` | **Sprint 1** | `AC-09`, `AC-10` | `TEST-09`, `TEST-10`, `TEST-14` | Specified (Sprint 1) |
| **`FR-07`** | Staff executes state transitions (`/call`, `/serve`, `/complete`, `/no-show`, `/cancel`) with mandatory summaries. | `F-03` | **Sprint 1** | `AC-10`, `AC-11`, `AC-12` | `TEST-10`, `TEST-11`, `TEST-14` | Specified (Sprint 1) |
| **`FR-08`** | Admin CRUD and dynamic pause/resume intake on service categories. | `F-04` | Sprint 2 | *(To be specified in Sprint 2 contract)* | *(To be specified in Sprint 2 STS)* | Planned (Sprint 2) |
| **`FR-09`** | Ticket beverage/pastry line itemization and immutable audit event trail. | `F-05`, `F-06` | Sprint 2 | *(To be specified in Sprint 2 contract)* | *(To be specified in Sprint 2 STS)* | Planned (Sprint 2) |
| **`FR-10`** | Post-service customer 1-5 star tasting review and station operational analytics dashboard. | `F-07`, `F-08` | Sprint 3 | *(To be specified in Sprint 3 contract)* | *(To be specified in Sprint 3 STS)* | Planned (Sprint 3) |
| **`BR-01`** | Single Active Ticket Invariant: Max 1 active ticket (`WAITING`/`CALLED`/`SERVING`) per customer per category (`409 Conflict`). | `F-02` | **Sprint 1** | `AC-05` | `TEST-05` (Unit + API) | Specified (Sprint 1) |
| **`BR-02`** | Paused Category Gate: Joining a paused/closed category returns `409 Conflict` (`CATEGORY_CLOSED`). | `F-01`, `F-02`, `F-04` | **Sprint 1** | `AC-06` | `TEST-06` (API) | Specified (Sprint 1) |
| **`BR-03`** | Input Boundaries: `partySize` must be integer `1-8` and `specialRequests` <= 280 characters (`400 Bad Request`). | `F-02` | **Sprint 1** | `AC-07` | `TEST-07` (Unit + API) | Specified (Sprint 1) |
| **`BR-04`** | State Machine Invariant: Legal transitions only; jumping states or mutating terminal tickets returns `409 Conflict`. | `F-03` | **Sprint 1** | `AC-10`, `AC-11` | `TEST-10`, `TEST-11` (Unit + API) | Specified (Sprint 1) |
| **`BR-05`** | Mandatory Summaries: Trimmed notes required for `COMPLETED` (5-500 chars), `CANCELLED` (3-200 chars) and `NO_SHOW` (3-200 chars). | `F-02`, `F-03` | **Sprint 1** | `AC-08`, `AC-11`, `AC-12` | `TEST-08`, `TEST-11` (Unit + API) | Specified (Sprint 1) |
| **`BR-06`** | Customer Isolation: Customers can only view/cancel own tickets; self-cancel forbidden once `CALLED`/`SERVING` (`403`/`409`). | `F-02`, `F-03` | **Sprint 1** | `AC-08`, `AC-09` | `TEST-08`, `TEST-09` (API Security) | Specified (Sprint 1) |
| **`BR-07`** | Sequential Ticket Codes: Generates monotonic code `<PREFIX>-<NNN>` per service category. | `F-02` | **Sprint 1** | `AC-04` | `TEST-04` (Unit + API) | Specified (Sprint 1) |
| **`BR-08`** | Single Rating Integrity: Rating allowed only on own `COMPLETED` ticket, exactly once (`409 Conflict` on duplicate). | `F-07` | Sprint 3 | *(To be specified in Sprint 3 contract)* | *(To be specified in Sprint 3 STS)* | Planned (Sprint 3) |
| **`NFR-01`** | Stored passwords hashed with salted bcrypt (cost >= 10); zero hash leakage in API responses. | `F-01` | **Sprint 1** | `AC-01` | `TEST-01` | Specified (Sprint 1) |
| **`NFR-02`** | Environment variable configuration, `.env.example` committed, zero secrets in repository. | `F-01` | **Sprint 1** | `AC-01` | Clean clone check / CI check | Specified (Sprint 1) |
| **`NFR-03`** | All domain records and user sessions stored in PostgreSQL 16; zero dependency on ephemeral container disk. | `F-01`..`F-03` | **Sprint 1** | `AC-01`, `AC-04` | `TEST-01`, `TEST-04`, Container restart check | Specified (Sprint 1) |
| **`NFR-04`** | `/api/health` and `/api/ready` (`SELECT 1`) respond in `< 500 ms` with `200 OK` (or `503` if DB unreachable). | `F-01` | **Sprint 1** | `AC-03` | `TEST-12`, Smoke test script | Specified (Sprint 1) |
| **`NFR-05`** | Responsive UI across Desktop (`1280px`), Tablet (`768px`) and Mobile (`375px`) with loading, empty and error states. | `F-01`..`F-03` | **Sprint 1** | `AC-04`, `AC-10` | `TEST-13`, `TEST-14` | Specified (Sprint 1) |