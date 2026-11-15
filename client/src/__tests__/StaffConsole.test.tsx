import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it } from "vitest";
import { App } from "../App";
import { AuthProvider } from "../auth";
import { categories, fakeApi, ticket } from "./fakeApi";

const barista = { id: 2, email: "barista@omkoi.coffee", fullName: "Khun Noble", role: "STAFF", assignedCategoryIds: [1, 2] };

const renderStaff = () =>
  render(
    <MemoryRouter initialEntries={["/staff"]}>
      <AuthProvider>
        <App />
      </AuthProvider>
    </MemoryRouter>,
  );

describe("TEST-14 / AC-10, NFR-05: staff counter console (component, mocked API)", () => {
  it("shows tabs for assigned counters only and runs call next -> serve -> complete", async () => {
    let queue = [ticket(), ticket({ id: 11, ticketCode: "SB-002", customerName: "Hongtae", aheadCount: 1 })];
    const set = (id: number, over: Record<string, unknown>) => {
      queue = queue.map((t) => (t.id === id ? { ...t, ...over } : t));
      return { body: { ticket: queue.find((t) => t.id === id) } };
    };
    const calls = fakeApi({
      "GET /auth/me": () => ({ body: { user: barista } }),
      "GET /categories": () => ({ body: { categories } }),
      "GET /tickets": (_b, url) => ({ body: { tickets: url.searchParams.get("categoryId") === "1" ? queue : [] } }),
      "POST /categories/1/call-next": (body) => set(10, { status: "CALLED", counterName: body.counterName, aheadCount: null }),
      "POST /tickets/10/serve": () => set(10, { status: "SERVING" }),
      "POST /tickets/10/complete": (body) => set(10, { status: "COMPLETED", completionSummary: body.completionSummary }),
    });
    renderStaff();

    const tabs = await screen.findAllByRole("tab");
    expect(tabs.map((t) => t.textContent)).toEqual([expect.stringMatching(/^SB/), expect.stringMatching(/^EB/)]);
    expect(await screen.findByLabelText("Waiting count")).toHaveTextContent("2");

    await userEvent.type(screen.getByPlaceholderText("e.g. Slow Bar 1"), "Slow Bar 1");
    await userEvent.click(screen.getByRole("button", { name: "Call next" }));
    const row = await screen.findByRole("listitem", { name: "Ticket SB-001" });
    expect(await within(row).findByText("CALLED")).toBeInTheDocument();

    await userEvent.click(within(row).getByRole("button", { name: "Start serving" }));
    expect(await within(row).findByText("SERVING")).toBeInTheDocument();

    await userEvent.click(within(row).getByRole("button", { name: "Complete" }));
    const dialog = screen.getByRole("dialog");
    await userEvent.click(within(dialog).getByRole("button", { name: "Complete" }));
    expect(within(dialog).getByText("Completion summary must be 5-500 characters.")).toBeInTheDocument();
    expect(calls).not.toContain("POST /tickets/10/complete");

    await userEvent.type(within(dialog).getByLabelText("Completion summary"), "Served 2x Omkoi Washed V60");
    await userEvent.click(within(dialog).getByRole("button", { name: "Complete" }));
    expect(await screen.findByRole("listitem", { name: "Ticket SB-002" })).toBeInTheDocument();
    expect(screen.queryByRole("listitem", { name: "Ticket SB-001" })).toBeNull(); // completed leaves the Active view
    expect(calls).toContain("POST /tickets/10/complete");
  });

  it("disables Call next and shows the empty state when nobody is waiting", async () => {
    fakeApi({
      "GET /auth/me": () => ({ body: { user: barista } }),
      "GET /categories": () => ({ body: { categories } }),
      "GET /tickets": () => ({ body: { tickets: [] } }),
    });
    renderStaff();
    expect(await screen.findByText("No guests waiting")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Call next" })).toBeDisabled();
  });

  it("shows the server's 403 message when an action is refused", async () => {
    fakeApi({
      "GET /auth/me": () => ({ body: { user: barista } }),
      "GET /categories": () => ({ body: { categories } }),
      "GET /tickets": () => ({ body: { tickets: [ticket()] } }),
      "POST /categories/1/call-next": () => ({ status: 403, body: { error: { code: "FORBIDDEN", message: "You are not allowed to do this.", details: {} } } }),
    });
    renderStaff();
    await screen.findByRole("listitem", { name: "Ticket SB-001" });
    await userEvent.click(screen.getByRole("button", { name: "Call next" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("You are not allowed to do this.");
  });
});
