import { Router, type Request } from "express";
import { z } from "zod";
import type { Pool } from "../db/pool.js";
import { CUSTOMER_CANCEL_FROM, STATUSES, TRANSITIONS, ACTIVE_STATUSES, type TicketStatus } from "../domain/tickets.js";
import { PG_INT_MAX, asyncHandler, forbidden, notFound, parseId, validationError, zodFields } from "../errors.js";
import { requireAuth, requireRole } from "../middleware/auth.js";
import { assignedCategoryIds, canOperate } from "../services/access.js";
import { findTicket, joinQueue, listEvents, listTickets, toTicket, transition } from "../services/tickets.js";

const joinBody = z.object({
  categoryId: z.number({ error: "categoryId must be a positive integer." }).int().positive().max(PG_INT_MAX, "categoryId is not a valid id."),
  partySize: z.number({ error: "partySize must be an integer from 1 to 8." }).int().min(1).max(8),
  specialRequests: z
    .string()
    .trim()
    .max(280, "specialRequests must be at most 280 characters.")
    .nullish()
    .transform((v) => (v ? v : null)),
});

const text = (field: string, min: number, max: number) =>
  z.object({
    [field]: z.string({ error: `${field} is required.` }).trim().min(min, `${field} must be ${min}-${max} characters.`).max(max, `${field} must be ${min}-${max} characters.`),
  });
const cancelBody = text("cancelReason", 3, 200);
const completeBody = text("completionSummary", 5, 500);
const noShowBody = text("noShowNote", 3, 200);

const listQuery = z.object({
  // An empty value (?categoryId=&status=) means "not given".
  categoryId: z.preprocess(
    (v) => (v === "" ? undefined : v),
    z.coerce.number().int().positive().max(PG_INT_MAX, "categoryId is not a valid id.").optional(),
  ),
  status: z.preprocess((v) => (v === "" ? undefined : v), z.enum([...STATUSES, "ACTIVE"]).optional()),
});

const parse = <T extends z.ZodTypeAny>(schema: T, value: unknown): z.infer<T> => {
  const r = schema.safeParse(value ?? {});
  if (!r.success) throw validationError(zodFields(r.error.issues));
  return r.data;
};

const ticketId = (req: Request) => parseId(String(req.params.id));

export function ticketsRouter(pool: Pool) {
  const router = Router();
  router.use(requireAuth(pool));

  /** Loads the ticket and enforces BR-06 / BR-09. Customers get 403 for foreign and missing tickets alike. */
  const loadForUser = async (req: Request) => {
    const user = req.user!;
    const id = ticketId(req);
    const ticket = id ? await findTicket(pool, id) : undefined;
    if (user.role === "CUSTOMER") {
      if (!ticket || ticket.customer_id !== user.id) throw forbidden();
      return ticket;
    }
    if (!ticket) throw notFound();
    if (!(await canOperate(pool, user, ticket.category_id))) throw forbidden();
    return ticket;
  };

  const reply = async (res: import("express").Response, id: number, status = 200) =>
    res.status(status).json({ ticket: toTicket((await findTicket(pool, id))!) });

  // FR-03: only customers create tickets; the owner is the session user (BR-09).
  router.post(
    "/",
    requireRole("CUSTOMER"),
    asyncHandler(async (req, res) => {
      const body = parse(joinBody, req.body);
      const id = await joinQueue(pool, req.user!.id, body);
      await reply(res, id, 201);
    }),
  );

  // FR-04: the caller's own tickets, newest first.
  router.get(
    "/my",
    asyncHandler(async (req, res) => {
      const rows = await listTickets(pool, { customerId: req.user!.id });
      res.json({ tickets: rows.map(toTicket) });
    }),
  );

  // FR-06: queue console, scoped to the staff member's counters (Admin: all).
  router.get(
    "/",
    requireRole("STAFF", "ADMIN"),
    asyncHandler(async (req, res) => {
      const q = parse(listQuery, req.query);
      const user = req.user!;
      let categoryIds: number[];
      if (q.categoryId !== undefined) {
        if (!(await canOperate(pool, user, q.categoryId))) throw forbidden();
        categoryIds = [q.categoryId];
      } else {
        categoryIds = (await assignedCategoryIds(pool, user)) ?? [];
      }
      const statuses: TicketStatus[] | undefined = q.status === "ACTIVE" ? ACTIVE_STATUSES : q.status ? [q.status] : undefined;
      const rows = await listTickets(pool, { categoryIds, statuses });
      res.json({ tickets: rows.map(toTicket) });
    }),
  );

  router.get(
    "/:id",
    asyncHandler(async (req, res) => {
      const ticket = await loadForUser(req);
      res.json({ ticket: toTicket(ticket), events: await listEvents(pool, ticket.id) });
    }),
  );

  // FR-05 / FR-07: customers cancel their own WAITING ticket; staff WAITING or CALLED on their counters.
  router.post(
    "/:id/cancel",
    asyncHandler(async (req, res) => {
      const ticket = await loadForUser(req);
      const { cancelReason } = parse(cancelBody, req.body);
      const from = req.user!.role === "CUSTOMER" ? CUSTOMER_CANCEL_FROM : TRANSITIONS.cancel.from;
      await transition(pool, req.user!.id, ticket.id, from, "CANCELLED", cancelReason);
      await reply(res, ticket.id);
    }),
  );

  const staffAction = (path: string, action: "serve" | "complete" | "noShow", body?: z.ZodTypeAny, noteField?: string) =>
    router.post(
      path,
      requireRole("STAFF", "ADMIN"),
      asyncHandler(async (req, res) => {
        const ticket = await loadForUser(req);
        const data = body ? parse(body, req.body) : {};
        const note = noteField ? (data as Record<string, string>)[noteField] : null;
        const { from, to } = TRANSITIONS[action];
        await transition(pool, req.user!.id, ticket.id, from, to, note);
        await reply(res, ticket.id);
      }),
    );

  staffAction("/:id/serve", "serve");
  staffAction("/:id/complete", "complete", completeBody, "completionSummary");
  staffAction("/:id/no-show", "noShow", noShowBody, "noShowNote");

  return router;
}
