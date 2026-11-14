import "dotenv/config";
import { defineConfig } from "vitest/config";

// API and integration tests run against a real, migrated PostgreSQL test database (TEST_DATABASE_URL in server/.env).
const testDatabaseUrl = process.env.TEST_DATABASE_URL;
if (!testDatabaseUrl) throw new Error("TEST_DATABASE_URL is not set; fill it in server/.env (see server/.env.example).");

export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"],
    globalSetup: ["tests/global-setup.ts"],
    fileParallelism: false, // the suites share one database
    testTimeout: 20_000,
    hookTimeout: 30_000,
    env: {
      NODE_ENV: "test",
      DATABASE_URL: testDatabaseUrl,
      SESSION_SECRET: "test-only-session-secret-not-used-elsewhere",
    },
  },
});
