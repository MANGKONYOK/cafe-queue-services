import "dotenv/config";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { runner } from "node-pg-migrate";

const here = path.dirname(fileURLToPath(import.meta.url));

/** Creates the test database if needed and applies every migration before the suites run. */
export default async function setup() {
  const url = process.env.TEST_DATABASE_URL;
  if (!url) throw new Error("TEST_DATABASE_URL is not set; fill it in server/.env.");
  const target = new URL(url);
  const dbName = target.pathname.slice(1);
  const admin = new URL(url);
  admin.pathname = "/postgres";
  const client = new pg.Client({ connectionString: admin.toString() });
  try {
    await client.connect();
  } catch (err) {
    throw new Error(
      `Cannot reach the test database at ${target.hostname}:${target.port || 5432} ` +
        `(${(err as { code?: string }).code ?? "error"}). Is it running? Start it with: npm run db:up`,
    );
  }
  const exists = await client.query("SELECT 1 FROM pg_database WHERE datname = $1", [dbName]);
  if (exists.rowCount === 0) await client.query(`CREATE DATABASE "${dbName.replace(/"/g, "")}"`);
  await client.end();

  await runner({
    databaseUrl: url,
    dir: path.join(here, "..", "db", "migrations"),
    direction: "up",
    migrationsTable: "pgmigrations",
    count: Infinity,
    log: () => {},
  });
}
