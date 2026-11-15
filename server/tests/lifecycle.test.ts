import request from "supertest";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { categoryId, createCustomers, eventsOf, loginAs, makeTestApp, passwords, resetAndSeed, setTicketStatus, ticketRow } from "./helpers.js";

const { app, pool } = makeTestApp();
let SB: number, EB: number;

beforeEach(async () => {
  await resetAndSeed(pool);
  await pool.query("UPDATE service_categories SET is_open = (code <> 'ROASTERY_CONSULT')");
  [SB, EB] = await Promise.all(["SLOW_BAR", "ESPRESSO_BAR"].map((c) => categoryId(pool, c)));
});
afterAll(() => pool.end());

const as = (email: string, kind: keyof typeof passwords) => loginAs(app, email, passwords[kind]).then((r) => r.agent);
const join = async (agent: request.Agent, categoryId: number) =>
  (await agent.post("/api/tickets").send({ categoryId, partySize: 2 })).body.ticket;

describe("TEST-10 / AC-10, BR-04: staff happy path call-next -> serve -> complete", () => {
  it("moves EB-001 through CALLED, SERVING and COMPLETED with timestamps, staff and events", async () => {
    const customer = await as("boom@omkoi.coffee", "customer");
    const t = await join(customer, EB);
    const barista = await as("barista@omkoi.coffee", "staff");
    const staffId = (await barista.get("/api/auth/me")).body.user.id;

    const called = await barista.post(`/api/categories/${EB}/call-next`).send({ counterName: "Espresso Bar 1" });
    expect(called.status).toBe(200);
    expect(called.body.ticket).toMatchObject({ id: t.id, status: "CALLED", counterName: "Espresso Bar 1", assignedStaffId: staffId });
    expect(called.body.ticket.calledAt).toBeTruthy();

    const serving = await barista.post(`/api/tickets/${t.id}/serve`).send({});
    expect(serving.status).toBe(200);
    expect(serving.body.ticket.status).toBe("SERVING");
    expect(serving.body.ticket.servingStartedAt).toBeTruthy();

    const done = await barista.post(`/api/tickets/${t.id}/complete`).send({ completionSummary: "Served Highland Matcha Latte" });
    expect(done.status).toBe(200);
    expect(done.body.ticket).toMatchObject({ status: "COMPLETED", completionSummary: "Served Highland Matcha Latte" });
    expect(done.body.ticket.completedAt).toBeTruthy();

    const row = await ticketRow(pool, t.id);
    expect(row.called_at && row.serving_started_at && row.completed_at).toBeTruthy();
    expect(row.assigned_staff_id).toBe(staffId);
    const events = await eventsOf(pool, t.id);
    expect(events.map((e) => [e.from_status, e.to_status])).toEqual([
      [null, "WAITING"], ["WAITING", "CALLED"], ["CALLED", "SERVING"], ["SERVING", "COMPLETED"],
    ]);
    expect(events.slice(1).every((e) => e.actor_id === staffId)).toBe(true);

    const my = await customer.get("/api/tickets/my");
    expect(my.body.tickets[0].status).toBe("COMPLETED");
  });
});

