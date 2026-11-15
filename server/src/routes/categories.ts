import { Router } from "express";
import { z } from "zod";
import type { Pool } from "../db/pool.js";
import { withTx } from "../db/tx.js";
import { AppError, asyncHandler, forbidden, notFound, validationError, zodFields } from "../errors.js";
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

// F-04 / BR-11: counter fields and their limits.
const fields = {
  name: z.string({ error: "name is required." }).trim().min(3, "name must be 3-120 characters.").max(120, "name must be 3-120 characters."),
  description: z
    .string()
    .trim()
    .max(500, "description must be at most 500 characters.")
    .nullish()
    .transform((v) => (v ? v : null)),
  estMinsPerTicket: z.number({ error: "estMinsPerTicket must be an integer from 1 to 240." }).int().min(1).max(240),
  isOpen: z.boolean({ error: "isOpen must be true or false." }),
};
const createBody = z.object({
  code: z
    .string({ error: "code is required." })
    .trim()
    .regex(/^[A-Z][A-Z0-9_]{2,29}$/, "code must be 3-30 characters: A-Z, 0-9 or _, starting with a letter."),
  prefix: z.string({ error: "prefix is required." }).trim().regex(/^[A-Z]{2,5}$/, "prefix must be 2-5 letters A-Z."),
  ...fields,
  isOpen: fields.isOpen.default(true),
});
const patchBody = z
  .object({ name: fields.name, description: fields.description, estMinsPerTicket: fields.estMinsPerTicket, isOpen: fields.isOpen })
  .partial()
  .strict()
  .refine((b) => Object.keys(b).length > 0, {
    message: "Send at least one of name, description, estMinsPerTicket, isOpen.",
    path: ["body"],
  });
const staffBody = z.object({
  staffIds: z
    .array(z.number().int().positive(), { error: "staffIds must be an array of staff ids." })
    .refine((ids) => new Set(ids).size === ids.length, "staffIds must not repeat."),
});

const duplicateCategory = () => new AppError(409, "DUPLICATE_CATEGORY", "A counter with this code or prefix already exists.");

const SELECT_CATEGORY = `
  SELECT c.id, c.code, c.name, c.prefix, c.description, c.est_mins_per_ticket, c.is_open,
         (SELECT count(*)::int FROM queue_tickets t WHERE t.category_id = c.id AND t.status = 'WAITING') AS waiting_count
  FROM service_categories c`;

const toCategory = (r: Record<string, any>) => ({
  id: r.id,
  code: r.code,
  name: r.name,
  prefix: r.prefix,
  description: r.description,
  estMinsPerTicket: r.est_mins_per_ticket,
  isOpen: r.is_open,
  waitingCount: r.waiting_count,
});

const parse = <T extends z.ZodTypeAny>(schema: T, value: unknown): z.infer<T> => {
  const r = schema.safeParse(value ?? {});
  if (!r.success) throw validationError(zodFields(r.error.issues));
  return r.data;
};

const categoryIdParam = (raw: string) => {
  const id = Number(raw);
  return Number.isInteger(id) && id > 0 && id <= 2147483647 ? id : null;
};

const PATCH_COLUMNS: Record<string, string> = {
  name: "name",
  description: "description",
  estMinsPerTicket: "est_mins_per_ticket",
  isOpen: "is_open",
};

