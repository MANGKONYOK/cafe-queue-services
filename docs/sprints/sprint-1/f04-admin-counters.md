# Feature Specification & Contract
**Feature Name:** Admin Service Counter Management & Queue Pause/Resume  
**Feature ID:** `F-04`  
**Owning Requirements:** `FR-08`, `BR-02`, `BR-09`, `BR-11`, `BR-12`  
**Dependencies:** `F-01` (session, roles, categories), `F-03` (`staff_counters`, staff scope). No new migration.  
**Contract Version:** 1.1 (see section 9)  

---

## 1. Feature Overview & User Workflows

Feature `F-04` gives the Station Manager (`ADMIN`) control of the counters the queue runs on: creating a counter, editing its description and preparation time, pausing or resuming walk-in intake, and choosing which staff operate it. It was moved from Sprint 2 into Sprint 1 so the release can show `BR-02` (paused counter) and `BR-09` (staff scope) through the UI instead of by editing the database (`C-18`).

### 1.1 Counter Administration Workflow
1. The admin opens **Counters** (`/admin`) from the header.
2. The page lists every counter with its prefix, waiting count, estimated minutes, open/paused state and assigned staff.
3. **Pause** / **Resume** flips `is_open` (`PATCH /api/categories/:id`). Pausing stops new joins only; guests already waiting can still be called and served (`BR-12`).
4. **Edit** changes the name, description or minutes per guest. Code and prefix never change, because ticket codes already issued use them (`BR-11`).
5. **Staff** checkboxes set exactly which `STAFF` accounts operate the counter (`PUT /api/categories/:id/staff`); a staff member's console tabs follow at their next page load (`BR-09`).
6. **New counter** creates a counter with a unique code and prefix; its numbering starts at `<PREFIX>-001`.

---

## 2. API & Data Contract

### 2.1 API Endpoints (all `ADMIN` only)
- `POST /api/categories`
  - Body: `{ "code": "TEA_BAR", "name": "Highland Tea Bar", "prefix": "TB", "description": "Loose-leaf highland teas.", "estMinsPerTicket": 8, "isOpen": true }` (`description` optional, `isOpen` defaults to `true`)
  - Success `201 Created`: `{ "category": { "id": 5, "code": "TEA_BAR", "name": "...", "prefix": "TB", "description": "...", "estMinsPerTicket": 8, "isOpen": true, "waitingCount": 0 } }`
  - Errors: `400 VALIDATION_ERROR`, `401`, `403`, `409 DUPLICATE_CATEGORY` (code or prefix already used)
- `PATCH /api/categories/:id`
  - Body: any of `{ "name", "description", "estMinsPerTicket", "isOpen" }` (at least one; `code` and `prefix` are rejected)
  - Success `200 OK`: `{ "category": { ... } }`
  - Errors: `400 VALIDATION_ERROR`, `401`, `403`, `404 NOT_FOUND`
- `PUT /api/categories/:id/staff`
  - Body: `{ "staffIds": [2, 3] }` (replaces the whole set; `[]` removes everyone)
  - Success `200 OK`: `{ "categoryId": 1, "staffIds": [2, 3] }`
  - Errors: `400 VALIDATION_ERROR` (not an array, duplicates, or an id that is not a `STAFF` account; `details.fields.staffIds`), `401`, `403`, `404 NOT_FOUND`
- `GET /api/staff`
  - Success `200 OK`: `{ "staff": [ { "id": 2, "fullName": "Khun Noble", "email": "barista@omkoi.coffee", "categoryIds": [1, 2] } ] }` (every `STAFF` account, for the assignment checkboxes)
  - Errors: `401`, `403`
- `GET /api/categories` (from `F-01`) now also returns `waitingCount` per counter (`C-19`).

### 2.2 Data Contract
- **Schema:** no change and no migration. `service_categories` (from `001`) and `staff_counters` (from `003`) are written by this feature.
- **Create:** a new row starts with `next_seq = 1`, so its first ticket is `<PREFIX>-001`.
- **Assignment replace:** one transaction deletes the counter's `staff_counters` rows and inserts the new set.

---

## 3. Business Rules & Validation
- `code`: 3-30 characters, `A-Z`, digits and `_`, starting with a letter. `prefix`: 2-5 letters `A-Z`. Both unique (`409 DUPLICATE_CATEGORY`) and immutable after creation (`BR-11`).
- `name`: 3-120 characters after trimming. `description`: optional, at most 500 characters (blank stored as `null`). `estMinsPerTicket`: integer 1-240. `isOpen`: boolean.
- Pausing (`isOpen: false`) blocks new joins only (`BR-02`); `WAITING`, `CALLED` and `SERVING` tickets of that counter keep moving through the lifecycle (`BR-12`).
- `staffIds`: unique positive integers, each a `STAFF` account (`ADMIN` needs no assignment, `CUSTOMER` cannot be assigned).
- Check order: `401` -> `403` role -> `404` -> `400` -> `409`.

