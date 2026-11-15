import type { TicketStatus } from "../api";

const STYLE: Record<TicketStatus, string> = {
  WAITING: "bg-limewash text-walnut",
  CALLED: "bg-terracotta text-white",
  SERVING: "bg-pine text-white",
  COMPLETED: "bg-pine/15 text-pine",
  NO_SHOW: "bg-walnut/10 text-walnut/70",
  CANCELLED: "bg-walnut/10 text-walnut/70",
};

export function StatusBadge({ status }: { status: TicketStatus }) {
  return <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${STYLE[status]}`}>{status.replace("_", " ")}</span>;
}
