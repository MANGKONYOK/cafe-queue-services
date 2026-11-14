import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { loginAs, makeTestApp, passwords, resetAndSeed } from "./helpers.js";

const { app, pool } = makeTestApp();

beforeAll(async () => {
  await resetAndSeed(pool);
  // The suite sets the fixture it relies on instead of trusting earlier runs (STS section 1).
  await pool.query("UPDATE service_categories SET is_open = (code <> 'ROASTERY_CONSULT')");
});
afterAll(() => pool.end());

describe("TEST-03 / AC-03: service category directory", () => {
  it.each([
    ["boom@omkoi.coffee", "customer"],
    ["barista@omkoi.coffee", "staff"],
    ["admin@omkoi.coffee", "admin"],
  ] as const)("lists the 4 counters for %s", async (email, kind) => {
    const { agent } = await loginAs(app, email, passwords[kind]);
    const res = await agent.get("/api/categories");

    expect(res.status).toBe(200);
    const cats = res.body.categories;
    expect(cats.map((c: { code: string }) => c.code)).toEqual(["SLOW_BAR", "ESPRESSO_BAR", "DESSERT_LOUNGE", "ROASTERY_CONSULT"]);
    expect(cats.map((c: { prefix: string }) => c.prefix)).toEqual(["SB", "EB", "DL", "RC"]);
    for (const c of cats) {
      expect(Object.keys(c).sort()).toEqual(["code", "description", "estMinsPerTicket", "id", "isOpen", "name", "prefix"]);
      expect(c.estMinsPerTicket).toBeGreaterThan(0);
    }
    expect(cats.find((c: { code: string }) => c.code === "ROASTERY_CONSULT").isOpen).toBe(false);
    expect(cats.filter((c: { isOpen: boolean }) => c.isOpen)).toHaveLength(3);
  });
});

describe("TEST-12 / NFR-04: health and readiness", () => {
  it("answers /api/health and /api/ready with 200 in under 500 ms without a session", async () => {
    let start = Date.now();
    const health = await request(app).get("/api/health");
    expect(Date.now() - start).toBeLessThan(500);
    expect(health.status).toBe(200);
    expect(health.body).toEqual({ status: "ok" });

    start = Date.now();
    const ready = await request(app).get("/api/ready");
    expect(Date.now() - start).toBeLessThan(500);
    expect(ready.status).toBe(200);
    expect(ready.body).toEqual({ status: "ready", db: "connected" });
  });

  it("answers /api/ready with 503 when the database is unreachable", async () => {
    const down = makeTestApp("postgresql://127.0.0.1:1/omkoi_unreachable");
    const res = await request(down.app).get("/api/ready");
    expect(res.status).toBe(503);
    expect(res.body).toEqual({ status: "not_ready", db: "disconnected" });
    await down.pool.end();
  });
});
