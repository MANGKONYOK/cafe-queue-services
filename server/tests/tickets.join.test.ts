import request from "supertest";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { categoryId, eventsOf, loginAs, makeTestApp, passwords, resetAndSeed, setTicketStatus, ticketRow } from "./helpers.js";

const { app, pool } = makeTestApp();
let SB: number, EB: number, RC: number;

beforeEach(async () => {
  await resetAndSeed(pool);
  await pool.query("UPDATE service_categories SET is_open = (code <> 'ROASTERY_CONSULT')");
  [SB, EB, RC] = await Promise.all(["SLOW_BAR", "ESPRESSO_BAR", "ROASTERY_CONSULT"].map((c) => categoryId(pool, c)));
});
afterAll(() => pool.end());

const boom = () => loginAs(app, "boom@omkoi.coffee", passwords.customer).then((r) => r.agent);
const hongtae = () => loginAs(app, "hongtae@omkoi.coffee", passwords.customer).then((r) => r.agent);
const activeCount = async () =>
  Number((await pool.query("SELECT count(*) FROM queue_tickets WHERE status IN ('WAITING','CALLED','SERVING')")).rows[0].count);
const ticketCount = async () => Number((await pool.query("SELECT count(*) FROM queue_tickets")).rows[0].count);

describe("TEST-04 / AC-04, BR-07: customer joins an open queue and tracks the position", () => {
  it("creates SB-001 in WAITING with 0 ahead, persists it with a join event, and lists it in /my", async () => {
    const a = await boom();
    const res = await a.post("/api/tickets").send({ categoryId: SB, partySize: 2, specialRequests: " Pour-Over " });

    expect(res.status).toBe(201);
    expect(res.body.ticket).toMatchObject({
      ticketCode: "SB-001", status: "WAITING", aheadCount: 0, categoryId: SB, partySize: 2, specialRequests: "Pour-Over",
    });
    expect(res.body.ticket.categoryName).toMatch(/Slow Bar/);

    const row = await ticketRow(pool, res.body.ticket.id);
    expect(row).toMatchObject({ ticket_code: "SB-001", seq_no: 1, status: "WAITING" });
    const events = await eventsOf(pool, row.id);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ from_status: null, to_status: "WAITING", actor_id: row.customer_id });

    const my = await a.get("/api/tickets/my");
    expect(my.status).toBe(200);
    expect(my.body.tickets).toHaveLength(1);
    expect(my.body.tickets[0]).toMatchObject({ id: row.id, ticketCode: "SB-001", aheadCount: 0 });

    const one = await a.get(`/api/tickets/${row.id}`);
    expect(one.status).toBe(200);
    expect(one.body.ticket.ticketCode).toBe("SB-001");
    expect(one.body.events).toHaveLength(1);
  });

  it("gives the next customer SB-002 with 1 ahead and takes the owner from the session, not the body", async () => {
    const first = await (await boom()).post("/api/tickets").send({ categoryId: SB, partySize: 1 });
    const h = await hongtae();
    const second = await h.post("/api/tickets").send({ categoryId: SB, partySize: 3, customerId: first.body.ticket.customerId });

    expect(second.status).toBe(201);
    expect(second.body.ticket).toMatchObject({ ticketCode: "SB-002", aheadCount: 1 });
    expect(second.body.ticket.customerId).not.toBe(first.body.ticket.customerId);
    expect((await h.get("/api/tickets/my")).body.tickets.map((t: { ticketCode: string }) => t.ticketCode)).toEqual(["SB-002"]);
  });

  it("never reuses a code: after cancelling SB-001 the next join is SB-002", async () => {
    const a = await boom();
    const first = await a.post("/api/tickets").send({ categoryId: SB, partySize: 2 });
    await a.post(`/api/tickets/${first.body.ticket.id}/cancel`).send({ cancelReason: "Changed my mind" });
    const again = await a.post("/api/tickets").send({ categoryId: SB, partySize: 2 });
    expect(again.status).toBe(201);
    expect(again.body.ticket.ticketCode).toBe("SB-002");
  });

  it("requires a session for joining and for /my (TEST-02 step 2)", async () => {
    expect((await request(app).get("/api/tickets/my")).status).toBe(401);
    expect((await request(app).post("/api/tickets").send({ categoryId: SB, partySize: 2 })).status).toBe(401);
  });
});

