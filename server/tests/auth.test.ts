import request from "supertest";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { loginAs, makeTestApp, passwords, resetAndSeed } from "./helpers.js";

const { app, pool } = makeTestApp();
const EIGHT_HOURS = 8 * 60 * 60 * 1000;

beforeEach(() => resetAndSeed(pool));
afterAll(() => pool.end());

const sessionCount = async () => Number((await pool.query("SELECT count(*) FROM user_sessions")).rows[0].count);
const sessionCookie = (res: request.Response) =>
  ([] as string[]).concat(res.headers["set-cookie"] ?? []).find((c) => c.startsWith("connect.sid="));

describe("TEST-01 / AC-01, NFR-01: valid login, session persistence, no hash leak", () => {
  it("logs in a seeded customer, stores a session row and returns only safe fields", async () => {
    const { agent, res } = await loginAs(app, "boom@omkoi.coffee", passwords.customer);

    expect(res.status).toBe(200);
    expect(Object.keys(res.body.user).sort()).toEqual(["email", "fullName", "id", "role"]);
    expect(res.body.user).toMatchObject({ email: "boom@omkoi.coffee", fullName: "Boom", role: "CUSTOMER" });
    expect(JSON.stringify(res.body)).not.toMatch(/password/i);

    const cookie = sessionCookie(res)!;
    expect(cookie).toMatch(/HttpOnly/);
    expect(cookie).toMatch(/SameSite=Lax/);
    const expires = Date.parse(/Expires=([^;]+)/.exec(cookie)![1]);
    expect(Math.abs(expires - Date.now() - EIGHT_HOURS)).toBeLessThan(60_000);

    const rows = (await pool.query("SELECT sess FROM user_sessions")).rows;
    expect(rows).toHaveLength(1);
    expect(rows[0].sess.userId).toBe(res.body.user.id);

    const me = await agent.get("/api/auth/me");
    expect(me.status).toBe(200);
    expect(me.body).toEqual({ user: res.body.user });
    expect(JSON.stringify(me.body)).not.toMatch(/password/i);
  });

  it("stores passwords as bcrypt hashes with cost 10", async () => {
    const { rows } = await pool.query("SELECT password_hash FROM users");
    expect(rows).toHaveLength(5);
    for (const r of rows) expect(r.password_hash).toMatch(/^\$2[aby]\$10\$/);
  });

  it("accepts the email with different case and surrounding spaces", async () => {
    const { res } = await loginAs(app, "  Boom@Omkoi.Coffee ", passwords.customer);
    expect(res.status).toBe(200);
    expect(res.body.user.email).toBe("boom@omkoi.coffee");
  });

  it("returns the role from the database for staff and admin", async () => {
    expect((await loginAs(app, "barista@omkoi.coffee", passwords.staff)).res.body.user.role).toBe("STAFF");
    expect((await loginAs(app, "admin@omkoi.coffee", passwords.admin)).res.body.user.role).toBe("ADMIN");
  });
});

describe("TEST-02 / AC-02: invalid credentials and unauthenticated requests", () => {
  it("rejects a wrong password and an unknown email the same way, without a session", async () => {
    const wrong = await request(app).post("/api/auth/login").send({ email: "boom@omkoi.coffee", password: "not-the-password" });
    const unknown = await request(app).post("/api/auth/login").send({ email: "nobody@omkoi.coffee", password: "whatever" });

    for (const res of [wrong, unknown]) {
      expect(res.status).toBe(401);
      expect(res.body.error).toMatchObject({ code: "INVALID_CREDENTIALS", message: "Invalid email or password." });
      expect(res.body.user).toBeUndefined();
      expect(sessionCookie(res)).toBeUndefined();
    }
    expect(await sessionCount()).toBe(0);
  });

  it("returns 400 when email or password is missing or blank", async () => {
    for (const body of [{}, { email: "boom@omkoi.coffee" }, { password: "x" }, { email: "   ", password: "x" }]) {
      const res = await request(app).post("/api/auth/login").send(body);
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe("VALIDATION_ERROR");
    }
    expect(await sessionCount()).toBe(0);
  });

  it("returns 401 without private data on protected endpoints when there is no cookie", async () => {
    for (const path of ["/api/auth/me", "/api/categories"]) {
      const res = await request(app).get(path);
      expect(res.status).toBe(401);
      expect(res.body).toEqual({ error: { code: "UNAUTHORIZED", message: "Authentication required.", details: {} } });
    }
  });

  it("returns 401 for a tampered session cookie", async () => {
    const res = await request(app).get("/api/auth/me").set("Cookie", "connect.sid=s%3Aforged.signature");
    expect(res.status).toBe(401);
  });
});

describe("TEST-15 / AC-13: logout and session expiry", () => {
  it("logout deletes the session row, clears the cookie, and the old cookie then gets 401", async () => {
    const { agent, res: login } = await loginAs(app, "boom@omkoi.coffee", passwords.customer);
    const oldCookie = sessionCookie(login)!.split(";")[0];
    expect(await sessionCount()).toBe(1);

    const out = await agent.post("/api/auth/logout");
    expect(out.status).toBe(200);
    expect(out.body).toEqual({ status: "logged_out" });
    expect(sessionCookie(out)).toMatch(/Expires=Thu, 01 Jan 1970/);
    expect(await sessionCount()).toBe(0);

    const reuse = await request(app).get("/api/auth/me").set("Cookie", oldCookie);
    expect(reuse.status).toBe(401);
    expect(reuse.body.user).toBeUndefined();
  });

  it("treats a session whose stored expiry has passed as no session", async () => {
    const { agent } = await loginAs(app, "boom@omkoi.coffee", passwords.customer);
    await pool.query("UPDATE user_sessions SET expire = now() - interval '1 minute'");
    const res = await agent.get("/api/auth/me");
    expect(res.status).toBe(401);
    expect(res.body.user).toBeUndefined();
  });

  it("ends a session 8 hours after login even if it was used in between (absolute expiry)", async () => {
    const { agent } = await loginAs(app, "boom@omkoi.coffee", passwords.customer);
    expect((await agent.get("/api/auth/me")).status).toBe(200);
    const nineHoursAgo = Date.now() - 9 * 60 * 60 * 1000;
    await pool.query("UPDATE user_sessions SET sess = jsonb_set(sess::jsonb, '{loginAt}', to_jsonb($1::bigint))::json", [nineHoursAgo]);
    expect((await agent.get("/api/auth/me")).status).toBe(401);
  });

  it("regenerates the session id on login (no session fixation)", async () => {
    const agent = request.agent(app);
    const first = await agent.post("/api/auth/login").send({ email: "boom@omkoi.coffee", password: passwords.customer });
    const second = await agent.post("/api/auth/login").send({ email: "boom@omkoi.coffee", password: passwords.customer });
    expect(sessionCookie(first)!.split(";")[0]).not.toBe(sessionCookie(second)!.split(";")[0]);
    expect(await sessionCount()).toBe(1);
  });

  it("returns 401 for logout without a session", async () => {
    const res = await request(app).post("/api/auth/logout");
    expect(res.status).toBe(401);
  });
});
