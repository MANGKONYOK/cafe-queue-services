import { vi } from "vitest";

type Reply = { status?: number; body: unknown };
export type Handler = (body: any, url: URL) => Reply | Promise<Reply>;

/** Fake same-origin API: "METHOD /path" -> handler. Unknown routes answer 404 in the API envelope. */
export function fakeApi(routes: Record<string, Handler>) {
  const calls: string[] = [];
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
    const url = new URL(String(input), "http://localhost");
    const key = `${init?.method ?? "GET"} ${url.pathname.replace(/^\/api/, "")}`;
    calls.push(key);
    const handler = routes[key];
    const reply = handler
      ? await handler(init?.body ? JSON.parse(String(init.body)) : undefined, url)
      : { status: 404, body: { error: { code: "NOT_FOUND", message: "Resource not found.", details: {} } } };
    return new Response(JSON.stringify(reply.body), { status: reply.status ?? 200, headers: { "Content-Type": "application/json" } });
  });
  return calls;
}

export const categories = [
  { id: 1, code: "SLOW_BAR", name: "Omkoi Specialty Slow Bar (Pour-Over & Syphon)", prefix: "SB", description: null, estMinsPerTicket: 12, isOpen: true },
  { id: 2, code: "ESPRESSO_BAR", name: "Highland Espresso & Artisan Beverage Bar", prefix: "EB", description: null, estMinsPerTicket: 5, isOpen: true },
  { id: 3, code: "DESSERT_LOUNGE", name: "Chiang Rai Mist Tea & Highland Dessert Table", prefix: "DL", description: null, estMinsPerTicket: 15, isOpen: true },
  { id: 4, code: "ROASTERY_CONSULT", name: "Omkoi Roastery & Bean Wholesale Consultation", prefix: "RC", description: null, estMinsPerTicket: 20, isOpen: false },
];

export const ticket = (over: Record<string, unknown> = {}) => ({
  id: 10, ticketCode: "SB-001", categoryId: 1, categoryCode: "SLOW_BAR", categoryName: categories[0].name,
  customerId: 4, customerName: "Boom", partySize: 2, specialRequests: null, status: "WAITING", counterName: null,
  completionSummary: null, cancelReason: null, noShowNote: null, createdAt: "2026-11-15T03:00:00Z", aheadCount: 0, ...over,
});
