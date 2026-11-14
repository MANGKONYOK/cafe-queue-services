import bcrypt from "bcryptjs";
import type { Pool } from "./pool.js";

export const BCRYPT_COST = 10; // NFR-01

export interface SeedPasswords {
  admin: string;
  staff: string;
  customer: string;
}

export class SeedError extends Error {}

/** Seed passwords come only from the environment; there is no fallback value (NFR-02). */
export function seedPasswordsFromEnv(env: NodeJS.ProcessEnv = process.env): SeedPasswords {
  const pick = (name: string) => {
    const value = env[name];
    if (!value) throw new SeedError(`${name} is not set; refusing to seed.`); // empty counts as not set
    if (env.NODE_ENV === "production" && value === "change-me") {
      throw new SeedError(`${name} is still the placeholder; refusing to seed in production.`);
    }
    return value;
  };
  return {
    admin: pick("SEED_ADMIN_PASSWORD"),
    staff: pick("SEED_STAFF_PASSWORD"),
    customer: pick("SEED_CUSTOMER_PASSWORD"),
  };
}

const CATEGORIES = [
  ["SLOW_BAR", "Omkoi Specialty Slow Bar (Pour-Over & Syphon)", "SB",
    "Handcrafted V60, Origami and Syphon single-origin highland micro-lots.", 12, true],
  ["ESPRESSO_BAR", "Highland Espresso & Artisan Beverage Bar", "EB",
    "Speed-bar espresso, Omkoi Dirty Coffee and artisan ceremonial matcha.", 5, true],
  ["DESSERT_LOUNGE", "Chiang Rai Mist Tea & Highland Dessert Table", "DL",
    "Seated table service for northern pastries and artisanal loose-leaf teas.", 15, true],
  ["ROASTERY_CONSULT", "Omkoi Roastery & Bean Wholesale Consultation", "RC",
    "1-on-1 green and roasted bean cupping and wholesale consultation.", 20, false],
] as const;

/**
 * Idempotent seed (SDS 2.4): upserts on natural keys and never inserts explicit ids,
 * so SERIAL sequences stay correct. A re-seed does not overwrite `is_open`.
 */
export async function seed(pool: Pool, passwords: SeedPasswords): Promise<void> {
  const [admin, staff, customer] = await Promise.all([
    bcrypt.hash(passwords.admin, BCRYPT_COST),
    bcrypt.hash(passwords.staff, BCRYPT_COST),
    bcrypt.hash(passwords.customer, BCRYPT_COST),
  ]);
  const users: [string, string, string, string][] = [
    ["admin@omkoi.coffee", "Khun Mee", "ADMIN", admin],
    ["barista@omkoi.coffee", "Khun Noble", "STAFF", staff],
    ["dessert@omkoi.coffee", "Khun Fah", "STAFF", staff],
    ["boom@omkoi.coffee", "Boom", "CUSTOMER", customer],
    ["hongtae@omkoi.coffee", "Hongtae", "CUSTOMER", customer],
  ];
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    for (const [email, fullName, role, hash] of users) {
      await client.query(
        `INSERT INTO users (email, full_name, role, password_hash) VALUES ($1, $2, $3, $4)
         ON CONFLICT (email) DO UPDATE SET full_name = EXCLUDED.full_name, role = EXCLUDED.role,
           password_hash = EXCLUDED.password_hash`,
        [email, fullName, role, hash],
      );
    }
    for (const [code, name, prefix, description, est, isOpen] of CATEGORIES) {
      await client.query(
        `INSERT INTO service_categories (code, name, prefix, description, est_mins_per_ticket, is_open)
         VALUES ($1, $2, $3, $4, $5, $6)
         ON CONFLICT (code) DO UPDATE SET name = EXCLUDED.name, description = EXCLUDED.description,
           est_mins_per_ticket = EXCLUDED.est_mins_per_ticket, updated_at = CURRENT_TIMESTAMP`,
        [code, name, prefix, description, est, isOpen],
      );
    }
    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}