## 4. Failure & Boundary Cases
| Case | Result |
| :--- | :--- |
| Customer or staff calls any endpoint of this feature | `403 FORBIDDEN`, nothing changes |
| `code` or `prefix` already used | `409 DUPLICATE_CATEGORY`, nothing stored |
| `prefix` `"T"` or `"TOOLONG"`, `code` `"tea bar"`, `estMinsPerTicket` `0` or `241`, `name` `"ab"` | `400 VALIDATION_ERROR` with the failing field |
| `estMinsPerTicket` `1` and `240`; `name` of 3 characters | accepted |
| `PATCH` with `code` or `prefix`, or with no field | `400 VALIDATION_ERROR` |
| Unknown counter id | `404 NOT_FOUND` |
| Pause a counter with waiting guests | `200`; new joins `409 CATEGORY_CLOSED`; call-next still serves the waiting guests |
| `staffIds` containing a customer or admin id, a duplicate, or not an array | `400 VALIDATION_ERROR`, assignments unchanged |

## 5. Permissions
| Operation | `CUSTOMER` | `STAFF` | `ADMIN` |
| :--- | :---: | :---: | :---: |
| `POST /api/categories`, `PATCH /api/categories/:id` | `403` | `403` | Allowed |
| `PUT /api/categories/:id/staff`, `GET /api/staff` | `403` | `403` | Allowed |

Unauthenticated requests receive `401`.

## 6. UI Specification
- **Header:** `ADMIN` sees **Console** (`/staff`) and **Counters** (`/admin`); other roles never see the link, and `/admin` redirects them to their home.
- **`/admin`:** one card per counter with name, prefix, `OPEN`/`PAUSED`, waiting count, minutes per guest and description; **Pause**/**Resume** button; **Edit** form (name, minutes, description); staff checkboxes with **Save staff**.
- **New counter form:** code, prefix, name, minutes, optional description; field errors from the API are shown under each field.
- **States:** loading; empty "No counters yet"; `400`/`409` messages in a banner; a `401` sends the admin to sign-in; **Edit** always opens with the latest values; buttons disabled while a request is pending.

---

## 7. Acceptance Criteria (`AC-xx` - Given-When-Then)

### `AC-17` (Admin Creates a Counter `FR-08`, `BR-11` - Positive, Boundary & Negative)
- **Given** an authenticated admin,
- **When** they create `TEA_BAR` / `TB` with `estMinsPerTicket` `8`, then try `TB` again under another code, and try invalid fields (`prefix` `"T"`, `estMinsPerTicket` `0` or `241`),
- **Then** the first request returns `201 Created` with `waitingCount` `0` and the counter appears in `GET /api/categories`; a customer's first join there gets `TB-001`; the duplicate returns `409 DUPLICATE_CATEGORY`; each invalid request returns `400 VALIDATION_ERROR`, and nothing extra is stored.

### `AC-18` (Admin Pauses and Resumes Intake `FR-08`, `BR-02`, `BR-12` - Positive)
- **Given** `SLOW_BAR` is open and `SB-001` is `WAITING`,
- **When** the admin sets `isOpen: false`, a customer tries to join, the barista calls next, and the admin then sets `isOpen: true`,
- **Then** the pause returns `200` with `isOpen: false`; the join returns `409 CATEGORY_CLOSED`; call-next still returns `SB-001` as `CALLED`; after resuming, a join returns `201 Created`.

### `AC-19` (Admin Assigns Staff `FR-08`, `BR-09` - Positive & Negative)
- **Given** `dessert@omkoi.coffee` is assigned only to `DESSERT_LOUNGE` and `barista@omkoi.coffee` to `SLOW_BAR` and `ESPRESSO_BAR`,
- **When** the admin sets `SLOW_BAR` staff to `[dessert]` and then sends `staffIds` with a customer id,
- **Then** the first request returns `200`; the dessert staff member can now call next on `SLOW_BAR` and sees it in `assignedCategoryIds`, while the barista gets `403` on `SLOW_BAR`; the request with a customer id returns `400 VALIDATION_ERROR` and the assignments stay as they were.

### `AC-20` (Only the Admin Manages Counters - Security Negative)
- **Given** a signed-in customer and a signed-in staff member,
- **When** each calls `POST /api/categories`, `PATCH /api/categories/:id`, `PUT /api/categories/:id/staff` and `GET /api/staff`, and an anonymous client does the same,
- **Then** every request by the customer or staff member returns `403 Forbidden`, every anonymous request returns `401`, and no counter or assignment changes.

---

## 8. Verification
| AC | Tests (see `sts-and-dod.md`) |
| :--- | :--- |
| `AC-17` | `TEST-21`, `TEST-25` |
| `AC-18` | `TEST-22`, `TEST-25` |
| `AC-19` | `TEST-23` |
| `AC-20` | `TEST-24` |

---

## 9. Version History
| Version | Date | Commit | Author | Change |
| :--- | :--- | :--- | :--- | :--- |
| 1.0 | 2026-11-15 | issue #3 (F-04 contract, before code) | @kmood-Sakura | First contract. `F-04` moved from Sprint 2 into Sprint 1 and shipped in the issue #3 PR (`C-18`); `BR-11`, `BR-12`, `AC-17`-`AC-20`, `TEST-21`-`TEST-25`. |
| 1.1 | 2026-11-15 | `422efbb` (PR #6 review) | @kmood-Sakura | **Edit** opens with the latest values; a `401` from any admin action ends the session; `staffIds` above INT4 are `400` (`C-20`). Verified by `TEST-23`, `TEST-25`. |
