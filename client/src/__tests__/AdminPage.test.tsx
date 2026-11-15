import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it } from "vitest";
import { App } from "../App";
import { AuthProvider } from "../auth";
import { categories as seedCategories, fakeApi } from "./fakeApi";

const admin = { id: 1, email: "admin@omkoi.coffee", fullName: "Khun Mee", role: "ADMIN", assignedCategoryIds: [1, 2, 3, 4] };
const staffList = [
  { id: 2, fullName: "Khun Noble", email: "barista@omkoi.coffee", categoryIds: [1, 2] },
  { id: 3, fullName: "Khun Fah", email: "dessert@omkoi.coffee", categoryIds: [3] },
];

const renderAdmin = () =>
  render(
    <MemoryRouter initialEntries={["/admin"]}>
      <AuthProvider>
        <App />
      </AuthProvider>
    </MemoryRouter>,
  );

describe("TEST-25 / AC-17, AC-18, NFR-05: admin counters page (component, mocked API)", () => {
  it("pauses a counter, saves its staff and creates a counter after a field error", async () => {
    let cats = seedCategories.map((c) => ({ ...c }));
    let staff = staffList.map((s) => ({ ...s, categoryIds: [...s.categoryIds] }));
    const sent: Record<string, unknown> = {};
    const calls = fakeApi({
      "GET /auth/me": () => ({ body: { user: admin } }),
      "GET /categories": () => ({ body: { categories: cats } }),
      "GET /staff": () => ({ body: { staff } }),
      "PATCH /categories/1": (body) => {
        cats = cats.map((c) => (c.id === 1 ? { ...c, ...body } : c));
        return { body: { category: cats[0] } };
      },
      "PUT /categories/1/staff": (body) => {
        sent.staff = body;
        staff = staff.map((s) => ({ ...s, categoryIds: body.staffIds.includes(s.id) ? [...new Set([...s.categoryIds, 1])] : s.categoryIds.filter((id) => id !== 1) }));
        return { body: { categoryId: 1, staffIds: body.staffIds } };
      },
      "POST /categories": (body) => {
        if (body.prefix.length < 2) {
          return { status: 400, body: { error: { code: "VALIDATION_ERROR", message: "The request is not valid.", details: { fields: { prefix: "prefix must be 2-5 letters A-Z." } } } } };
        }
        const created = { id: 5, code: body.code, name: body.name, prefix: body.prefix, description: body.description || null, estMinsPerTicket: body.estMinsPerTicket, isOpen: true, waitingCount: 0 };
        cats = [...cats, created];
        return { status: 201, body: { category: created } };
      },
    });
    renderAdmin();

    expect(await screen.findByRole("link", { name: "Counters" })).toBeInTheDocument();
    const sb = await screen.findByRole("article", { name: "Counter SB" });
    await userEvent.click(within(sb).getByRole("button", { name: "Pause" }));
    expect(await within(sb).findByText("PAUSED")).toBeInTheDocument();
    expect(within(sb).getByRole("button", { name: "Resume" })).toBeInTheDocument();

    await userEvent.click(within(sb).getByLabelText("Khun Fah"));
    await userEvent.click(within(sb).getByRole("button", { name: "Save staff" }));
    expect(sent.staff).toEqual({ staffIds: [2, 3] });

    const form = screen.getByRole("form", { name: "New counter" });
    await userEvent.type(within(form).getByLabelText(/Code/), "tea_bar");
    await userEvent.type(within(form).getByLabelText(/Prefix/), "t");
    await userEvent.type(within(form).getByLabelText("Counter name"), "Highland Tea Bar");
    await userEvent.click(within(form).getByRole("button", { name: "Create counter" }));
    expect(await within(form).findByText("prefix must be 2-5 letters A-Z.")).toBeInTheDocument();

    await userEvent.type(within(form).getByLabelText(/Prefix/), "b");
    await userEvent.click(within(form).getByRole("button", { name: "Create counter" }));
    expect(await screen.findByRole("article", { name: "Counter TB" })).toBeInTheDocument();
    expect(calls.filter((c) => c === "POST /categories")).toHaveLength(2);
  });

  it("sends a non-admin away from /admin and hides the Counters link", async () => {
    fakeApi({
      "GET /auth/me": () => ({ body: { user: { id: 2, email: "barista@omkoi.coffee", fullName: "Khun Noble", role: "STAFF", assignedCategoryIds: [1] } } }),
      "GET /categories": () => ({ body: { categories: seedCategories } }),
      "GET /tickets": () => ({ body: { tickets: [] } }),
    });
    renderAdmin();
    expect(await screen.findByText("No guests waiting")).toBeInTheDocument(); // landed on the staff console
    expect(screen.queryByRole("link", { name: "Counters" })).toBeNull();
  });
});

