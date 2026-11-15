import type { NextFunction, Request, RequestHandler, Response } from "express";
import type { Pool } from "../db/pool.js";
import { asyncHandler, forbidden, unauthorized } from "../errors.js";

export type Role = "CUSTOMER" | "STAFF" | "ADMIN";

export interface AuthUser {
  id: number;
  email: string;
  fullName: string;
  role: Role;
}

/** Absolute session lifetime from login (SDS 5); activity does not extend it. */
export const SESSION_TTL_MS = 8 * 60 * 60 * 1000;

declare module "express-session" {
  interface SessionData {
    userId: number;
    loginAt: number;
  }
}

declare module "express-serve-static-core" {
  interface Request {
    user?: AuthUser;
  }
}

export const toAuthUser = (r: { id: number; email: string; full_name: string; role: Role }): AuthUser => ({
  id: r.id,
  email: r.email,
  fullName: r.full_name,
  role: r.role,
});

const destroy = (req: Request) =>
  new Promise<void>((resolve) => (req.session ? req.session.destroy(() => resolve()) : resolve()));

/**
 * 401 unless the request carries a live session. The user and role are always loaded
 * from the database, never taken from the client.
 */
export function requireAuth(pool: Pool): RequestHandler {
  return asyncHandler(async (req: Request, _res: Response, next: NextFunction) => {
    const { userId, loginAt } = req.session ?? {};
    if (!userId || !loginAt) throw unauthorized();
    if (Date.now() - loginAt > SESSION_TTL_MS) {
      await destroy(req);
      throw unauthorized();
    }
    const { rows } = await pool.query("SELECT id, email, full_name, role FROM users WHERE id = $1", [userId]);
    if (!rows[0]) {
      await destroy(req);
      throw unauthorized();
    }
    req.user = toAuthUser(rows[0]);
    next();
  });
}

/** 403 when the signed-in user's role is not one of `roles`. Use after requireAuth. */
export const requireRole =
  (...roles: Role[]): RequestHandler =>
  (req, _res, next) => {
    if (!req.user) return next(unauthorized());
    if (!roles.includes(req.user.role)) return next(forbidden());
    next();
  };
