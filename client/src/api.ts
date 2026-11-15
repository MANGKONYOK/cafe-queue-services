/** Error shape of the API envelope `{ error: { code, message, details } }`. */
export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly details: Record<string, unknown> = {},
  ) {
    super(message);
  }
}

const GENERIC = "Something went wrong - try again.";

/** Same-origin JSON call with the session cookie. 5xx and network errors never show technical detail. */
export async function api<T>(path: string, options: { method?: string; body?: unknown } = {}): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`/api${path}`, {
      method: options.method ?? "GET",
      credentials: "include",
      headers: options.body === undefined ? undefined : { "Content-Type": "application/json" },
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
    });
  } catch {
    throw new ApiError(0, "NETWORK_ERROR", GENERIC);
  }
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    const e = data?.error;
    if (res.status >= 500 || !e) throw new ApiError(res.status, e?.code ?? "INTERNAL_ERROR", GENERIC);
    throw new ApiError(res.status, e.code, e.message, e.details ?? {});
  }
  return data as T;
}

export type Role = "CUSTOMER" | "STAFF" | "ADMIN";

export interface User {
  id: number;
  email: string;
  fullName: string;
  role: Role;
  /** Counters a STAFF/ADMIN user may operate (BR-09); absent for customers. */
  assignedCategoryIds?: number[];
}

export type TicketStatus = "WAITING" | "CALLED" | "SERVING" | "COMPLETED" | "NO_SHOW" | "CANCELLED";
export const ACTIVE: TicketStatus[] = ["WAITING", "CALLED", "SERVING"];

export interface Ticket {
  id: number;
  ticketCode: string;
  categoryId: number;
  categoryCode: string;
  categoryName: string;
  customerId: number;
  customerName: string;
  partySize: number;
  specialRequests: string | null;
  status: TicketStatus;
  counterName: string | null;
  completionSummary: string | null;
  cancelReason: string | null;
  noShowNote: string | null;
  createdAt: string;
  aheadCount: number | null;
  /** aheadCount x the counter's minutes per guest; null once no longer WAITING. */
  estWaitMins: number | null;
}

export interface Category {
  id: number;
  code: string;
  name: string;
  prefix: string;
  description: string | null;
  estMinsPerTicket: number;
  isOpen: boolean;
  waitingCount: number;
}

export interface StaffMember {
  id: number;
  fullName: string;
  email: string;
  categoryIds: number[];
}

export const homeFor = (role: Role) => (role === "CUSTOMER" ? "/queue" : "/staff");
