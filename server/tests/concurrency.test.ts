import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { categoryId, createCustomers, loginAs, makeTestApp, passwords, resetAndSeed } from "./helpers.js";

const { app, pool } = makeTestApp();
let SB: number, EB: number;

beforeEach(async () => {
  await resetAndSeed(pool);
  await pool.query("UPDATE service_categories SET is_open = (code <> 'ROASTERY_CONSULT')");
  [SB, EB] = await Promise.all(["SLOW_BAR", "ESPRESSO_BAR"].map((c) => categoryId(pool, c)));
});
afterAll(() => pool.end());

describe("TEST-18 / AC-16, AC-15, NFR-06, BR-01, BR-07: concurrency safety", () => {
  it("20 parallel joins by one customer store exactly one ticket", async () => {
    const { agent } = await loginAs(app, "boom@omkoi.coffee", passwords.customer);
    const results = await Promise.all(
      Array.from({ length: 20 }, () => agent.post("/api/tickets").send({ categoryId: SB, partySize: 2 })),
    );
    const statuses = results.map((r) => r.status).sort();
    expect(statuses.filter((s) => s === 201)).toHaveLength(1);
    expect(statuses.filter((s) => s === 409)).toHaveLength(19);
    const rows = (await pool.query("SELECT ticket_code FROM queue_tickets")).rows;
    expect(rows).toEqual([{ ticket_code: "SB-001" }]);
  });

  it("10 customers joining in parallel get 10 distinct consecutive codes", async () => {
    const emails = await createCustomers(pool, 10);
    const agents = await Promise.all(emails.map((e) => loginAs(app, e, passwords.customer).then((r) => r.agent)));
    const results = await Promise.all(agents.map((a) => a.post("/api/tickets").send({ categoryId: EB, partySize: 1 })));
    expect(results.every((r) => r.status === 201)).toBe(true);
    const codes = results.map((r) => r.body.ticket.ticketCode).sort();
    expect(codes).toEqual(Array.from({ length: 10 }, (_, i) => `EB-${String(i + 1).padStart(3, "0")}`));
  });

  it("2 parallel call-next requests call 2 different tickets", async () => {
    await (await loginAs(app, "boom@omkoi.coffee", passwords.customer)).agent.post("/api/tickets").send({ categoryId: SB, partySize: 2 });
    await (await loginAs(app, "hongtae@omkoi.coffee", passwords.customer)).agent.post("/api/tickets").send({ categoryId: SB, partySize: 2 });
    const barista = (await loginAs(app, "barista@omkoi.coffee", passwords.staff)).agent;
    const admin = (await loginAs(app, "admin@omkoi.coffee", passwords.admin)).agent;

    const [a, b] = await Promise.all([
      barista.post(`/api/categories/${SB}/call-next`).send({}),
      admin.post(`/api/categories/${SB}/call-next`).send({}),
    ]);
    expect([a.status, b.status]).toEqual([200, 200]);
    expect(a.body.ticket.id).not.toBe(b.body.ticket.id);
    const called = (await pool.query("SELECT count(*) FROM queue_tickets WHERE status = 'CALLED'")).rows[0].count;
    expect(Number(called)).toBe(2);
  });
});
