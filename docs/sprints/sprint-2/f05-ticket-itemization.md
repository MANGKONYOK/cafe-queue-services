# Feature Specification & Contract
**Feature Name:** Highland Beverage & Pastry Itemization on Tickets  
**Feature ID:** `F-05`  
**Owning Requirements:** `FR-09`, `BR-04`, `BR-06`, `BR-09`, `BR-13`  
**Dependencies:** `F-01` (auth, roles, categories), `F-02` (customer walk-in tickets), `F-03` (staff counter console & lifecycle). New migration `004_ticket_items.sql`.  
**Contract Version:** 1.0 (see section 9)

---

## 1. Feature Overview & User Workflows

Feature `F-05` lets guests and baristas attach Omkoi Station signature beverages, tasting flights, and highland pastries (`menu_items`) to a queue ticket (`ticket_items`) with quantities and brewing/temperature notes, replacing vague free-text pre-orders with structured line items backed by PostgreSQL 16.

### 1.1 Customer Pre-Ordering Workflow (`/queue`)
1. On `/queue`, an active ticket card in `WAITING` or `CALLED` status displays an **Order Items** summary badge (`itemCount`) and an expandable **Order Items** panel.
2. Opening **Order Items** loads `GET /api/tickets/:id/items` alongside the counter's menu from `GET /api/menu?categoryId=<ticket.categoryId>`.
3. The guest selects a menu item belonging to that ticket's counter, sets `quantity` (`1`–`20`) and an optional `brewNote` (e.g., `"V60 92C, no sugar"`, `<= 160` chars), and submits (`POST /api/tickets/:id/items`).
4. While the ticket remains `WAITING` or `CALLED`, the guest can also remove a line item (`DELETE /api/tickets/:id/items/:itemId`). Once the barista starts `SERVING` (or once terminal), the panel switches to read-only.

### 1.2 Barista & Admin Counter Workflow (`/staff`)
1. On `/staff`, each ticket card displays its `itemCount` badge and an expandable **Order Items** panel listing every requested beverage/pastry, quantity, unit price, and `brewNote`.
2. While a ticket on an assigned counter is `WAITING`, `CALLED`, or `SERVING`, `STAFF` (or `ADMIN` on any counter) may add or remove line items on behalf of the guest.
3. Once the ticket reaches a terminal state (`COMPLETED`, `NO_SHOW`, `CANCELLED`), line items are frozen read-only for the historical record.

---

## 2. API & Data Contract

### 2.1 API Endpoints
All endpoints require an authenticated session (`401 UNAUTHENTICATED` otherwise). Checks execute in the Sprint 1 order: `401` session → `403` role/ownership/counter scope → `404` → `400` body/query → `409` rule. Consistent with `F-02`/`F-03`, a `CUSTOMER` receives `403 FORBIDDEN` for both foreign and non-existent `:id` paths.

- `GET /api/menu`
  - **Roles:** `CUSTOMER`, `STAFF`, `ADMIN`
  - **Query:** optional `?categoryId=` (positive INT4; empty string counts as not given)
  - **Success `200 OK`:**
    ```json
    {
      "items": [
        {
          "id": 1,
          "categoryId": 1,
          "code": "SB_DOI_MON_CHONG",
          "name": "Doi Mon Chong Mist",
          "description": "Mae Tuen 18-hour cold drip, wild honey, clarified pomelo shrub.",
          "priceThb": 220,
          "isAvailable": true
        }
      ]
    }
    ```
  - **Errors:** `400 VALIDATION_ERROR` (non-INT4 `categoryId`), `401 UNAUTHENTICATED`

- `GET /api/tickets/:id/items`
  - **Roles:** Owner `CUSTOMER`, assigned-counter `STAFF`, `ADMIN`
  - **Success `200 OK`:**
    ```json
    {
      "items": [
        {
          "id": 10,
          "ticketId": 4,
          "menuItemId": 1,
          "menuCode": "SB_DOI_MON_CHONG",
          "menuName": "Doi Mon Chong Mist",
          "priceThb": 220,
          "quantity": 2,
          "brewNote": "Less ice",
          "addedByUserId": 4,
          "addedByName": "Boom",
          "createdAt": "2026-11-24T04:10:00.000Z"
        }
      ],
      "totalItems": 2,
      "totalPriceThb": 440
    }
    ```
  - **Errors:** `400 VALIDATION_ERROR` (invalid `:id`), `401`, `403 FORBIDDEN`, `404 NOT_FOUND` (`STAFF`/`ADMIN` only)

