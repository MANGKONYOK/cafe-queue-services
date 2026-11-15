import type pg from "pg";
import type { Pool } from "../db/pool.js";
import { withTx } from "../db/tx.js";
import { ACTIVE_STATUSES, formatTicketCode, type TicketStatus } from "../domain/tickets.js";
import { AppError, notFound } from "../errors.js";

type Db = Pool | pg.PoolClient;

export const duplicateActive = () =>
  new AppError(409, "DUPLICATE_ACTIVE_TICKET", "You already hold an active ticket in this category.");
export const categoryClosed = () => new AppError(409, "CATEGORY_CLOSED", "This counter is paused and not taking new guests.");
export const queueEmpty = () => new AppError(409, "QUEUE_EMPTY", "No guests are waiting at this counter.");
export const invalidTransition = (from: string, to: string) =>
  new AppError(409, "INVALID_STATE_TRANSITION", `A ${from} ticket cannot become ${to}.`, { from, to });

const SELECT_TICKET = `
  SELECT t.*, c.name AS category_name, c.code AS category_code, c.est_mins_per_ticket, u.full_name AS customer_name,
         CASE WHEN t.status = 'WAITING' THEN (
           SELECT count(*)::int FROM queue_tickets w
           WHERE w.category_id = t.category_id AND w.status = 'WAITING' AND w.seq_no < t.seq_no
         ) END AS ahead_count
  FROM queue_tickets t
  JOIN service_categories c ON c.id = t.category_id
  JOIN users u ON u.id = t.customer_id`;

export interface TicketRow {
  id: number;
  category_id: number;
  customer_id: number;
  status: TicketStatus;
  [key: string]: unknown;
}

export const toTicket = (r: Record<string, any>) => ({
  id: r.id,
  ticketCode: r.ticket_code,
  categoryId: r.category_id,
  categoryCode: r.category_code,
  categoryName: r.category_name,
  customerId: r.customer_id,
  customerName: r.customer_name,
  partySize: r.party_size,
  specialRequests: r.special_requests,
  status: r.status,
  counterName: r.counter_name,
  assignedStaffId: r.assigned_staff_id,
  completionSummary: r.completion_summary,
  cancelReason: r.cancel_reason,
  noShowNote: r.no_show_note,
  createdAt: r.created_at,
  calledAt: r.called_at,
  servingStartedAt: r.serving_started_at,
  completedAt: r.completed_at,
  cancelledAt: r.cancelled_at,
  noShowAt: r.no_show_at,
  aheadCount: r.ahead_count ?? null,
  // C-19: expected wait until this guest's turn starts; null once no longer WAITING.
  estWaitMins: r.ahead_count == null ? null : r.ahead_count * r.est_mins_per_ticket,
});

export async function findTicket(db: Db, id: number) {
  const { rows } = await db.query(`${SELECT_TICKET} WHERE t.id = $1`, [id]);
  return rows[0] as TicketRow | undefined;
}

export async function listTickets(db: Db, where: { customerId?: number; categoryIds?: number[]; statuses?: TicketStatus[] }) {
  const clauses: string[] = [];
  const params: unknown[] = [];
  if (where.customerId !== undefined) clauses.push(`t.customer_id = $${params.push(where.customerId)}`);
  if (where.categoryIds) clauses.push(`t.category_id = ANY($${params.push(where.categoryIds)})`);
  if (where.statuses) clauses.push(`t.status = ANY($${params.push(where.statuses)})`);
  const order = where.customerId !== undefined ? "t.id DESC" : "t.category_id, t.seq_no";
  const { rows } = await db.query(
    `${SELECT_TICKET} ${clauses.length ? "WHERE " + clauses.join(" AND ") : ""} ORDER BY ${order}`,
    params,
  );
  return rows;
}

export async function listEvents(db: Db, ticketId: number) {
  const { rows } = await db.query(
    "SELECT id, from_status, to_status, note, actor_id, created_at FROM ticket_events WHERE ticket_id = $1 ORDER BY id",
    [ticketId],
  );
  return rows.map((e) => ({
    id: e.id, fromStatus: e.from_status, toStatus: e.to_status, note: e.note, actorId: e.actor_id, createdAt: e.created_at,
  }));
}

const logEvent = (c: pg.PoolClient, ticketId: number, actorId: number, from: TicketStatus | null, to: TicketStatus, note: string | null) =>
  c.query("INSERT INTO ticket_events (ticket_id, actor_id, from_status, to_status, note) VALUES ($1, $2, $3, $4, $5)", [
    ticketId, actorId, from, to, note,
  ]);