export function categoriesRouter(pool: Pool) {
  const router = Router();
  const findCategory = async (id: number | null) =>
    id ? (await pool.query(`${SELECT_CATEGORY} WHERE c.id = $1`, [id])).rows[0] : undefined;

  // FR-02: read-only directory for every signed-in role, with the queue length (C-19).
  router.get(
    "/",
    requireAuth(pool),
    asyncHandler(async (_req, res) => {
      const { rows } = await pool.query(`${SELECT_CATEGORY} ORDER BY c.id`);
      res.json({ categories: rows.map(toCategory) });
    }),
  );

  // FR-08 / BR-11: the admin creates a counter; its numbering starts at <PREFIX>-001.
  router.post(
    "/",
    requireAuth(pool),
    requireRole("ADMIN"),
    asyncHandler(async (req, res) => {
      const b = parse(createBody, req.body);
      try {
        const { rows } = await pool.query(
          `INSERT INTO service_categories (code, name, prefix, description, est_mins_per_ticket, is_open)
           VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
          [b.code, b.name, b.prefix, b.description, b.estMinsPerTicket, b.isOpen],
        );
        res.status(201).json({ category: toCategory(await findCategory(rows[0].id)) });
      } catch (err) {
        if ((err as { code?: string }).code === "23505") throw duplicateCategory();
        throw err;
      }
    }),
  );

  // FR-08 / BR-12: edit or pause/resume. Code and prefix never change (BR-11).
  router.patch(
    "/:id",
    requireAuth(pool),
    requireRole("ADMIN"),
    asyncHandler(async (req, res) => {
      const id = categoryIdParam(req.params.id);
      if (!(await findCategory(id))) throw notFound();
      const body = req.body ?? {};
      for (const fixed of ["code", "prefix"]) {
        if (fixed in body) throw validationError({ [fixed]: `${fixed} cannot be changed after the counter is created.` });
      }
      const b = parse(patchBody, body);
      const sets: string[] = [];
      const params: unknown[] = [id];
      for (const [key, value] of Object.entries(b)) sets.push(`${PATCH_COLUMNS[key]} = $${params.push(value)}`);
      await pool.query(`UPDATE service_categories SET ${sets.join(", ")}, updated_at = CURRENT_TIMESTAMP WHERE id = $1`, params);
      res.json({ category: toCategory(await findCategory(id)) });
    }),
  );

  // FR-08 / BR-09: replace the set of STAFF accounts operating this counter.
  router.put(
    "/:id/staff",
    requireAuth(pool),
    requireRole("ADMIN"),
    asyncHandler(async (req, res) => {
      const id = categoryIdParam(req.params.id);
      if (!(await findCategory(id))) throw notFound();
      const { staffIds } = parse(staffBody, req.body);
      if (staffIds.length) {
        const { rowCount } = await pool.query("SELECT 1 FROM users WHERE id = ANY($1) AND role = 'STAFF'", [staffIds]);
        if (rowCount !== staffIds.length) throw validationError({ staffIds: "Every id must belong to a STAFF account." });
      }
      await withTx(pool, async (c) => {
        await c.query("DELETE FROM staff_counters WHERE category_id = $1", [id]);
        if (staffIds.length) {
          await c.query("INSERT INTO staff_counters (staff_id, category_id) SELECT unnest($1::int[]), $2", [staffIds, id]);
        }
      });
      res.json({ categoryId: id, staffIds: [...staffIds].sort((x, y) => x - y) });
    }),
  );

  // FR-07 / BR-10: call the oldest WAITING guest of this counter. Order: 403 role -> 403 scope -> 404 -> 400 -> 409.
  router.post(
    "/:id/call-next",
    requireAuth(pool),
    requireRole("STAFF", "ADMIN"),
    asyncHandler(async (req, res) => {
      const user = req.user!;
      const id = categoryIdParam(req.params.id);
      if (!id) throw user.role === "ADMIN" ? notFound() : forbidden();
      if (!(await canOperate(pool, user, id))) throw forbidden(); // staff on an unassigned (or unknown) counter
      if (!(await findCategory(id))) throw notFound();
      const parsed = callNextBody.safeParse(req.body ?? {});
      if (!parsed.success) throw validationError(zodFields(parsed.error.issues));
      const ticketId = await callNext(pool, user.id, id, parsed.data.counterName);
      res.json({ ticket: toTicket((await findTicket(pool, ticketId))!) });
    }),
  );

  return router;
}
