import { useCallback, useState, type FormEvent } from "react";
import { ACTIVE, api, ApiError, type Category, type Ticket } from "../api";
import { useAuth } from "../auth";
import { AppShell } from "../components/AppShell";
import { CategoryCard } from "../components/CategoryCard";
import { NoteDialog } from "../components/NoteDialog";
import { Empty, ErrorBanner, Loading } from "../components/States";
import { StatusBadge } from "../components/StatusBadge";
import { usePolling } from "../usePolling";

function JoinForm({ category, onJoined, onError }: { category: Category; onJoined: () => void; onError: (m: string) => void }) {
  const [partySize, setPartySize] = useState(2);
  const [requests, setRequests] = useState("");
  const [pending, setPending] = useState(false);
  const tooLong = requests.trim().length > 280;

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (tooLong) return;
    setPending(true);
    try {
      await api("/tickets", { method: "POST", body: { categoryId: category.id, partySize, specialRequests: requests.trim() || null } });
      setRequests("");
      onJoined();
    } catch (err) {
      onError((err as Error).message);
    } finally {
      setPending(false);
    }
  }

  return (
    <form onSubmit={submit} className="mt-1 flex flex-col gap-2 border-t border-limewash pt-3 text-sm">
      <div className="flex flex-wrap items-center gap-2">
        <label htmlFor={`party-${category.id}`} className="font-medium">
          Party size
        </label>
        <select
          id={`party-${category.id}`}
          value={partySize}
          onChange={(e) => setPartySize(Number(e.target.value))}
          className="rounded-md border border-limewash bg-white px-2 py-1"
        >
          {[1, 2, 3, 4, 5, 6, 7, 8].map((n) => (
            <option key={n} value={n}>
              {n}
            </option>
          ))}
        </select>
      </div>
      <label className="block">
        <span className="sr-only">Special requests for {category.name}</span>
        <textarea
          value={requests}
          onChange={(e) => setRequests(e.target.value)}
          rows={2}
          placeholder="Special requests (optional)"
          aria-invalid={tooLong}
          className="w-full rounded-md border border-limewash bg-white px-3 py-2 outline-none focus:border-terracotta"
        />
        <span className={`block text-right text-xs ${tooLong ? "text-terracotta-dark" : "text-walnut/60"}`}>
          {requests.trim().length}/280
        </span>
      </label>
      <button
        type="submit"
        disabled={pending || tooLong}
        className="self-start rounded-md bg-terracotta px-4 py-2 font-semibold text-white hover:bg-terracotta-dark disabled:opacity-60"
      >
        {pending ? "Joining…" : `Join ${category.prefix} queue`}
      </button>
    </form>
  );
}

function TicketCard({ ticket, onCancel }: { ticket: Ticket; onCancel?: () => void }) {
  return (
    <article className="flex flex-col gap-1 rounded-xl border border-limewash bg-white/80 p-4 shadow-sm" aria-label={`Ticket ${ticket.ticketCode}`}>
      <div className="flex items-center justify-between gap-2">
        <span className="font-mono text-2xl font-bold text-walnut">{ticket.ticketCode}</span>
        <StatusBadge status={ticket.status} />
      </div>
      <p className="text-sm text-ink/75">{ticket.categoryName}</p>
      {ticket.status === "WAITING" && (
        <p className="text-sm font-medium text-walnut">
          {ticket.aheadCount === 0 ? "0 ahead - you're next" : `${ticket.aheadCount} ahead · about ${ticket.estWaitMins} min`}
        </p>
      )}
      {ticket.status === "CALLED" && (
        <p className="text-sm font-semibold text-terracotta-dark">Please go to {ticket.counterName ?? "the counter"} now.</p>
      )}
      {ticket.status === "SERVING" && <p className="text-sm text-pine">Your order is being prepared.</p>}
      {onCancel && (
        <button type="button" onClick={onCancel} className="mt-1 self-start rounded-md border border-walnut/30 px-3 py-1 text-sm hover:bg-limewash">
          Cancel ticket
        </button>
      )}
    </article>
  );
}

