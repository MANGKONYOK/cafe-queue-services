/** Ticket lifecycle (BR-04): the single source of the legal transitions. */
export const STATUSES = ["WAITING", "CALLED", "SERVING", "COMPLETED", "NO_SHOW", "CANCELLED"] as const;
export type TicketStatus = (typeof STATUSES)[number];

export const ACTIVE_STATUSES: TicketStatus[] = ["WAITING", "CALLED", "SERVING"];

const LEGAL: Record<TicketStatus, TicketStatus[]> = {
  WAITING: ["CALLED", "CANCELLED"],
  CALLED: ["SERVING", "NO_SHOW", "CANCELLED"],
  SERVING: ["COMPLETED"],
  COMPLETED: [],
  NO_SHOW: [],
  CANCELLED: [],
};

export const isLegal = (from: TicketStatus, to: TicketStatus) => LEGAL[from].includes(to);

const into = (to: TicketStatus) => ({ from: STATUSES.filter((s) => isLegal(s, to)), to });

export type Action = "call" | "serve" | "complete" | "noShow" | "cancel";

/** Each staff action and the statuses it may start from, derived from LEGAL. */
export const TRANSITIONS: Record<Action, { from: TicketStatus[]; to: TicketStatus }> = {
  call: into("CALLED"),
  serve: into("SERVING"),
  complete: into("COMPLETED"),
  noShow: into("NO_SHOW"),
  cancel: into("CANCELLED"),
};

/** BR-06: once called, only staff may cancel. */
export const CUSTOMER_CANCEL_FROM: TicketStatus[] = ["WAITING"];

/** BR-07: `<PREFIX>-<NNN>`, growing past 999 without truncation. */
export const formatTicketCode = (prefix: string, seq: number) => `${prefix}-${String(seq).padStart(3, "0")}`;