describe("TEST-25 (PR #6 review): admin page freshness and session", () => {
  it("shows a counter created on /admin as a tab on the console without a reload", async () => {
    let cats = seedCategories.map((c) => ({ ...c }));
    let me = { ...admin };
    fakeApi({
      "GET /auth/me": () => ({ body: { user: me } }),
      "GET /categories": () => ({ body: { categories: cats } }),
      "GET /staff": () => ({ body: { staff: staffList } }),
      "GET /tickets": () => ({ body: { tickets: [] } }),
      "POST /categories": (body) => {
        const created = { id: 5, code: body.code, name: body.name, prefix: body.prefix, description: null, estMinsPerTicket: body.estMinsPerTicket, isOpen: true, waitingCount: 0 };
        cats = [...cats, created];
        me = { ...me, assignedCategoryIds: [1, 2, 3, 4, 5] };
        return { status: 201, body: { category: created } };
      },
    });
    renderAdmin();
    const form = await screen.findByRole("form", { name: "New counter" });
    await userEvent.type(within(form).getByLabelText(/Code/), "TEA_BAR");
    await userEvent.type(within(form).getByLabelText(/Prefix/), "TB");
    await userEvent.type(within(form).getByLabelText("Counter name"), "Highland Tea Bar");
    await userEvent.click(within(form).getByRole("button", { name: "Create counter" }));
    await screen.findByRole("article", { name: "Counter TB" });

    await userEvent.click(screen.getByRole("link", { name: "Console" }));
    expect(await screen.findByRole("tab", { name: /^TB/ })).toBeInTheDocument();
  });

  it("opens Edit with the latest values after the page refreshed", async () => {
    let cats = seedCategories.map((c) => ({ ...c }));
    fakeApi({
      "GET /auth/me": () => ({ body: { user: admin } }),
      "GET /categories": () => ({ body: { categories: cats } }),
      "GET /staff": () => ({ body: { staff: staffList } }),
      "PATCH /categories/1": (body) => {
        cats = cats.map((c) => (c.id === 1 ? { ...c, ...body } : c));
        return { body: { category: cats[0] } };
      },
    });
    renderAdmin();
    const sb = await screen.findByRole("article", { name: "Counter SB" });
    await userEvent.click(within(sb).getByRole("button", { name: "Edit" }));
    await userEvent.click(within(sb).getByRole("button", { name: "Close" }));

    cats = cats.map((c) => (c.id === 1 ? { ...c, name: "Slow Bar (renamed elsewhere)", estMinsPerTicket: 20 } : c));
    await userEvent.click(within(sb).getByRole("button", { name: "Pause" })); // triggers a reload
    await within(sb).findByText("PAUSED");
    await userEvent.click(within(sb).getByRole("button", { name: "Edit" }));
    expect(within(sb).getByLabelText("Name")).toHaveValue("Slow Bar (renamed elsewhere)");
    expect(within(sb).getByLabelText("Minutes per guest")).toHaveValue("20");
  });

  it("sends the admin to sign in when an action answers 401", async () => {
    let signedIn = true;
    fakeApi({
      "GET /auth/me": () => (signedIn ? { body: { user: admin } } : { status: 401, body: { error: { code: "UNAUTHORIZED", message: "Authentication required.", details: {} } } }),
      "GET /categories": () => ({ body: { categories: seedCategories } }),
      "GET /staff": () => ({ body: { staff: staffList } }),
      "PATCH /categories/1": () => {
        signedIn = false;
        return { status: 401, body: { error: { code: "UNAUTHORIZED", message: "Authentication required.", details: {} } } };
      },
    });
    renderAdmin();
    const sb = await screen.findByRole("article", { name: "Counter SB" });
    await userEvent.click(within(sb).getByRole("button", { name: "Pause" }));
    expect(await screen.findByRole("button", { name: "Sign in" })).toBeInTheDocument();
  });
});
