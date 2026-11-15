import { Router } from "express";
import type { Pool } from "../db/pool.js";
import { asyncHandler } from "../errors.js";
import { requireAuth } from "../middleware/auth.js";

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

  return router;
}
