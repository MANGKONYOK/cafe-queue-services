import { Router } from "express";
import { z } from "zod";
import type { Pool } from "../db/pool.js";
import { asyncHandler, forbidden, notFound, validationError, zodFields } from "../errors.js";
import { requireAuth, requireRole } from "../middleware/auth.js";
import { canOperate } from "../services/access.js";
import { callNext, findTicket, toTicket } from "../services/tickets.js";

const callNextBody = z.object({
  counterName: z
    .string()
    .trim()
    .max(50, "counterName must be at most 50 characters.")
    .nullish()
    .transform((v) => (v ? v : null)),
});

export function categoriesRouter(pool: Pool) {
  const router = Router();

  // FR-02: read-only directory for every signed-in role.
  router.get(
    "/",
    requireAuth(pool),
    asyncHandler(async (_req, res) => {
      const { rows } = await pool.query(
        `SELECT id, code, name, prefix, description, est_mins_per_ticket, is_open
         FROM service_categories ORDER BY id`,
      );
      res.json({
        categories: rows.map((r) => ({
          id: r.id,
          code: r.code,
          name: r.name,
          prefix: r.prefix,
          description: r.description,
          estMinsPerTicket: r.est_mins_per_ticket,
          isOpen: r.is_open,
        })),
      });
    }),
  );

  // FR-07 / BR-10: call the oldest WAITING guest of this counter. Order: 403 role -> 403 scope -> 404 -> 400 -> 409.
  router.post(
    "/:id/call-next",
    requireAuth(pool),
    requireRole("STAFF", "ADMIN"),
    asyncHandler(async (req, res) => {
      const user = req.user!;
      const id = Number(req.params.id);
      if (!(Number.isInteger(id) && id > 0 && id <= 2147483647)) throw user.role === "ADMIN" ? notFound() : forbidden();
      if (!(await canOperate(pool, user, id))) throw forbidden(); // staff on an unassigned (or unknown) counter
      const exists = await pool.query("SELECT 1 FROM service_categories WHERE id = $1", [id]);
      if (!exists.rowCount) throw notFound();
      const parsed = callNextBody.safeParse(req.body ?? {});
      if (!parsed.success) throw validationError(zodFields(parsed.error.issues));
      const ticketId = await callNext(pool, req.user!.id, id, parsed.data.counterName);
      res.json({ ticket: toTicket((await findTicket(pool, ticketId))!) });
    }),
  );

  return router;
}
