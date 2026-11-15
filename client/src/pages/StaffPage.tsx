import { useCallback, useEffect, useMemo, useState } from "react";
import { ACTIVE, api, ApiError, type Category, type Ticket, type TicketStatus } from "../api";
import { useAuth } from "../auth";
import { AppShell } from "../components/AppShell";
import { NoteDialog } from "../components/NoteDialog";
import { Empty, ErrorBanner, Loading } from "../components/States";
import { StatusBadge } from "../components/StatusBadge";
import { usePolling } from "../usePolling";

type Filter = "ACTIVE" | TicketStatus;
const FILTERS: Filter[] = ["ACTIVE", "WAITING", "CALLED", "SERVING", "COMPLETED", "NO_SHOW", "CANCELLED"];

type Dialog = { ticket: Ticket; kind: "complete" | "no-show" | "cancel" };
const DIALOG = {
  complete: { title: "Complete service", label: "Completion summary", min: 5, max: 500, confirm: "Complete", field: "completionSummary" },
  "no-show": { title: "Mark no-show", label: "No-show note", min: 3, max: 200, confirm: "Mark no-show", field: "noShowNote" },
  cancel: { title: "Cancel ticket", label: "Reason", min: 3, max: 200, confirm: "Cancel ticket", field: "cancelReason" },
} as const;

