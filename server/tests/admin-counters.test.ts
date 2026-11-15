import request from "supertest";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { categoryId, loginAs, makeTestApp, passwords, resetAndSeed, ticketRow } from "./helpers.js";

const { app, pool } = makeTestApp();
let SB: number, DL: number;

beforeEach(async () => {
  await resetAndSeed(pool);
  await pool.query("UPDATE service_categories SET is_open = (code <> 'ROASTERY_CONSULT')");
  [SB, DL] = await Promise.all(["SLOW_BAR", "DESSERT_LOUNGE"].map((c) => categoryId(pool, c)));
});
afterAll(() => pool.end());

const as = (email: string, kind: keyof typeof passwords) => loginAs(app, email, passwords[kind]).then((r) => r.agent);
const admin = () => as("admin@omkoi.coffee", "admin");
const userId = async (email: string) => (await pool.query("SELECT id FROM users WHERE email = $1", [email])).rows[0].id as number;
const staffOf = async (categoryId: number) =>
  (await pool.query("SELECT staff_id FROM staff_counters WHERE category_id = $1 ORDER BY staff_id", [categoryId])).rows.map((r) => r.staff_id);
const counterCount = async () => Number((await pool.query("SELECT count(*) FROM service_categories")).rows[0].count);

const tea = { code: "TEA_BAR", name: "Highland Tea Bar", prefix: "TB", description: "Loose-leaf highland teas.", estMinsPerTicket: 8 };

describe("TEST-21 / AC-17, FR-08, BR-11: admin creates a counter", () => {
  it("creates TEA_BAR/TB, lists it, and a customer's first join there is TB-001", async () => {
    const a = await admin();
    const res = await a.post("/api/categories").send(tea);
    expect(res.status).toBe(201);
    expect(res.body.category).toMatchObject({ ...tea, isOpen: true, waitingCount: 0 });

    const list = await (await as("boom@omkoi.coffee", "customer")).get("/api/categories");
    expect(list.body.categories.map((c: { code: string }) => c.code)).toContain("TEA_BAR");
    const joined = await (await as("boom@omkoi.coffee", "customer")).post("/api/tickets").send({ categoryId: res.body.category.id, partySize: 2 });
    expect(joined.status).toBe(201);
    expect(joined.body.ticket.ticketCode).toBe("TB-001");
  });

  it("refuses a duplicate code or prefix with 409 and stores nothing", async () => {
    const a = await admin();
    await a.post("/api/categories").send(tea);
    for (const body of [{ ...tea, code: "TEA_HOUSE" }, { ...tea, prefix: "TH" }]) {
      const res = await a.post("/api/categories").send(body);
      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe("DUPLICATE_CATEGORY");
    }
    expect(await counterCount()).toBe(5);
  });

  it.each([
    ["prefix", { prefix: "T" }],
    ["prefix", { prefix: "TOOLONG" }],
    ["code", { code: "tea bar" }],
    ["estMinsPerTicket", { estMinsPerTicket: 0 }],
    ["estMinsPerTicket", { estMinsPerTicket: 241 }],
    ["estMinsPerTicket", { estMinsPerTicket: 2.5 }],
    ["name", { name: "ab" }],
    ["description", { description: "d".repeat(501) }],
  ])("rejects an invalid %s with 400", async (field, change) => {
    const res = await (await admin()).post("/api/categories").send({ ...tea, ...change });
    expect(res.status).toBe(400);
    expect(res.body.error.details.fields).toHaveProperty(field);
    expect(await counterCount()).toBe(4);
  });

  it("accepts the boundaries: 1 and 240 minutes, a 3-character name, a blank description stored as null", async () => {
    const a = await admin();
    const one = await a.post("/api/categories").send({ ...tea, estMinsPerTicket: 1, name: "Tea", description: "  " });
    expect(one.status).toBe(201);
    expect(one.body.category.description).toBeNull();
    const max = await a.post("/api/categories").send({ ...tea, code: "TEA_HOUSE", prefix: "TH", estMinsPerTicket: 240, isOpen: false });
    expect(max.status).toBe(201);
    expect(max.body.category.isOpen).toBe(false);
  });
});

