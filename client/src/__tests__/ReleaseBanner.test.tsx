import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ReleaseBanner } from "../components/ReleaseBanner";
import { fakeApi } from "./fakeApi";

afterEach(() => vi.restoreAllMocks());

describe("Release banner (C-06, R-08: which commit is running)", () => {
  it("shows the short commit SHA from /api/health and keeps the full SHA in the title", async () => {
    fakeApi({ "GET /health": () => ({ body: { status: "ok", version: "bd2f69e93c3913d55840017289d68a61049a4e75" } }) });
    render(<ReleaseBanner />);
    const banner = await screen.findByRole("status", { name: "Release" });
    expect(banner).toHaveTextContent("Release bd2f69e");
    expect(banner).toHaveAttribute("title", "bd2f69e93c3913d55840017289d68a61049a4e75");
  });

  it("shows 'dev' for a local build", async () => {
    fakeApi({ "GET /health": () => ({ body: { status: "ok", version: "dev" } }) });
    render(<ReleaseBanner />);
    expect(await screen.findByRole("status", { name: "Release" })).toHaveTextContent("Release dev");
  });

  it("renders nothing when the health check fails", async () => {
    const calls = fakeApi({ "GET /health": () => ({ status: 503, body: { status: "not_ready" } }) });
    const { container } = render(<ReleaseBanner />);
    await vi.waitFor(() => expect(calls).toContain("GET /health"));
    expect(container).toBeEmptyDOMElement();
  });
});