- `POST /api/tickets/:id/items`
  - **Roles & Allowed Ticket Status (`BR-13`):**
    - Owner `CUSTOMER`: `status IN ('WAITING', 'CALLED')`
    - Assigned-counter `STAFF` / `ADMIN`: `status IN ('WAITING', 'CALLED', 'SERVING')`
  - **Request Body:** `{ "menuItemId": 1, "quantity": 2, "brewNote": "V60 92C" }` (`brewNote` optional)
  - **Success `201 Created`:** `{ "item": { "id": 10, "ticketId": 4, "menuItemId": 1, "menuCode": "SB_DOI_MON_CHONG", "menuName": "Doi Mon Chong Mist", "priceThb": 220, "quantity": 2, "brewNote": "V60 92C", "addedByUserId": 4, "addedByName": "Boom", "createdAt": "..." } }`
  - **Errors:** `400 VALIDATION_ERROR` (bad `quantity`/`brewNote`/`menuItemId`, `CATEGORY_MISMATCH`, or `ITEM_UNAVAILABLE`), `401`, `403 FORBIDDEN`, `404 NOT_FOUND` (missing ticket or unknown `menuItemId`), `409 INVALID_STATE_TRANSITION` (terminal ticket, or `CUSTOMER` modifying a `SERVING` ticket)

- `DELETE /api/tickets/:id/items/:itemId`
  - **Roles & Allowed Ticket Status:** Same as `POST /api/tickets/:id/items`.
  - **Success `200 OK`:** `{ "deletedItemId": 10 }`
  - **Errors:** `400 VALIDATION_ERROR`, `401`, `403 FORBIDDEN`, `404 NOT_FOUND` (missing ticket or line item not belonging to `:id`), `409 INVALID_STATE_TRANSITION`

- **Ticket Response Addition (`GET /api/tickets/my`, `GET /api/tickets`, `GET /api/tickets/:id`):**
  - Additive field `itemCount` (`INTEGER >= 0`, sum of `ticket_items.quantity` or `0` when none) included on every `ticket` object returned by `toTicket()`.

### 2.2 Data Contract (`server/db/migrations/004_ticket_items.sql`)
- **`menu_items` Table:**
  - `id SERIAL PRIMARY KEY`
  - `category_id INTEGER NOT NULL REFERENCES service_categories(id)`
  - `code VARCHAR(40) NOT NULL UNIQUE`
  - `name VARCHAR(120) NOT NULL`
  - `description TEXT`
  - `price_thb INTEGER NOT NULL CHECK (price_thb > 0)`
  - `is_available BOOLEAN NOT NULL DEFAULT true`
  - `created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP`
- **`ticket_items` Table:**
  - `id SERIAL PRIMARY KEY`
  - `ticket_id INTEGER NOT NULL REFERENCES queue_tickets(id) ON DELETE CASCADE`
  - `menu_item_id INTEGER NOT NULL REFERENCES menu_items(id)`
  - `added_by_user_id INTEGER NOT NULL REFERENCES users(id)`
  - `quantity INTEGER NOT NULL CHECK (quantity BETWEEN 1 AND 20)`
  - `brew_note VARCHAR(160)`
  - `created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP`
  - Index `idx_ticket_items_ticket ON ticket_items (ticket_id, id)`
