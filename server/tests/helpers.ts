import { randomBytes } from "node:crypto";
import request from "supertest";
import { createApp } from "../src/app.js";
import { loadConfig } from "../src/config.js";
import { createPool, type Pool } from "../src/db/pool.js";
import { seed, type SeedPasswords } from "../src/db/seed.js";

/** Test-only passwords, generated per run; never written anywhere. */
export const passwords: SeedPasswords = {
  admin: randomBytes(12).toString("hex"),
  staff: randomBytes(12).toString("hex"),
  customer: randomBytes(12).toString("hex"),
};

export function makeTestApp(databaseUrl = process.env.DATABASE_URL!) {
  const config = loadConfig({ ...process.env, DATABASE_URL: databaseUrl });
  const pool = createPool(config.databaseUrl);
  const app = createApp({ config, pool });
  return { app, pool, config };
}

/** Each suite starts from an empty, freshly seeded database. */
export async function resetAndSeed(pool: Pool) {
  await pool.query("TRUNCATE users, user_sessions, service_categories RESTART IDENTITY CASCADE");
  await seed(pool, passwords);
}

/** Logs in and returns a supertest agent that keeps the session cookie. */
export async function loginAs(app: Parameters<typeof request.agent>[0], email: string, password: string) {
  const agent = request.agent(app);
  const res = await agent.post("/api/auth/login").send({ email, password });
  return { agent, res };
}
