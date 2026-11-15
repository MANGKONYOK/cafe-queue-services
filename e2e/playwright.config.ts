import { randomBytes } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "@playwright/test";
import dotenv from "dotenv";

const here = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(here, "..", "server", ".env"), quiet: true });

// The journey runs against the separate test database (never development data).
const database = process.env.TEST_DATABASE_URL;
if (!database) throw new Error("TEST_DATABASE_URL is not set; fill it in server/.env.");

// Per-run random passwords; workers inherit them from this process's environment.
for (const key of ["E2E_ADMIN_PASSWORD", "E2E_STAFF_PASSWORD", "E2E_CUSTOMER_PASSWORD", "E2E_SESSION_SECRET"]) {
  process.env[key] ??= randomBytes(16).toString("hex");
}

const PORT = 3100;

export default defineConfig({
  testDir: ".",
  testMatch: "*.spec.ts",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [["list"]],
  use: {
    baseURL: `http://localhost:${PORT}`,
    channel: "chrome", // the installed Google Chrome; no browser download
    trace: "retain-on-failure",
  },
  // NFR-05 viewports. Each project uses a different counter so every run starts at <PREFIX>-001.
  projects: [
    { name: "mobile-375", use: { viewport: { width: 375, height: 667 } }, testIgnore: /admin-counters/ },
    { name: "tablet-768", use: { viewport: { width: 768, height: 1024 } }, testIgnore: /admin-counters/ },
    { name: "desktop-1280", use: { viewport: { width: 1280, height: 800 } } },
  ],
  webServer: {
    // Build the client, reset + seed the test database, then serve API and client from one origin.
    command: "npm --prefix ../client run build && cd ../server && npx tsx tests/e2e-reset.ts && npx tsx src/index.ts",
    url: `http://localhost:${PORT}/api/ready`,
    reuseExistingServer: false,
    timeout: 120_000,
    env: {
      NODE_ENV: "development",
      PORT: String(PORT),
      DATABASE_URL: database,
      TEST_DATABASE_URL: database,
      SESSION_SECRET: process.env.E2E_SESSION_SECRET!,
      SEED_ADMIN_PASSWORD: process.env.E2E_ADMIN_PASSWORD!,
      SEED_STAFF_PASSWORD: process.env.E2E_STAFF_PASSWORD!,
      SEED_CUSTOMER_PASSWORD: process.env.E2E_CUSTOMER_PASSWORD!,
    },
  },
});
