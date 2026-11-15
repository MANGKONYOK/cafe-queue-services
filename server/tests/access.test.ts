import request from "supertest";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { categoryId, eventsOf, loginAs, makeTestApp, passwords, resetAndSeed, setTicketStatus, ticketRow } from "./helpers.js";

const { app, pool } = makeTestApp();
let SB: number, EB: number, DL: number;

beforeEach(async () => {
  await resetAndSeed(pool);
  await pool.query("UPDATE service_categories SET is_open = (code <> 'ROASTERY_CONSULT')");
  [SB, EB, DL] = await Promise.all(["SLOW_BAR", "ESPRESSO_BAR", "DESSERT_LOUNGE"].map((c) => categoryId(pool, c)));
});
afterAll(() => pool.end());

const as = (email: string, kind: keyof typeof passwords) => loginAs(app, email, passwords[kind]).then((r) => r.agent);
const join = async (agent: request.Agent, categoryId: number) =>
  (await agent.post("/api/tickets").send({ categoryId, partySize: 2 })).body.ticket;

describe("TEST-09 / AC-09, BR-06: customer ownership and staff-only operations", () => {
  it("rejects every attempt by boom on hongtae's ticket and on staff endpoints with 403, changing nothing", async () => {
    const theirs = await join(await as("hongtae@omkoi.coffee", "customer"), SB);
    const boom = await as("boom@omkoi.coffee", "customer");

    const attempts = [
      boom.get(`/api/tickets/${theirs.id}`),
      boom.post(`/api/tickets/${theirs.id}/cancel`).send({ cancelReason: "Not mine" }),
      boom.get("/api/tickets"),
      boom.post(`/api/categories/${SB}/call-next`).send({}),
      boom.post(`/api/tickets/${theirs.id}/serve`).send({}),
      boom.post(`/api/tickets/${theirs.id}/complete`).send({ completionSummary: "Served a coffee" }),
      boom.post(`/api/tickets/${theirs.id}/no-show`).send({ noShowNote: "Not here" }),
    ];
    for (const res of await Promise.all(attempts)) {
      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe("FORBIDDEN");
      expect(res.body.ticket).toBeUndefined();
      expect(res.body.tickets).toBeUndefined();
    }
    expect((await ticketRow(pool, theirs.id)).status).toBe("WAITING");
    expect(await eventsOf(pool, theirs.id)).toHaveLength(1);
  });

  it("answers 403, not 404, for a ticket id that does not exist (no existence leak)", async () => {
    const res = await (await as("boom@omkoi.coffee", "customer")).get("/api/tickets/999999");
    expect(res.status).toBe(403);
  });

  it("lists only the caller's own tickets in /my", async () => {
    await join(await as("hongtae@omkoi.coffee", "customer"), SB);
    const boom = await as("boom@omkoi.coffee", "customer");
    await join(boom, EB);
    const my = await boom.get("/api/tickets/my");
    expect(my.body.tickets.map((t: { ticketCode: string }) => t.ticketCode)).toEqual(["EB-001"]);
  });
});

describe("TEST-16 / AC-14, BR-09: staff act only on their assigned counters", () => {
  it("refuses the SB/EB barista everything on DESSERT_LOUNGE", async () => {
    const dl = await join(await as("boom@omkoi.coffee", "customer"), DL);
    const dlCalled = await join(await as("hongtae@omkoi.coffee", "customer"), DL);
    await setTicketStatus(pool, dlCalled.id, "CALLED");
    const barista = await as("barista@omkoi.coffee", "staff");

    const attempts = [
      barista.post(`/api/categories/${DL}/call-next`).send({}),
      barista.get(`/api/tickets?categoryId=${DL}`),
      barista.get(`/api/tickets/${dl.id}`),
      barista.post(`/api/tickets/${dlCalled.id}/serve`).send({}),
      barista.post(`/api/tickets/${dlCalled.id}/no-show`).send({ noShowNote: "Guest absent" }),
      barista.post(`/api/tickets/${dl.id}/cancel`).send({ cancelReason: "Counter closed" }),
    ];
    for (const res of await Promise.all(attempts)) expect(res.status).toBe(403);
    expect((await ticketRow(pool, dl.id)).status).toBe("WAITING");
    expect((await ticketRow(pool, dlCalled.id)).status).toBe("CALLED");
  });

  it("refuses ticket creation by staff and admin", async () => {
    for (const agent of [await as("barista@omkoi.coffee", "staff"), await as("admin@omkoi.coffee", "admin")]) {
      const res = await agent.post("/api/tickets").send({ categoryId: SB, partySize: 2 });
      expect(res.status).toBe(403);
    }
    expect(Number((await pool.query("SELECT count(*) FROM queue_tickets")).rows[0].count)).toBe(0);
  });

  it("allows the same DESSERT_LOUNGE requests for the dessert staff member and the admin", async () => {
    const dl = await join(await as("boom@omkoi.coffee", "customer"), DL);
    await join(await as("hongtae@omkoi.coffee", "customer"), DL);
    for (const agent of [await as("dessert@omkoi.coffee", "staff"), await as("admin@omkoi.coffee", "admin")]) {
      expect((await agent.get(`/api/tickets?categoryId=${DL}`)).status).toBe(200);
      expect((await agent.get(`/api/tickets/${dl.id}`)).status).toBe(200);
      expect((await agent.post(`/api/categories/${DL}/call-next`).send({})).status).toBe(200);
    }
  });

  it("lists only assigned counters when the barista gives no categoryId", async () => {
    await join(await as("boom@omkoi.coffee", "customer"), EB);
    await join(await as("hongtae@omkoi.coffee", "customer"), DL);
    const res = await (await as("barista@omkoi.coffee", "staff")).get("/api/tickets");
    expect(res.status).toBe(200);
    expect(res.body.tickets.map((t: { ticketCode: string }) => t.ticketCode)).toEqual(["EB-001"]);
  });

  it("tells the client which counters a staff member may operate (assignedCategoryIds)", async () => {
    const barista = await loginAs(app, "barista@omkoi.coffee", passwords.staff);
    expect(barista.res.body.user.assignedCategoryIds).toEqual([SB, EB]);
    expect((await barista.agent.get("/api/auth/me")).body.user.assignedCategoryIds).toEqual([SB, EB]);
    const admin = await loginAs(app, "admin@omkoi.coffee", passwords.admin);
    expect(admin.res.body.user.assignedCategoryIds).toHaveLength(4);
    const customer = await loginAs(app, "boom@omkoi.coffee", passwords.customer);
    expect(customer.res.body.user).not.toHaveProperty("assignedCategoryIds");
  });
});