describe("TEST-05 / AC-05, BR-01: one active ticket per customer per category", () => {
  it.each(["WAITING", "CALLED", "SERVING"])("refuses a second join while the first is %s", async (status) => {
    const a = await boom();
    const first = await a.post("/api/tickets").send({ categoryId: SB, partySize: 2 });
    await setTicketStatus(pool, first.body.ticket.id, status);

    const again = await a.post("/api/tickets").send({ categoryId: SB, partySize: 1 });
    expect(again.status).toBe(409);
    expect(again.body.error.code).toBe("DUPLICATE_ACTIVE_TICKET");
    expect(await activeCount()).toBe(1);
    expect(await ticketCount()).toBe(1);
  });

  it("does not consume a number on a refused join", async () => {
    const a = await boom();
    await a.post("/api/tickets").send({ categoryId: SB, partySize: 2 });
    await a.post("/api/tickets").send({ categoryId: SB, partySize: 2 });
    const next = await (await hongtae()).post("/api/tickets").send({ categoryId: SB, partySize: 2 });
    expect(next.body.ticket.ticketCode).toBe("SB-002");
  });

  it.each(["CANCELLED", "COMPLETED", "NO_SHOW"])("allows joining again once the first ticket is %s", async (status) => {
    const a = await boom();
    const first = await a.post("/api/tickets").send({ categoryId: SB, partySize: 2 });
    await setTicketStatus(pool, first.body.ticket.id, status);
    expect((await a.post("/api/tickets").send({ categoryId: SB, partySize: 2 })).status).toBe(201);
  });

  it("allows an active ticket in a different category at the same time", async () => {
    const a = await boom();
    await a.post("/api/tickets").send({ categoryId: SB, partySize: 2 });
    expect((await a.post("/api/tickets").send({ categoryId: EB, partySize: 2 })).status).toBe(201);
  });
});

describe("TEST-06 / AC-06, BR-02: paused category gate", () => {
  it("refuses a join to the paused ROASTERY_CONSULT and stores nothing", async () => {
    const res = await (await boom()).post("/api/tickets").send({ categoryId: RC, partySize: 2 });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe("CATEGORY_CLOSED");
    expect(await ticketCount()).toBe(0);
    expect((await pool.query("SELECT next_seq FROM service_categories WHERE id = $1", [RC])).rows[0].next_seq).toBe(1);
  });

  it("answers 404 for an unknown category", async () => {
    const res = await (await boom()).post("/api/tickets").send({ categoryId: 99999, partySize: 2 });
    expect(res.status).toBe(404);
    expect(await ticketCount()).toBe(0);
  });
});

describe("TEST-07 / AC-07, BR-03: party size and request boundaries", () => {
  it.each([0, 9, -1, 2.5, "2", null, undefined])("rejects partySize %s with 400", async (partySize) => {
    const res = await (await boom()).post("/api/tickets").send({ categoryId: SB, partySize });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("VALIDATION_ERROR");
    expect(res.body.error.details.fields).toHaveProperty("partySize");
    expect(await ticketCount()).toBe(0);
  });

  it("rejects a 281-character request and a non-integer categoryId", async () => {
    const a = await boom();
    const long = await a.post("/api/tickets").send({ categoryId: SB, partySize: 2, specialRequests: "x".repeat(281) });
    expect(long.status).toBe(400);
    expect(long.body.error.details.fields).toHaveProperty("specialRequests");
    const bad = await a.post("/api/tickets").send({ categoryId: "abc", partySize: 2 });
    expect(bad.status).toBe(400);
    expect(await ticketCount()).toBe(0);
  });

  it("accepts partySize 1 and 8 and exactly 280 characters; a blank request is stored as null", async () => {
    const a = await boom();
    const one = await a.post("/api/tickets").send({ categoryId: SB, partySize: 1, specialRequests: "   " });
    expect(one.status).toBe(201);
    expect(one.body.ticket.specialRequests).toBeNull();
    const eight = await a.post("/api/tickets").send({ categoryId: EB, partySize: 8, specialRequests: "y".repeat(280) });
    expect(eight.status).toBe(201);
    expect(eight.body.ticket.specialRequests).toHaveLength(280);
  });
});

describe("TEST-08 / AC-08, BR-05, BR-06: customer self-cancellation", () => {
  it("needs a 3-200 character reason, then cancels and logs the event", async () => {
    const a = await boom();
    const t = (await a.post("/api/tickets").send({ categoryId: SB, partySize: 2 })).body.ticket;

    for (const cancelReason of ["", "   ", "ab", undefined, "z".repeat(201)]) {
      const res = await a.post(`/api/tickets/${t.id}/cancel`).send({ cancelReason });
      expect(res.status).toBe(400);
      expect(res.body.error.details.fields).toHaveProperty("cancelReason");
    }
    expect((await ticketRow(pool, t.id)).status).toBe("WAITING");

    const ok = await a.post(`/api/tickets/${t.id}/cancel`).send({ cancelReason: "  Trip schedule changed " });
    expect(ok.status).toBe(200);
    expect(ok.body.ticket).toMatchObject({ id: t.id, status: "CANCELLED", cancelReason: "Trip schedule changed" });
    expect(ok.body.ticket.cancelledAt).toBeTruthy();
    const events = await eventsOf(pool, t.id);
    expect(events.at(-1)).toMatchObject({ from_status: "WAITING", to_status: "CANCELLED", note: "Trip schedule changed" });
  });

  it("refuses to cancel the customer's own CALLED ticket (409) and leaves it CALLED", async () => {
    const a = await boom();
    const t = (await a.post("/api/tickets").send({ categoryId: SB, partySize: 2 })).body.ticket;
    await setTicketStatus(pool, t.id, "CALLED");
    const res = await a.post(`/api/tickets/${t.id}/cancel`).send({ cancelReason: "Need to leave" });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe("INVALID_STATE_TRANSITION");
    expect((await ticketRow(pool, t.id)).status).toBe("CALLED");
  });
});
