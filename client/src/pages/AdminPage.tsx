import { useCallback, useState, type FormEvent } from "react";
import { api, ApiError, type Category, type StaffMember } from "../api";
import { useAuth } from "../auth";
import { AppShell } from "../components/AppShell";
import { Empty, ErrorBanner, Loading } from "../components/States";
import { usePolling } from "../usePolling";

const input = "w-full rounded-md border border-limewash bg-white px-2 py-1.5 outline-none focus:border-terracotta";

/** Field errors from the API envelope (`details.fields`). */
const fieldsOf = (e: unknown) =>
  e instanceof ApiError && e.status === 400 ? ((e.details.fields as Record<string, string>) ?? {}) : {};

function FieldError({ message }: { message?: string }) {
  return message ? <span className="mt-0.5 block text-xs text-terracotta-dark">{message}</span> : null;
}

function CounterCard({
  category,
  staff,
  onChanged,
  onError,
}: {
  category: Category;
  staff: StaffMember[];
  onChanged: () => void;
  onError: (message: string) => void;
}) {
  const assigned = staff.filter((s) => s.categoryIds.includes(category.id)).map((s) => s.id);
  const [picked, setPicked] = useState<number[] | null>(null); // null = untouched, follow the server
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState({ name: category.name, estMinsPerTicket: String(category.estMinsPerTicket), description: category.description ?? "" });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const current = picked ?? assigned;

  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    try {
      await fn();
      return true;
    } catch (e) {
      const f = fieldsOf(e);
      if (Object.keys(f).length) setErrors(f);
      else onError((e as Error).message);
      return false;
    } finally {
      setBusy(false);
      onChanged();
    }
  };

  async function saveEdit(e: FormEvent) {
    e.preventDefault();
    setErrors({});
    const ok = await run(() =>
      api(`/categories/${category.id}`, {
        method: "PATCH",
        body: { name: form.name, estMinsPerTicket: Number(form.estMinsPerTicket), description: form.description },
      }),
    );
    if (ok) setEditing(false);
  }

  return (
    <article aria-label={`Counter ${category.prefix}`} className="flex flex-col gap-3 rounded-xl border border-limewash bg-white/80 p-4 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h3 className="font-semibold text-walnut">{category.name}</h3>
          <p className="text-xs text-walnut/70">
            <span className="font-mono">{category.code}</span> · prefix <span className="font-mono">{category.prefix}</span> · {category.waitingCount} waiting ·{" "}
            {category.estMinsPerTicket} min per guest
          </p>
        </div>
        <span className={category.isOpen ? "rounded-full bg-pine/15 px-2 py-0.5 text-xs font-semibold text-pine" : "rounded-full bg-walnut/10 px-2 py-0.5 text-xs font-semibold text-walnut/60"}>
          {category.isOpen ? "OPEN" : "PAUSED"}
        </span>
      </div>
      {category.description && !editing && <p className="text-sm text-ink/75">{category.description}</p>}

      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          disabled={busy}
          onClick={() => run(() => api(`/categories/${category.id}`, { method: "PATCH", body: { isOpen: !category.isOpen } }))}
          className="rounded-md bg-terracotta px-3 py-1.5 text-sm font-semibold text-white hover:bg-terracotta-dark disabled:opacity-60"
        >
          {category.isOpen ? "Pause" : "Resume"}
        </button>
        <button type="button" onClick={() => setEditing((v) => !v)} className="rounded-md border border-walnut/30 px-3 py-1.5 text-sm">
          {editing ? "Close" : "Edit"}
        </button>
      </div>

      {editing && (
        <form onSubmit={saveEdit} noValidate className="grid gap-2 text-sm sm:grid-cols-2">
          <label>
            <span className="text-xs text-walnut/70">Name</span>
            <input className={input} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
            <FieldError message={errors.name} />
          </label>
          <label>
            <span className="text-xs text-walnut/70">Minutes per guest</span>
            <input className={input} inputMode="numeric" value={form.estMinsPerTicket} onChange={(e) => setForm({ ...form, estMinsPerTicket: e.target.value })} />
            <FieldError message={errors.estMinsPerTicket} />
          </label>
          <label className="sm:col-span-2">
            <span className="text-xs text-walnut/70">Description</span>
            <textarea className={input} rows={2} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
            <FieldError message={errors.description} />
          </label>
          <button type="submit" disabled={busy} className="justify-self-start rounded-md bg-pine px-3 py-1.5 font-semibold text-white disabled:opacity-60">
            Save changes
          </button>
        </form>
      )}

      <fieldset className="text-sm">
        <legend className="text-xs text-walnut/70">Staff on this counter</legend>
        {staff.length === 0 ? (
          <p className="text-walnut/60">No staff accounts</p>
        ) : (
          <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1">
            {staff.map((s) => (
              <label key={s.id} className="flex items-center gap-1.5">
                <input
                  type="checkbox"
                  checked={current.includes(s.id)}
                  onChange={(e) => setPicked(e.target.checked ? [...current, s.id] : current.filter((id) => id !== s.id))}
                />
                {s.fullName}
              </label>
            ))}
          </div>
        )}
        <FieldError message={errors.staffIds} />
        <button
          type="button"
          disabled={busy || picked === null}
          onClick={async () => {
            setErrors({});
            if (await run(() => api(`/categories/${category.id}/staff`, { method: "PUT", body: { staffIds: current } }))) setPicked(null);
          }}
          className="mt-2 rounded-md border border-walnut/30 px-3 py-1.5 disabled:opacity-50"
        >
          Save staff
        </button>
      </fieldset>
    </article>
  );
}

