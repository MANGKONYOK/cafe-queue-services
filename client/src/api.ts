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
}

export interface Category {
  id: number;
  code: string;
  name: string;
  prefix: string;
  description: string | null;
  estMinsPerTicket: number;
  isOpen: boolean;
}

export const homeFor = (role: Role) => (role === "CUSTOMER" ? "/queue" : "/staff");