/** Customer home (F-02): counters, join, my tickets with position, cancel while waiting. */
export function QueuePage() {
  const { sessionEnded } = useAuth();
  const [categories, setCategories] = useState<Category[] | null>(null);
  const [tickets, setTickets] = useState<Ticket[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [cancelling, setCancelling] = useState<Ticket | null>(null);

  const load = useCallback(async () => {
    try {
      const [c, t] = await Promise.all([
        api<{ categories: Category[] }>("/categories"),
        api<{ tickets: Ticket[] }>("/tickets/my"),
      ]);
      setCategories(c.categories);
      setTickets(t.tickets);
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) sessionEnded();
      else setError((e as Error).message);
    }
  }, [sessionEnded]);
  usePolling(load);

  const active = tickets?.filter((t) => ACTIVE.includes(t.status)) ?? [];
  const finished = tickets?.filter((t) => !ACTIVE.includes(t.status)) ?? [];
  const activeIn = (categoryId: number) => active.some((t) => t.categoryId === categoryId);

  return (
    <AppShell title="Customer queue">
      {error && <ErrorBanner message={error} />}
      {!categories || !tickets ? (
        !error && <Loading />
      ) : (
        <div className="space-y-8">
          <section>
            <h2 className="mb-3 text-xl font-semibold text-walnut">My tickets</h2>
            {active.length === 0 ? (
              <Empty message="No active tickets - join a counter below" />
            ) : (
              <div className="grid gap-4 sm:grid-cols-2">
                {active.map((t) => (
                  <TicketCard key={t.id} ticket={t} onCancel={t.status === "WAITING" ? () => setCancelling(t) : undefined} />
                ))}
              </div>
            )}
          </section>

          <section>
            <h2 className="mb-3 text-xl font-semibold text-walnut">Choose a counter</h2>
            {categories.length === 0 ? (
              <Empty message="No counters available" />
            ) : (
              <div className="grid gap-4 sm:grid-cols-2">
                {categories.map((c) => (
                  <CategoryCard key={c.id} category={c}>
                    {!c.isOpen ? (
                      <p className="text-sm text-walnut/60">Paused - not taking new guests right now.</p>
                    ) : activeIn(c.id) ? (
                      <p className="text-sm font-medium text-pine">You're in this queue.</p>
                    ) : (
                      <JoinForm
                        category={c}
                        onJoined={() => {
                          setError(null);
                          void load();
                        }}
                        onError={(m) => {
                          setError(m);
                          void load();
                        }}
                      />
                    )}
                  </CategoryCard>
                ))}
              </div>
            )}
          </section>

          {finished.length > 0 && (
            <section>
              <h2 className="mb-3 text-lg font-semibold text-walnut">Earlier tickets</h2>
              <div className="grid gap-3 sm:grid-cols-2">
                {finished.map((t) => (
                  <TicketCard key={t.id} ticket={t} />
                ))}
              </div>
            </section>
          )}
        </div>
      )}

      {cancelling && (
        <NoteDialog
          title={`Cancel ${cancelling.ticketCode}?`}
          label="Reason"
          min={3}
          max={200}
          confirm="Cancel ticket"
          onClose={() => setCancelling(null)}
          onSubmit={async (cancelReason) => {
            try {
              await api(`/tickets/${cancelling.id}/cancel`, { method: "POST", body: { cancelReason } });
              setError(null);
            } catch (e) {
              // e.g. 409 when staff called the ticket just before the guest confirmed (f02 section 6)
              if (e instanceof ApiError && e.status === 401) sessionEnded();
              else setError((e as Error).message);
            } finally {
              setCancelling(null);
              void load();
            }
          }}
        />
      )}
    </AppShell>
  );
}
