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

  it("exits the server process at startup in production without a secret", () => {
    const run = spawnSync(process.execPath, ["--import", "tsx", "src/index.ts"], {
      cwd: path.resolve(here, ".."),
      env: { PATH: process.env.PATH, NODE_ENV: "production", DATABASE_URL: base.DATABASE_URL, SESSION_SECRET: "change-me" },
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
    const out = execFileSync("bash", [path.join(repoRoot, "scripts", "check-secrets.sh")], { cwd: repoRoot, encoding: "utf8" });
    expect(out).toMatch(/no secrets found/);
  });
});
