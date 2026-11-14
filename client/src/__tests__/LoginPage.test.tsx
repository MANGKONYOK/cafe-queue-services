import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import { App } from "../App";
import { AuthProvider } from "../auth";

type Reply = { status: number; body: unknown };

/** Fakes the API by path; each path answers its queue of replies in order (last one repeats). */
function mockApi(routes: Record<string, Reply[]>) {
  return vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
    const path = String(input).replace(/^\/api/, "");
    const queue = routes[path] ?? [{ status: 404, body: { error: { code: "NOT_FOUND", message: "Resource not found.", details: {} } } }];
    const reply = queue.length > 1 ? queue.shift()! : queue[0];
    return new Response(JSON.stringify(reply.body), { status: reply.status, headers: { "Content-Type": "application/json" } });
  });
}

const unauth = { status: 401, body: { error: { code: "UNAUTHORIZED", message: "Authentication required.", details: {} } } };
const boom = { id: 4, email: "boom@omkoi.coffee", fullName: "Boom", role: "CUSTOMER" };

const renderAt = (path: string) =>
  render(
    <MemoryRouter initialEntries={[path]}>
      <AuthProvider>
        <App />
      </AuthProvider>
    </MemoryRouter>,
  );

describe("Login page and route guard (F-01 UI)", () => {
  it("redirects a signed-out visitor from /queue to the sign-in form", async () => {
    mockApi({ "/auth/me": [unauth] });
    renderAt("/queue");
    expect(await screen.findByRole("button", { name: "Sign in" })).toBeInTheDocument();
  });

  it("shows field errors on an empty submit without calling the API", async () => {
    const fetchMock = mockApi({ "/auth/me": [unauth] });
    renderAt("/login");
    await userEvent.click(await screen.findByRole("button", { name: "Sign in" }));
    expect(screen.getByText("Email is required.")).toBeInTheDocument();
    expect(screen.getByText("Password is required.")).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledTimes(1); // only the initial /auth/me
  });

  it("shows the safe 401 banner for wrong credentials", async () => {
    mockApi({
      "/auth/me": [unauth],
      "/auth/login": [{ status: 401, body: { error: { code: "INVALID_CREDENTIALS", message: "Invalid email or password.", details: {} } } }],
    });
    renderAt("/login");
    await userEvent.type(await screen.findByLabelText("Email"), "boom@omkoi.coffee");
    await userEvent.type(screen.getByLabelText("Password"), "wrong");
    await userEvent.click(screen.getByRole("button", { name: "Sign in" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Invalid email or password.");
  });

  it("sends a customer to /queue after login and shows the counters, then signs out", async () => {
    mockApi({
      "/auth/me": [unauth],
      "/auth/login": [{ status: 200, body: { user: boom } }],
      "/categories": [{ status: 200, body: { categories: [
        { id: 1, code: "SLOW_BAR", name: "Omkoi Specialty Slow Bar", prefix: "SB", description: null, estMinsPerTicket: 12, isOpen: true },
        { id: 4, code: "ROASTERY_CONSULT", name: "Omkoi Roastery", prefix: "RC", description: null, estMinsPerTicket: 20, isOpen: false },
      ] } }],
      "/auth/logout": [{ status: 200, body: { status: "logged_out" } }],
    });
    renderAt("/login");
    await userEvent.type(await screen.findByLabelText("Email"), "boom@omkoi.coffee");
    await userEvent.type(screen.getByLabelText("Password"), "secret");
    await userEvent.click(screen.getByRole("button", { name: "Sign in" }));

    expect(await screen.findByText("Omkoi Specialty Slow Bar")).toBeInTheDocument();
    expect(screen.getByText("PAUSED")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Sign out" }));
    expect(await screen.findByRole("button", { name: "Sign in" })).toBeInTheDocument();
  });
});
