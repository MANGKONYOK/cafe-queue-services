import connectPgSimple from "connect-pg-simple";
import session from "express-session";
import type { Config } from "./config.js";
import type { Pool } from "./db/pool.js";
import { SESSION_TTL_MS } from "./middleware/auth.js";

export const SESSION_COOKIE = "connect.sid";

/** PostgreSQL-backed sessions (SRS decision 2, SDS 5). */
export function sessionMiddleware(config: Config, pool: Pool) {
  const PgStore = connectPgSimple(session);
  return session({
    name: SESSION_COOKIE,
    secret: config.sessionSecret,
    store: new PgStore({
      pool,
      tableName: "user_sessions",
      createTableIfMissing: false, // created by migration 001
      pruneSessionInterval: config.nodeEnv === "test" ? false : 15 * 60,
    }),
    resave: false,
    saveUninitialized: false,
    rolling: false,
    cookie: {
      httpOnly: true,
      sameSite: "lax",
      secure: config.isProduction,
      maxAge: SESSION_TTL_MS,
    },
  });
}

export const clearCookieOptions = (config: Config) =>
  ({ path: "/", httpOnly: true, sameSite: "lax", secure: config.isProduction }) as const;
