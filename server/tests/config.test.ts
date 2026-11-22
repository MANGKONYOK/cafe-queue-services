import { execFileSync, spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { ConfigError, loadConfig } from "../src/config.js";
import { SeedError, seedPasswordsFromEnv } from "../src/db/seed.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "..", "..");
const base = { DATABASE_URL: "postgresql://localhost/x", PORT: "3000" };

describe("TEST-20 / NFR-02: configuration from the environment, no committed secrets", () => {
  it("refuses production without a real SESSION_SECRET", () => {
    for (const secret of [undefined, "", "change-me", "too-short"]) {
      expect(() => loadConfig({ ...base, NODE_ENV: "production", SESSION_SECRET: secret })).toThrow(ConfigError);
    }
    const ok = loadConfig({ ...base, NODE_ENV: "production", SESSION_SECRET: "x".repeat(32) });
    expect(ok.isProduction).toBe(true);
  });

  it("requires DATABASE_URL and SESSION_SECRET in every environment", () => {
    expect(() => loadConfig({ NODE_ENV: "development", SESSION_SECRET: "s" })).toThrow(ConfigError);
    expect(() => loadConfig({ NODE_ENV: "development", DATABASE_URL: "postgresql://localhost/x" })).toThrow(ConfigError);
    expect(loadConfig({ ...base, NODE_ENV: "development", SESSION_SECRET: "change-me" }).port).toBe(3000);
  });

  it("reads the PostgreSQL pool size from PG_POOL_MAX, default 10 (deployment design D-1)", () => {
    const dev = { ...base, NODE_ENV: "development", SESSION_SECRET: "s" };
    expect(loadConfig(dev).poolMax).toBe(10);
    expect(loadConfig({ ...dev, PG_POOL_MAX: "" }).poolMax).toBe(10);
    expect(loadConfig({ ...dev, PG_POOL_MAX: "5" }).poolMax).toBe(5);
    for (const bad of ["0", "-1", "2.5", "51", "five"]) {
      expect(() => loadConfig({ ...dev, PG_POOL_MAX: bad })).toThrow(ConfigError);
    }
  });

  it("reads APP_VERSION as the running release, \"dev\" when unset (C-06, R-08)", () => {
    const dev = { ...base, NODE_ENV: "development", SESSION_SECRET: "s" };
    expect(loadConfig(dev).appVersion).toBe("dev");
    expect(loadConfig({ ...dev, APP_VERSION: "" }).appVersion).toBe("dev");
    const sha = "bd2f69e93c3913d55840017289d68a61049a4e75";
    expect(loadConfig({ ...dev, APP_VERSION: sha }).appVersion).toBe(sha);
    expect(() => loadConfig({ ...dev, APP_VERSION: "x".repeat(65) })).toThrow(ConfigError);
  });

  it("exits the server process at startup in production without a secret", () => {
    const run = spawnSync(process.execPath, ["--import", "tsx", "src/index.ts"], {
      cwd: path.resolve(here, ".."),
      // Keep the full environment (Windows needs SystemRoot/TEMP for tsx's IPC pipe), override only what is tested.
      env: { ...process.env, NODE_ENV: "production", DATABASE_URL: base.DATABASE_URL, SESSION_SECRET: "change-me" },
      encoding: "utf8",
      timeout: 15_000,
    });
    expect(run.status).toBe(1);
    expect(run.stderr).toMatch(/SESSION_SECRET/);
  });

  it("refuses to seed without the SEED_* passwords", () => {
    expect(() => seedPasswordsFromEnv({})).toThrow(SeedError);
    expect(() =>
      seedPasswordsFromEnv({ NODE_ENV: "production", SEED_ADMIN_PASSWORD: "change-me", SEED_STAFF_PASSWORD: "a", SEED_CUSTOMER_PASSWORD: "b" }),
    ).toThrow(SeedError);
  });

  it("finds no secret in the tracked files (scripts/check-secrets.sh)", () => {
    // A relative POSIX path: bash on Windows cannot run a "C:\\..." backslash path.
    const out = execFileSync("bash", ["scripts/check-secrets.sh"], { cwd: repoRoot, encoding: "utf8" });
    expect(out).toMatch(/no secrets found/);
  });
});
