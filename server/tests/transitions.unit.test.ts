import { describe, expect, it } from "vitest";
import { CUSTOMER_CANCEL_FROM, STATUSES, TRANSITIONS, formatTicketCode, isLegal } from "../src/domain/tickets.js";

describe("TEST-11 (unit) / BR-04: the transition table", () => {
  const legal = new Set(["WAITING>CALLED", "WAITING>CANCELLED", "CALLED>SERVING", "CALLED>NO_SHOW", "CALLED>CANCELLED", "SERVING>COMPLETED"]);

  it("allows exactly the six legal pairs and rejects every other pair", () => {
    for (const from of STATUSES) for (const to of STATUSES) {
      expect(isLegal(from, to), `${from} -> ${to}`).toBe(legal.has(`${from}>${to}`));
    }
  });

  it("derives every action from the legal pairs; terminal states have no way out", () => {
    for (const { from, to } of Object.values(TRANSITIONS)) for (const f of from) expect(isLegal(f, to)).toBe(true);
    for (const terminal of ["COMPLETED", "NO_SHOW", "CANCELLED"] as const) {
      expect(STATUSES.some((to) => isLegal(terminal, to))).toBe(false);
    }
  });

  it("lets a customer cancel only from WAITING (BR-06)", () => {
    expect(CUSTOMER_CANCEL_FROM).toEqual(["WAITING"]);
  });
});

describe("BR-07 (unit): ticket codes", () => {
  it("pads to three digits and grows past 999 without truncating", () => {
    expect(formatTicketCode("SB", 1)).toBe("SB-001");
    expect(formatTicketCode("EB", 42)).toBe("EB-042");
    expect(formatTicketCode("DL", 999)).toBe("DL-999");
    expect(formatTicketCode("SB", 1000)).toBe("SB-1000");
  });
});
