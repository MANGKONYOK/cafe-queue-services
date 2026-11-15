import { Router } from "express";
import type { Pool } from "../db/pool.js";
import { asyncHandler } from "../errors.js";
import { requireAuth, requireRole } from "../middleware/auth.js";

/** FR-08: STAFF accounts and their counters, for the admin's assignment checkboxes. */
export function staffRouter(pool: Pool) {
  const router = Router();
  router.get(
    "/",
    requireAuth(pool),
    requireRole("ADMIN"),
    asyncHandler(async (_req, res) => {
      const { rows } = await pool.query(
        `SELECT u.id, u.full_name, u.email,
                COALESCE(array_agg(sc.category_id ORDER BY sc.category_id)
                         FILTER (WHERE sc.category_id IS NOT NULL), '{}') AS category_ids
         FROM users u LEFT JOIN staff_counters sc ON sc.staff_id = u.id
         WHERE u.role = 'STAFF'
         GROUP BY u.id ORDER BY u.id`,
      );
      res.json({
        staff: rows.map((r) => ({ id: r.id, fullName: r.full_name, email: r.email, categoryIds: r.category_ids })),
      });
    }),
  );
  return router;
}
