// Prepares the test database for the Playwright journey (TEST-19): migrate, empty, seed.
// Run by e2e/playwright.config.ts before it starts the server; not a Vitest suite.
import { createPool } from "../src/db/pool.js";
import { seed, seedPasswordsFromEnv } from "../src/db/seed.js";
import migrate from "./global-setup.js";

await migrate();
const pool = createPool(process.env.DATABASE_URL!);
await pool.query("TRUNCATE users, user_sessions, service_categories RESTART IDENTITY CASCADE");
await seed(pool, seedPasswordsFromEnv());
await pool.end();
console.log("e2e database reset and seeded");
