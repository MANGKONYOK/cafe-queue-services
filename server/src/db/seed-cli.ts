import "dotenv/config";
import { createPool } from "./pool.js";
import { seed, SeedError, seedPasswordsFromEnv } from "./seed.js";

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL is not set.");
  process.exit(1);
}
const pool = createPool(url);
try {
  await seed(pool, seedPasswordsFromEnv());
  console.log("Seeded 5 accounts and 4 service categories.");
} catch (err) {
  console.error(err instanceof SeedError ? err.message : err);
  process.exitCode = 1;
} finally {
  await pool.end();
}