/**
 * FR-03 join (BR-01, BR-02, BR-07, NFR-06). Incrementing next_seq takes the category row lock,
 * so joins to one counter run one at a time; a refused join rolls back and consumes no number.
 */
export async function joinQueue(
  pool: Pool,
  customerId: number,
  input: { categoryId: number; partySize: number; specialRequests: string | null },
): Promise<number> {
  return withTx(pool, async (c) => {
    const seq = await c.query(
      `UPDATE service_categories SET next_seq = next_seq + 1, updated_at = CURRENT_TIMESTAMP
       WHERE id = $1 AND is_open RETURNING next_seq - 1 AS seq_no, prefix`,
      [input.categoryId],
    );
    if (!seq.rowCount) {
      const exists = await c.query("SELECT 1 FROM service_categories WHERE id = $1", [input.categoryId]);
      throw exists.rowCount ? categoryClosed() : notFound();
    }
    const dup = await c.query(
      "SELECT 1 FROM queue_tickets WHERE customer_id = $1 AND category_id = $2 AND status = ANY($3)",
      [customerId, input.categoryId, ACTIVE_STATUSES],
    );
    if (dup.rowCount) throw duplicateActive();

    const { seq_no, prefix } = seq.rows[0];
    try {
      const ins = await c.query(
        `INSERT INTO queue_tickets (ticket_code, category_id, customer_id, seq_no, party_size, special_requests)
         VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
        [formatTicketCode(prefix, seq_no), input.categoryId, customerId, seq_no, input.partySize, input.specialRequests],
      );
      await logEvent(c, ins.rows[0].id, customerId, null, "WAITING", null);
      return ins.rows[0].id as number;
    } catch (err) {
      if ((err as { constraint?: string }).constraint === "one_active_ticket") throw duplicateActive();
      throw err;
    }
  });
}

/** BR-10: the server picks the oldest WAITING ticket; SKIP LOCKED lets parallel calls take different tickets. */
export async function callNext(pool: Pool, staffId: number, categoryId: number, counterName: string | null): Promise<number> {
  return withTx(pool, async (c) => {
    const next = await c.query(
      `SELECT id FROM queue_tickets WHERE category_id = $1 AND status = 'WAITING'
       ORDER BY seq_no LIMIT 1 FOR UPDATE SKIP LOCKED`,
      [categoryId],
    );
    if (!next.rowCount) throw queueEmpty();
    const id = next.rows[0].id as number;
    await c.query(
      `UPDATE queue_tickets SET status = 'CALLED', called_at = CURRENT_TIMESTAMP, counter_name = $2, assigned_staff_id = $3
       WHERE id = $1 AND status = 'WAITING'`,
      [id, counterName, staffId],
    );
    await logEvent(c, id, staffId, "WAITING", "CALLED", null);
    return id;
  });
}

const STAMP: Partial<Record<TicketStatus, string>> = {
  SERVING: "serving_started_at",
  COMPLETED: "completed_at",
  NO_SHOW: "no_show_at",
  CANCELLED: "cancelled_at",
};
const NOTE: Partial<Record<TicketStatus, string>> = {
  COMPLETED: "completion_summary",
  NO_SHOW: "no_show_note",
  CANCELLED: "cancel_reason",
};

/** BR-04: lock the row, check the current status, update and log in one transaction. */
export async function transition(
  pool: Pool,
  actorId: number,
  ticketId: number,
  allowedFrom: TicketStatus[],
  to: TicketStatus,
  note: string | null,
): Promise<void> {
  await withTx(pool, async (c) => {
    const cur = await c.query("SELECT status FROM queue_tickets WHERE id = $1 FOR UPDATE", [ticketId]);
    if (!cur.rowCount) throw notFound();
    const from = cur.rows[0].status as TicketStatus;
    if (!allowedFrom.includes(from)) throw invalidTransition(from, to);
    const sets = ["status = $2", `${STAMP[to]} = CURRENT_TIMESTAMP`];
    const params: unknown[] = [ticketId, to];
    if (NOTE[to]) sets.push(`${NOTE[to]} = $${params.push(note)}`);
    await c.query(`UPDATE queue_tickets SET ${sets.join(", ")} WHERE id = $1`, params);
    await logEvent(c, ticketId, actorId, from, to, note);
  });
}