function NewCounterForm({ onCreated }: { onCreated: () => void }) {
  const empty = { code: "", prefix: "", name: "", estMinsPerTicket: "10", description: "" };
  const [form, setForm] = useState(empty);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [banner, setBanner] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const set = (key: keyof typeof empty) => (e: { target: { value: string } }) => setForm({ ...form, [key]: e.target.value });

  async function submit(e: FormEvent) {
    e.preventDefault();
    setErrors({});
    setBanner(null);
    setBusy(true);
    try {
      await api("/categories", {
        method: "POST",
        body: { ...form, code: form.code.trim().toUpperCase(), prefix: form.prefix.trim().toUpperCase(), estMinsPerTicket: Number(form.estMinsPerTicket) },
      });
      setForm(empty);
      onCreated();
    } catch (err) {
      const f = fieldsOf(err);
      if (Object.keys(f).length) setErrors(f);
      else setBanner((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} noValidate aria-label="New counter" className="grid gap-2 rounded-xl bg-white/70 p-4 text-sm shadow-sm sm:grid-cols-2">
      <h3 className="font-semibold text-walnut sm:col-span-2">New counter</h3>
      {banner && (
        <div className="sm:col-span-2">
          <ErrorBanner message={banner} />
        </div>
      )}
      <label>
        <span className="text-xs text-walnut/70">Code (e.g. TEA_BAR)</span>
        <input className={input} value={form.code} onChange={set("code")} />
        <FieldError message={errors.code} />
      </label>
      <label>
        <span className="text-xs text-walnut/70">Prefix (2-5 letters)</span>
        <input className={input} value={form.prefix} onChange={set("prefix")} />
        <FieldError message={errors.prefix} />
      </label>
      <label>
        <span className="text-xs text-walnut/70">Counter name</span>
        <input className={input} value={form.name} onChange={set("name")} />
        <FieldError message={errors.name} />
      </label>
      <label>
        <span className="text-xs text-walnut/70">Minutes per guest (1-240)</span>
        <input className={input} inputMode="numeric" value={form.estMinsPerTicket} onChange={set("estMinsPerTicket")} />
        <FieldError message={errors.estMinsPerTicket} />
      </label>
      <label className="sm:col-span-2">
        <span className="text-xs text-walnut/70">Description (optional)</span>
        <textarea className={input} rows={2} value={form.description} onChange={set("description")} />
        <FieldError message={errors.description} />
      </label>
      <button type="submit" disabled={busy} className="justify-self-start rounded-md bg-terracotta px-4 py-2 font-semibold text-white hover:bg-terracotta-dark disabled:opacity-60">
        {busy ? "Creating…" : "Create counter"}
      </button>
    </form>
  );
}

/** Station manager page (F-04): counters, pause/resume, edit, staff assignment, new counter. */
export function AdminPage() {
  const { sessionEnded } = useAuth();
  const [categories, setCategories] = useState<Category[] | null>(null);
  const [staff, setStaff] = useState<StaffMember[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const [c, s] = await Promise.all([
        api<{ categories: Category[] }>("/categories"),
        api<{ staff: StaffMember[] }>("/staff"),
      ]);
      setCategories(c.categories);
      setStaff(s.staff);
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) sessionEnded();
      else setError((e as Error).message);
    }
  }, [sessionEnded]);
  usePolling(load);

  return (
    <AppShell title="Counter admin">
      <div className="space-y-6">
        {error && <ErrorBanner message={error} />}
        <h2 className="text-xl font-semibold text-walnut">Counters</h2>
        {!categories || !staff ? (
          !error && <Loading />
        ) : categories.length === 0 ? (
          <Empty message="No counters yet" />
        ) : (
          <div className="grid gap-4 lg:grid-cols-2">
            {categories.map((c) => (
              <CounterCard
                key={c.id}
                category={c}
                staff={staff}
                onChanged={() => void load()}
                onError={(m) => setError(m)}
              />
            ))}
          </div>
        )}
        <NewCounterForm onCreated={() => void load()} />
      </div>
    </AppShell>
  );
}
