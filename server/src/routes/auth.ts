import bcrypt from "bcryptjs";
import { Router, type Request } from "express";
import { z } from "zod";
import type { Config } from "../config.js";
import type { Pool } from "../db/pool.js";
import { AppError, asyncHandler, validationError } from "../errors.js";
import { requireAuth, toAuthUser } from "../middleware/auth.js";
import { SESSION_COOKIE, clearCookieOptions } from "../session.js";

const loginBody = z.object({
  email: z.string().trim().toLowerCase().min(1, "Email is required.").max(120),
  password: z.string().min(1, "Password is required.").max(200),
});

// Compared against when the email is unknown, so both failures take the same time.
const DUMMY_HASH = bcrypt.hashSync("omkoi-timing-equaliser", 10);

const invalidCredentials = () => new AppError(401, "INVALID_CREDENTIALS", "Invalid email or password.");

const fieldErrors = (error: z.ZodError) =>
  Object.fromEntries(error.issues.map((i) => [String(i.path[0] ?? "body"), i.message]));

const regenerate = (req: Request) =>
  new Promise<void>((resolve, reject) => req.session.regenerate((err) => (err ? reject(err) : resolve())));
const save = (req: Request) =>
  new Promise<void>((resolve, reject) => req.session.save((err) => (err ? reject(err) : resolve())));
const destroy = (req: Request) =>
  new Promise<void>((resolve, reject) => req.session.destroy((err) => (err ? reject(err) : resolve())));

export function authRouter(config: Config, pool: Pool) {
  const router = Router();

  router.post(
    "/login",
    asyncHandler(async (req, res) => {
      const parsed = loginBody.safeParse(req.body ?? {});
      if (!parsed.success) throw validationError(fieldErrors(parsed.error));
      const { email, password } = parsed.data;

      const { rows } = await pool.query(
        "SELECT id, email, full_name, role, password_hash FROM users WHERE email = $1",
        [email],
      );
      const row = rows[0];
      const ok = await bcrypt.compare(password, row?.password_hash ?? DUMMY_HASH);
      if (!row || !ok) throw invalidCredentials();

      await regenerate(req); // new session id on every login (no fixation)
      req.session.userId = row.id;
      req.session.loginAt = Date.now();
      await save(req);
      res.json({ user: toAuthUser(row) });
    }),
  );

  router.get("/me", requireAuth(pool), (req, res) => {
    res.json({ user: req.user });
  });

  router.post(
    "/logout",
    requireAuth(pool),
    asyncHandler(async (req, res) => {
      await destroy(req);
      res.clearCookie(SESSION_COOKIE, clearCookieOptions(config));
      res.json({ status: "logged_out" });
    }),
  );

  return router;
}
