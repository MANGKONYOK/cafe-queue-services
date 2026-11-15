import type { Pool } from "../db/pool.js";
import type { AuthUser } from "../middleware/auth.js";

/** BR-09: ADMIN operates every counter; STAFF only those in staff_counters; CUSTOMER none. */
export async function canOperate(pool: Pool, user: AuthUser, categoryId: number): Promise<boolean> {
  if (user.role === "ADMIN") return true;
  if (user.role !== "STAFF") return false;
  const { rowCount } = await pool.query("SELECT 1 FROM staff_counters WHERE staff_id = $1 AND category_id = $2", [user.id, categoryId]);
  return (rowCount ?? 0) > 0;
}

/** Counters the user may operate (for the staff console tabs); undefined for customers. */
export async function assignedCategoryIds(pool: Pool, user: AuthUser): Promise<number[] | undefined> {
  if (user.role === "CUSTOMER") return undefined;
  const { rows } =
    user.role === "ADMIN"
      ? await pool.query("SELECT id FROM service_categories ORDER BY id")
      : await pool.query("SELECT category_id AS id FROM staff_counters WHERE staff_id = $1 ORDER BY category_id", [user.id]);
  return rows.map((r) => r.id as number);
}

/** The user object the API returns: customers unchanged; staff and admin also get their counters. */
export async function publicUser(pool: Pool, user: AuthUser) {
  const ids = await assignedCategoryIds(pool, user);
  return ids ? { ...user, assignedCategoryIds: ids } : user;
}