- **Idempotent Seed (`server/src/db/seed.ts`):**
  - Upserted with `ON CONFLICT (code) DO UPDATE` across all 4 seeded counters:
    - `SLOW_BAR`: `SB_DOI_MON_CHONG` (*Doi Mon Chong Mist*, 220 THB), `SB_MAE_TUEN_GESHA` (*Mae Tuen V60 Gesha*, 190 THB)
    - `ESPRESSO_BAR`: `EB_OMKOI_DIRTY` (*Omkoi Highland Terroir Dirty*, 145 THB), `EB_MIST_MATCHA` (*Highland Ceremonial Mist Matcha*, 155 THB)
    - `DESSERT_LOUNGE`: `DL_OMKOI_PINECONE` (*The Omkoi Pinecone*, 185 THB), `DL_PURPLE_YAM_MF` (*Purple Yam & Coconut Mille-Feuille*, 175 THB)
    - `ROASTERY_CONSULT`: `RC_CUPPING_FLIGHT` (*Single-Origin Cupping Flight*, 350 THB)

---

## 3. Business Rules & Validation (`BR-13`)
- `quantity`: must be a finite integer from `1` to `20` inclusive.
- `brewNote`: optional trimmed string at most `160` characters (blank/empty after trim is stored as `null`).
- `menuItemId`: positive INT4 referencing an existing `menu_items` row where `is_available = true` and `menu_item.category_id === ticket.category_id`.
- **Category Match:** Items must belong to the same service counter as the ticket (`CATEGORY_MISMATCH` returns `400 VALIDATION_ERROR`).
- **Status Lock (`BR-13`):** No line items may be added or deleted on terminal tickets (`COMPLETED`, `NO_SHOW`, `CANCELLED`). Customers may only modify items while `WAITING` or `CALLED` (`SERVING` is locked for customers so a drink mid-pour cannot change; `STAFF`/`ADMIN` may still adjust during `SERVING`). Violations return `409 INVALID_STATE_TRANSITION`.

---

## 4. Failure & Boundary Cases

| Case | Result |
| :--- | :--- |
| `quantity` is `0`, `21`, `-1`, `1.5`, or `"2"` | `400 VALIDATION_ERROR`, nothing stored |
| `quantity` is `1` or `20`; `brewNote` is `160` chars | `201 Created` |
| `brewNote` is `161` chars | `400 VALIDATION_ERROR` |
| `menuItemId` belongs to a different counter (`category_id` mismatch) | `400 VALIDATION_ERROR` (`code: "VALIDATION_ERROR"`, detail `CATEGORY_MISMATCH`) |
| `menuItemId` has `is_available = false` | `400 VALIDATION_ERROR` (`ITEM_UNAVAILABLE`) |
| `menuItemId` does not exist | `404 NOT_FOUND` |
| Customer calls `/items` (`GET`/`POST`/`DELETE`) on another customer's ticket or missing id | `403 FORBIDDEN`, nothing changes |
| `STAFF` calls `/items` on a counter not in their `staff_counters` | `403 FORBIDDEN`, nothing changes |
| Customer posts/deletes item when ticket is `SERVING` | `409 INVALID_STATE_TRANSITION`, items unchanged |
| Any role posts/deletes item when ticket is `COMPLETED`, `NO_SHOW`, or `CANCELLED` | `409 INVALID_STATE_TRANSITION`, items unchanged |
| Unauthenticated call to `/api/menu` or `/api/tickets/:id/items` | `401 UNAUTHENTICATED` |

---

## 5. Permissions

| Operation | `CUSTOMER` (Owner) | `CUSTOMER` (Other) | `STAFF` (Assigned) | `STAFF` (Unassigned) | `ADMIN` |
| :--- | :---: | :---: | :---: | :---: | :---: |
| `GET /api/menu` | Allowed | Allowed | Allowed | Allowed | Allowed |
| `GET /api/tickets/:id/items` | Allowed | `403` | Allowed | `403` | Allowed |
| `POST /api/tickets/:id/items` | `WAITING` / `CALLED` | `403` | `WAITING` / `CALLED` / `SERVING` | `403` | `WAITING` / `CALLED` / `SERVING` |
| `DELETE /api/tickets/:id/items/:itemId` | `WAITING` / `CALLED` | `403` | `WAITING` / `CALLED` / `SERVING` | `403` | `WAITING` / `CALLED` / `SERVING` |

Unauthenticated requests receive `401`.

---