describe("TEST-22 / AC-18, BR-02, BR-12: admin pauses and resumes intake", () => {
  it("pausing blocks new joins but the queued guest is still called; resuming reopens joins", async () => {
    await (await as("boom@omkoi.coffee", "customer")).post("/api/tickets").send({ categoryId: SB, partySize: 2 });
    const a = await admin();

    const paused = await a.patch(`/api/categories/${SB}`).send({ isOpen: false });
    expect(paused.status).toBe(200);
    expect(paused.body.category).toMatchObject({ id: SB, isOpen: false, waitingCount: 1 });

    const hongtae = await as("hongtae@omkoi.coffee", "customer");
    const refused = await hongtae.post("/api/tickets").send({ categoryId: SB, partySize: 2 });
    expect(refused.status).toBe(409);
    expect(refused.body.error.code).toBe("CATEGORY_CLOSED");

    const called = await (await as("barista@omkoi.coffee", "staff")).post(`/api/categories/${SB}/call-next`).send({});
    expect(called.status).toBe(200);
    expect(called.body.ticket).toMatchObject({ ticketCode: "SB-001", status: "CALLED" });

    expect((await a.patch(`/api/categories/${SB}`).send({ isOpen: true })).body.category.isOpen).toBe(true);
    const joined = await hongtae.post("/api/tickets").send({ categoryId: SB, partySize: 2 });
    expect(joined.status).toBe(201);
    expect(joined.body.ticket.ticketCode).toBe("SB-002");
  });

  it("edits name, minutes and description; refuses code, prefix, an empty body and an unknown id", async () => {
    const a = await admin();
    const ok = await a.patch(`/api/categories/${SB}`).send({ name: "Slow Bar", estMinsPerTicket: 15, description: "V60 and Syphon." });
    expect(ok.status).toBe(200);
    expect(ok.body.category).toMatchObject({ name: "Slow Bar", estMinsPerTicket: 15, description: "V60 and Syphon.", prefix: "SB" });
    for (const body of [{ code: "SLOWER" }, { prefix: "SL" }, {}]) {
      expect((await a.patch(`/api/categories/${SB}`).send(body)).status).toBe(400);
    }
    expect((await a.patch("/api/categories/99999").send({ isOpen: false })).status).toBe(404);
    const row = (await pool.query("SELECT code, prefix FROM service_categories WHERE id = $1", [SB])).rows[0];
    expect(row).toEqual({ code: "SLOW_BAR", prefix: "SB" });
  });
});

describe("TEST-23 / AC-19, BR-09: admin assigns staff to counters", () => {
  it("moves SLOW_BAR to the dessert staff member: dessert may call next there, the barista may not", async () => {
    const dessertId = await userId("dessert@omkoi.coffee");
    const t = (await (await as("boom@omkoi.coffee", "customer")).post("/api/tickets").send({ categoryId: SB, partySize: 2 })).body.ticket;

    const res = await (await admin()).put(`/api/categories/${SB}/staff`).send({ staffIds: [dessertId] });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ categoryId: SB, staffIds: [dessertId] });

    const dessert = await loginAs(app, "dessert@omkoi.coffee", passwords.staff);
    expect(dessert.res.body.user.assignedCategoryIds).toEqual([SB, DL].sort((x, y) => x - y));
    expect((await (await as("barista@omkoi.coffee", "staff")).post(`/api/categories/${SB}/call-next`).send({})).status).toBe(403);
    const called = await dessert.agent.post(`/api/categories/${SB}/call-next`).send({});
    expect(called.status).toBe(200);
    expect((await ticketRow(pool, t.id)).assigned_staff_id).toBe(dessertId);
  });

  it("rejects a customer id, an admin id, duplicates and a non-array, keeping the assignments", async () => {
    const before = await staffOf(SB);
    const a = await admin();
    const bad = [
      { staffIds: [await userId("boom@omkoi.coffee")] },
      { staffIds: [await userId("admin@omkoi.coffee")] },
      { staffIds: [before[0], before[0]] },
      { staffIds: "2" },
      {},
    ];
    for (const body of bad) {
      const res = await a.put(`/api/categories/${SB}/staff`).send(body);
      expect(res.status).toBe(400);
      expect(res.body.error.details.fields).toHaveProperty("staffIds");
    }
    expect(await staffOf(SB)).toEqual(before);
    expect((await a.put("/api/categories/99999/staff").send({ staffIds: [] })).status).toBe(404);
  });

  it("lists every staff account with its counters for the admin page", async () => {
    const res = await (await admin()).get("/api/staff");
    expect(res.status).toBe(200);
    const byEmail = Object.fromEntries(res.body.staff.map((s: { email: string; categoryIds: number[] }) => [s.email, s.categoryIds]));
    expect(Object.keys(byEmail).sort()).toEqual(["barista@omkoi.coffee", "dessert@omkoi.coffee"]);
    expect(byEmail["dessert@omkoi.coffee"]).toEqual([DL]);
    expect(JSON.stringify(res.body)).not.toMatch(/password/i);
  });
});

describe("TEST-24 / AC-20: only the admin manages counters", () => {
  it("answers 403 to customers and staff, 401 to anonymous callers, and changes nothing", async () => {
    const before = await staffOf(SB);
    const calls = (agent: request.Agent | ReturnType<typeof request>) => [
      agent.post("/api/categories").send(tea),
      agent.patch(`/api/categories/${SB}`).send({ isOpen: false }),
      agent.put(`/api/categories/${SB}/staff`).send({ staffIds: [] }),
      agent.get("/api/staff"),
    ];
    for (const agent of [await as("boom@omkoi.coffee", "customer"), await as("barista@omkoi.coffee", "staff")]) {
      for (const res of await Promise.all(calls(agent))) expect(res.status).toBe(403);
    }
    for (const res of await Promise.all(calls(request(app)))) expect(res.status).toBe(401);
    expect(await counterCount()).toBe(4);
    expect((await pool.query("SELECT is_open FROM service_categories WHERE id = $1", [SB])).rows[0].is_open).toBe(true);
    expect(await staffOf(SB)).toEqual(before);
  });
});
