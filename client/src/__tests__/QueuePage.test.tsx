import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it } from "vitest";
import { App } from "../App";
import { AuthProvider } from "../auth";
import { categories, fakeApi, ticket } from "./fakeApi";

const boom = { id: 4, email: "boom@omkoi.coffee", fullName: "Boom", role: "CUSTOMER" };

const renderQueue = () =>
  render(
    <MemoryRouter initialEntries={["/queue"]}>
      <AuthProvider>
        <App />
      </AuthProvider>
    </MemoryRouter>,
  );

describe("TEST-13 / AC-04, NFR-05: customer queue portal (component, mocked API)", () => {
  it("shows the loading state while the queue is being fetched", async () => {
    fakeApi({
      "GET /auth/me": () => ({ body: { user: boom } }),
      "GET /categories": () => ({ body: { categories } }),
      "GET /tickets/my": () => new Promise(() => {}), // never answers
    });
    renderQueue();
    expect(await screen.findByText("Loading…")).toBeInTheDocument();
  });

  it("shows the empty state; joining shows SB-001 WAITING with 0 ahead", async () => {
    let mine: unknown[] = [];
    let joined: any;
    fakeApi({
      "GET /auth/me": () => ({ body: { user: boom } }),
      "GET /categories": () => ({ body: { categories } }),
      "GET /tickets/my": () => ({ body: { tickets: mine } }),
      "POST /tickets": (body) => {
        joined = body;
        mine = [ticket({ partySize: body.partySize })];
        return { status: 201, body: { ticket: mine[0] } };
      },
    });
    renderQueue();
    expect(await screen.findByText("No active tickets - join a counter below")).toBeInTheDocument();

    const slowBar = screen.getByText(categories[0].name).closest("article")!;
    await userEvent.selectOptions(within(slowBar).getByLabelText("Party size"), "3");
    await userEvent.click(within(slowBar).getByRole("button", { name: "Join SB queue" }));

    const card = await screen.findByRole("article", { name: "Ticket SB-001" });
    expect(within(card).getByText("WAITING")).toBeInTheDocument();
    expect(within(card).getByText(/0 ahead/)).toBeInTheDocument();
    expect(joined).toEqual({ categoryId: 1, partySize: 3, specialRequests: null });
    expect(screen.getByText("You're in this queue.")).toBeInTheDocument();
  });

  it("disables joining a paused counter and shows the server's 409 message in a banner", async () => {
    fakeApi({
      "GET /auth/me": () => ({ body: { user: boom } }),
      "GET /categories": () => ({ body: { categories } }),
      "GET /tickets/my": () => ({ body: { tickets: [] } }),
      "POST /tickets": () => ({
        status: 409,
        body: { error: { code: "DUPLICATE_ACTIVE_TICKET", message: "You already hold an active ticket in this category.", details: {} } },
      }),
    });
    renderQueue();
    const roastery = (await screen.findByText(categories[3].name)).closest("article")!;
    expect(within(roastery).queryByRole("button")).toBeNull();
    expect(within(roastery).getByText(/Paused/)).toBeInTheDocument();

    const espresso = screen.getByText(categories[1].name).closest("article")!;
    await userEvent.click(within(espresso).getByRole("button", { name: "Join EB queue" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("You already hold an active ticket in this category.");
  });

  it("asks for a 3-200 character reason before cancelling a waiting ticket", async () => {
    let mine = [ticket()];
    const calls = fakeApi({
      "GET /auth/me": () => ({ body: { user: boom } }),
      "GET /categories": () => ({ body: { categories } }),
      "GET /tickets/my": () => ({ body: { tickets: mine } }),
      "POST /tickets/10/cancel": (body) => {
        mine = [ticket({ status: "CANCELLED", cancelReason: body.cancelReason, aheadCount: null })];
        return { body: { ticket: mine[0] } };
      },
    });
    renderQueue();
    await userEvent.click(await screen.findByRole("button", { name: "Cancel ticket" }));
    const dialog = screen.getByRole("dialog");
    await userEvent.type(within(dialog).getByLabelText("Reason"), "ab");
    await userEvent.click(within(dialog).getByRole("button", { name: "Cancel ticket" }));
    expect(within(dialog).getByText("Reason must be 3-200 characters.")).toBeInTheDocument();
    expect(calls).not.toContain("POST /tickets/10/cancel");

    await userEvent.type(within(dialog).getByLabelText("Reason"), "c - schedule changed");
    await userEvent.click(within(dialog).getByRole("button", { name: "Cancel ticket" }));
    expect(await screen.findByText("Earlier tickets")).toBeInTheDocument();
    expect(screen.getByText("CANCELLED")).toBeInTheDocument();
  });
});

describe("TEST-13 (PR #6 review): refused cancel", () => {
  it("shows the server's 409 message when the cancel is refused", async () => {
    fakeApi({
      "GET /auth/me": () => ({ body: { user: boom } }),
      "GET /categories": () => ({ body: { categories } }),
      "GET /tickets/my": () => ({ body: { tickets: [ticket()] } }),
      "POST /tickets/10/cancel": () => ({
        status: 409,
        body: { error: { code: "INVALID_STATE_TRANSITION", message: "A CALLED ticket cannot become CANCELLED.", details: {} } },
      }),
    });
    renderQueue();
    await userEvent.click(await screen.findByRole("button", { name: "Cancel ticket" }));
    await userEvent.type(within(screen.getByRole("dialog")).getByLabelText("Reason"), "Need to leave");
    await userEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Cancel ticket" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("A CALLED ticket cannot become CANCELLED.");
  });
});