## 6. UI Specification
- **Ticket Card Summary:** Active and historical ticket cards on `/queue` and `/staff` display an item count badge (e.g., `2 items`) and toggle an **Order Items** panel.
- **Order Items Panel:**
  - Lists attached items (`name`, `quantity`, unit/line THB total, `brewNote`, and `addedByName`), plus `totalItems` and `totalPriceThb`.
  - When editable for the caller's role and ticket status, renders an **Add item** form (dropdown filtered to the ticket's counter menu, quantity input `1`–`20`, optional brew note) and a **Remove** button per line.
  - Shows loading spinner on fetch, empty state `"No items added yet"`, inline field validation errors, and safe `400`/`409` server error banners. Action buttons disable while requests are pending.
  - Responsive across `375px`, `768px`, and `1280px` with zero horizontal overflow (`NFR-05`).

---

## 7. Acceptance Criteria (`AC-xx` - Given-When-Then)

### `AC-21` (Attach, Retrieve & Remove Ticket Items `FR-09`, `BR-13` - Positive)
- **Given** `boom@omkoi.coffee` holds an active `WAITING` ticket `SB-001` in `SLOW_BAR` and `GET /api/menu?categoryId=1` returns `SB_DOI_MON_CHONG`,
- **When** the customer adds `quantity: 2` of `SB_DOI_MON_CHONG` with `brewNote: "Less ice"`, reads `GET /api/tickets/:id/items` and `GET /api/tickets/my`, then removes that line item,
- **Then** `POST` returns `201 Created`, `GET /items` returns `totalItems: 2` and `totalPriceThb: 440`, `toTicket.itemCount` reflects `2`, and `DELETE` returns `200 OK` leaving `totalItems: 0`.

### `AC-22` (Itemization Boundaries & Category Mismatch `BR-13` - Boundary & Negative)
- **Given** an authenticated owner of a `SLOW_BAR` `WAITING` ticket,
- **When** they submit `quantity: 0`, `quantity: 21`, a `161`-character `brewNote`, or an `ESPRESSO_BAR` menu item id (`CATEGORY_MISMATCH`), and also test `quantity: 1` and `20` with a `160`-character `brewNote`,
- **Then** each invalid request returns `400 VALIDATION_ERROR` with nothing stored, and the valid boundary requests return `201 Created`.

### `AC-23` (Lifecycle Status Lock on Itemization `BR-04`, `BR-13` - Negative & Staff Override)
- **Given** a ticket in `SERVING` status and a second ticket in `COMPLETED` status,
- **When** the owner `CUSTOMER` attempts `POST /api/tickets/:id/items` on the `SERVING` ticket, assigned `STAFF` posts an item on the `SERVING` ticket, and `STAFF` posts an item on the `COMPLETED` ticket,
- **Then** the customer request on `SERVING` returns `409 INVALID_STATE_TRANSITION`, the assigned staff request on `SERVING` returns `201 Created`, and the request on `COMPLETED` returns `409 INVALID_STATE_TRANSITION`.

### `AC-24` (Ownership & Counter-Scope Isolation on Itemization `BR-06`, `BR-09` - Security Negative)
- **Given** `hongtae@omkoi.coffee` holds a `DESSERT_LOUNGE` ticket, `boom@omkoi.coffee` is another customer, and `barista@omkoi.coffee` is assigned only to `SLOW_BAR` and `ESPRESSO_BAR`,
- **When** `boom@` and `barista@` call `GET`, `POST`, and `DELETE` on that `DESSERT_LOUNGE` ticket's `/items` routes,
- **Then** every request is rejected with `403 FORBIDDEN` and no ticket items change.

---

## 8. Verification
| AC | Tests (see `sts-and-dod.md`) |
| :--- | :--- |
| `AC-21` | `TEST-26`, `TEST-29` |
| `AC-22` | `TEST-27` |
| `AC-23` | `TEST-27` |
| `AC-24` | `TEST-28` |

---

## 9. Version History
| Version | Date | Commit | Author | Change |
| :--- | :--- | :--- | :--- | :--- |
| 1.0 | 2026-11-23 | issue #23 (F-05 contract, before code) | @MANGKONYOK | Initial Sprint 2 contract for beverage/pastry itemization (`FR-09`, `BR-13`, `004_ticket_items.sql`, `AC-21`–`AC-24`, `TEST-26`–`TEST-29`). |
