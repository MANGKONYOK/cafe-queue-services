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

export async function categoryId(pool: Pool, code: string): Promise<number> {
  const { rows } = await pool.query("SELECT id FROM service_categories WHERE code = $1", [code]);
  return rows[0].id;
}

/** Extra customers sharing the seeded customer password (copies boom's hash; no extra bcrypt work). */
export async function createCustomers(pool: Pool, n: number): Promise<string[]> {
  const emails = Array.from({ length: n }, (_, i) => `guest${String(i + 1).padStart(2, "0")}@test.omkoi.coffee`);
  await pool.query(
    `INSERT INTO users (email, full_name, role, password_hash)
     SELECT e, 'Guest ' || right(split_part(e, '@', 1), 2), 'CUSTOMER',
            (SELECT password_hash FROM users WHERE email = 'boom@omkoi.coffee')
     FROM unnest($1::text[]) AS e`,
    [emails],
  );
  return emails;
}

/** Fixture shortcut: put a ticket straight into a status without going through the API. */
export async function setTicketStatus(pool: Pool, id: number, status: string) {
  await pool.query("UPDATE queue_tickets SET status = $2 WHERE id = $1", [id, status]);
}

export async function ticketRow(pool: Pool, id: number) {
  return (await pool.query("SELECT * FROM queue_tickets WHERE id = $1", [id])).rows[0];
}

export async function eventsOf(pool: Pool, id: number) {
  return (await pool.query("SELECT * FROM ticket_events WHERE ticket_id = $1 ORDER BY id", [id])).rows;
}