/** Staff and admin console (F-03): one tab per assigned counter, call next, serve, complete, no-show, cancel. */
export function StaffPage() {
  const { user, sessionEnded, refresh } = useAuth();
  const [categories, setCategories] = useState<Category[] | null>(null);
  const [tab, setTab] = useState<number | null>(null);
  const [filter, setFilter] = useState<Filter>("ACTIVE");
  const [tickets, setTickets] = useState<Ticket[] | null>(null);
  const [station, setStation] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [dialog, setDialog] = useState<Dialog | null>(null);

  const counters = useMemo(
    () => (categories ?? []).filter((c) => user?.assignedCategoryIds?.includes(c.id)),
    [categories, user],
  );
  const current = tab ?? counters[0]?.id ?? null;

  const fail = useCallback(
    (e: unknown) => {
      if (e instanceof ApiError && e.status === 401) sessionEnded();
      else setError((e as Error).message);
    },
    [sessionEnded],
  );

  const load = useCallback(async () => {
    try {
      // Re-read the counters and the user's assignments on every refresh, so a counter the admin
      // just created, a rename, a pause or an assignment change shows up without a page reload.
      const [c, me] = await Promise.all([api<{ categories: Category[] }>("/categories"), refresh()]);
      setCategories(c.categories);
      if (!me) return;
      const id = tab ?? c.categories.find((x) => me.assignedCategoryIds?.includes(x.id))?.id;
      if (id === undefined) return setTickets([]);
      setTickets((await api<{ tickets: Ticket[] }>(`/tickets?categoryId=${id}`)).tickets);
    } catch (e) {
      fail(e);
    }
  }, [tab, refresh, fail]);
  usePolling(load);
  // Switching counters fetches that counter's queue at once instead of waiting for the next poll.
  useEffect(() => {
    if (tab !== null) void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab]);

  const act = async (path: string, body: unknown = {}) => {
    setBusy(true);
    setError(null);
    try {
      await api(path, { method: "POST", body });
    } catch (e) {
      fail(e);
    } finally {
      setBusy(false);
      void load();
    }
  };

  const waiting = tickets?.filter((t) => t.status === "WAITING").length ?? 0;
  const shown = (tickets ?? []).filter((t) => (filter === "ACTIVE" ? ACTIVE.includes(t.status) : t.status === filter));

  return (
    <AppShell title="Counter console">
      {error && <ErrorBanner message={error} />}
      {!categories ? (
        !error && <Loading />
      ) : counters.length === 0 ? (
        <Empty message="No counters are assigned to you" />
      ) : (
        <div className="space-y-4">
          <div role="tablist" aria-label="Counters" className="flex flex-wrap gap-2">
            {counters.map((c) => (
              <button
                key={c.id}
                role="tab"
                aria-selected={c.id === current}
                onClick={() => {
                  if (c.id === current) return; // already showing this counter: keep the list
                  setTab(c.id);
                  setTickets(null);
                }}
                className={`rounded-full px-4 py-1.5 text-sm font-medium ${c.id === current ? "bg-walnut text-mist" : "bg-limewash text-walnut hover:bg-limewash/70"}`}
              >
                {c.prefix} · {c.name.split(" (")[0]}
              </button>
            ))}
          </div>

          <div className="flex flex-wrap items-end gap-3 rounded-xl bg-white/70 p-4 shadow-sm">
            <div>
              <p className="text-xs uppercase tracking-wide text-walnut/60">Waiting</p>
              <p className="text-3xl font-bold text-walnut" aria-label="Waiting count">
                {tickets ? waiting : "…"}
              </p>
            </div>
            <label className="text-sm">
              <span className="block text-xs text-walnut/70">Station (optional)</span>
              <input
                value={station}
                onChange={(e) => setStation(e.target.value)}
                maxLength={50}
                placeholder="e.g. Slow Bar 1"
                className="rounded-md border border-limewash bg-white px-2 py-1.5"
              />
            </label>
            <button
              type="button"
              disabled={busy || waiting === 0}
              onClick={() => act(`/categories/${current}/call-next`, { counterName: station.trim() || null })}
              className="rounded-md bg-terracotta px-5 py-2 font-semibold text-white hover:bg-terracotta-dark disabled:opacity-50"
            >
              Call next
            </button>
            <label className="ml-auto text-sm">
              <span className="block text-xs text-walnut/70">Show</span>
              <select value={filter} onChange={(e) => setFilter(e.target.value as Filter)} className="rounded-md border border-limewash bg-white px-2 py-1.5">
                {FILTERS.map((f) => (
                  <option key={f} value={f}>
                    {f === "ACTIVE" ? "Active" : f.replace("_", " ").toLowerCase()}
                  </option>
                ))}
              </select>
            </label>
          </div>

          {!tickets ? (
            <Loading />
          ) : shown.length === 0 ? (
            <Empty message={filter === "ACTIVE" ? "No guests waiting" : "No tickets with this status"} />
          ) : (
            <ul className="space-y-2">
              {shown.map((t) => (
                <li key={t.id} className="flex flex-wrap items-center gap-3 rounded-xl border border-limewash bg-white/80 p-3" aria-label={`Ticket ${t.ticketCode}`}>
                  <span className="font-mono text-lg font-bold text-walnut">{t.ticketCode}</span>
                  <StatusBadge status={t.status} />
                  <span className="text-sm">
                    {t.customerName} · party of {t.partySize}
                  </span>
                  {t.specialRequests && <span className="w-full text-xs text-ink/70 sm:w-auto">“{t.specialRequests}”</span>}
                  <span className="ml-auto flex flex-wrap gap-2">
                    {t.status === "CALLED" && (
                      <>
                        <button disabled={busy} onClick={() => act(`/tickets/${t.id}/serve`)} className="rounded-md bg-pine px-3 py-1.5 text-sm font-semibold text-white disabled:opacity-50">
                          Start serving
                        </button>
                        <button disabled={busy} onClick={() => setDialog({ ticket: t, kind: "no-show" })} className="rounded-md border border-walnut/30 px-3 py-1.5 text-sm">
                          No-show
                        </button>
                      </>
                    )}
                    {t.status === "SERVING" && (
                      <button disabled={busy} onClick={() => setDialog({ ticket: t, kind: "complete" })} className="rounded-md bg-pine px-3 py-1.5 text-sm font-semibold text-white disabled:opacity-50">
                        Complete
                      </button>
                    )}
                    {(t.status === "WAITING" || t.status === "CALLED") && (
                      <button disabled={busy} onClick={() => setDialog({ ticket: t, kind: "cancel" })} className="rounded-md border border-walnut/30 px-3 py-1.5 text-sm">
                        Cancel
                      </button>
                    )}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {dialog && (
        <NoteDialog
          {...DIALOG[dialog.kind]}
          title={`${DIALOG[dialog.kind].title} - ${dialog.ticket.ticketCode}`}
          onClose={() => setDialog(null)}
          onSubmit={async (text) => {
            setDialog(null);
            await act(`/tickets/${dialog.ticket.id}/${dialog.kind}`, { [DIALOG[dialog.kind].field]: text });
          }}
        />
      )}
    </AppShell>
  );
}