describe("TEST-11 / AC-11, AC-12, BR-04, BR-05: illegal transitions and required notes", () => {
  it("refuses jumps from WAITING with 409 and leaves the ticket unchanged", async () => {
    const t = await join(await as("boom@omkoi.coffee", "customer"), SB);
    const barista = await as("barista@omkoi.coffee", "staff");
    for (const [action, body] of [["serve", {}], ["complete", { completionSummary: "Served coffee" }], ["no-show", { noShowNote: "Guest absent" }]] as const) {
      const res = await barista.post(`/api/tickets/${t.id}/${action}`).send(body);
      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe("INVALID_STATE_TRANSITION");
    }
    expect((await ticketRow(pool, t.id)).status).toBe("WAITING");
    expect(await eventsOf(pool, t.id)).toHaveLength(1);
  });

  it("requires a 5-500 character completion summary", async () => {
    const t = await join(await as("boom@omkoi.coffee", "customer"), SB);
    await setTicketStatus(pool, t.id, "SERVING");
    const barista = await as("barista@omkoi.coffee", "staff");
    for (const completionSummary of ["", "    ", "abcd", undefined, "s".repeat(501)]) {
      const res = await barista.post(`/api/tickets/${t.id}/complete`).send({ completionSummary });
      expect(res.status).toBe(400);
      expect(res.body.error.details.fields).toHaveProperty("completionSummary");
    }
    expect((await barista.post(`/api/tickets/${t.id}/complete`).send({ completionSummary: "abcde" })).status).toBe(200);
  });

  it("marks a CALLED ticket NO_SHOW only with a 3-200 character note", async () => {
    const t = await join(await as("boom@omkoi.coffee", "customer"), SB);
    await setTicketStatus(pool, t.id, "CALLED");
    const barista = await as("barista@omkoi.coffee", "staff");
    expect((await barista.post(`/api/tickets/${t.id}/no-show`).send({ noShowNote: "  " })).status).toBe(400);
    const res = await barista.post(`/api/tickets/${t.id}/no-show`).send({ noShowNote: "Called 3 times over 5 mins; guest absent" });
    expect(res.status).toBe(200);
    expect(res.body.ticket.status).toBe("NO_SHOW");
    expect(res.body.ticket.noShowAt).toBeTruthy();
  });

  it("refuses no-show on a SERVING ticket", async () => {
    const t = await join(await as("boom@omkoi.coffee", "customer"), SB);
    await setTicketStatus(pool, t.id, "SERVING");
    const res = await (await as("barista@omkoi.coffee", "staff")).post(`/api/tickets/${t.id}/no-show`).send({ noShowNote: "Guest absent" });
    expect(res.status).toBe(409);
  });

  it("lets staff cancel a CALLED ticket with a reason", async () => {
    const t = await join(await as("boom@omkoi.coffee", "customer"), SB);
    await setTicketStatus(pool, t.id, "CALLED");
    const res = await (await as("barista@omkoi.coffee", "staff")).post(`/api/tickets/${t.id}/cancel`).send({ cancelReason: "Counter issue" });
    expect(res.status).toBe(200);
    expect(res.body.ticket).toMatchObject({ status: "CANCELLED", cancelReason: "Counter issue" });
  });

  it.each(["COMPLETED", "NO_SHOW", "CANCELLED"])("never changes a terminal %s ticket", async (terminal) => {
    const t = await join(await as("boom@omkoi.coffee", "customer"), SB);
    await setTicketStatus(pool, t.id, terminal);
    const barista = await as("barista@omkoi.coffee", "staff");
    const attempts = [
      barista.post(`/api/tickets/${t.id}/serve`).send({}),
      barista.post(`/api/tickets/${t.id}/complete`).send({ completionSummary: "Served coffee" }),
      barista.post(`/api/tickets/${t.id}/no-show`).send({ noShowNote: "Guest absent" }),
      barista.post(`/api/tickets/${t.id}/cancel`).send({ cancelReason: "Counter issue" }),
    ];
    for (const res of await Promise.all(attempts)) expect(res.status).toBe(409);
    expect((await ticketRow(pool, t.id)).status).toBe(terminal);
  });

  it("answers 404 to staff for an unknown ticket", async () => {
    const res = await (await as("admin@omkoi.coffee", "admin")).post("/api/tickets/999999/serve").send({});
    expect(res.status).toBe(404);
  });
});

describe("TEST-17 / AC-15, BR-10: call-next takes the oldest WAITING ticket", () => {
  it("calls SB-001, SB-002, SB-003 in order, then answers 409 QUEUE_EMPTY", async () => {
    const [guest] = await createCustomers(pool, 1);
    await join(await as("boom@omkoi.coffee", "customer"), SB);
    const h = await as("hongtae@omkoi.coffee", "customer");
    const second = await join(h, SB);
    await join((await loginAs(app, guest, passwords.customer)).agent, SB);
    const barista = await as("barista@omkoi.coffee", "staff");

    const first = await barista.post(`/api/categories/${SB}/call-next`).send({});
    expect(first.body.ticket.ticketCode).toBe("SB-001");
    expect((await h.get(`/api/tickets/${second.id}`)).body.ticket.aheadCount).toBe(0);
    expect((await barista.post(`/api/categories/${SB}/call-next`).send({})).body.ticket.ticketCode).toBe("SB-002");
    expect((await barista.post(`/api/categories/${SB}/call-next`).send({})).body.ticket.ticketCode).toBe("SB-003");

    const empty = await barista.post(`/api/categories/${SB}/call-next`).send({});
    expect(empty.status).toBe(409);
    expect(empty.body.error.code).toBe("QUEUE_EMPTY");
  });

  it("answers 404 to the admin for an unknown category and 400 for a too-long counter name", async () => {
    const admin = await as("admin@omkoi.coffee", "admin");
    expect((await admin.post("/api/categories/99999/call-next").send({})).status).toBe(404);
    expect((await admin.post(`/api/categories/${SB}/call-next`).send({ counterName: "c".repeat(51) })).status).toBe(400);
  });

  it("lists the queue oldest first, filters by status and rejects an unknown status", async () => {
    await join(await as("boom@omkoi.coffee", "customer"), SB);
    await join(await as("hongtae@omkoi.coffee", "customer"), SB);
    const barista = await as("barista@omkoi.coffee", "staff");
    await barista.post(`/api/categories/${SB}/call-next`).send({});

    const all = await barista.get(`/api/tickets?categoryId=${SB}`);
    expect(all.body.tickets.map((t: { ticketCode: string }) => t.ticketCode)).toEqual(["SB-001", "SB-002"]);
    const waiting = await barista.get(`/api/tickets?categoryId=${SB}&status=WAITING`);
    expect(waiting.body.tickets.map((t: { ticketCode: string }) => t.ticketCode)).toEqual(["SB-002"]);
    expect((await barista.get(`/api/tickets?status=LOST`)).status).toBe(400);
  });
});
