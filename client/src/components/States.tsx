export function Loading({ label = "Loading…" }: { label?: string }) {
  return (
    <div role="status" aria-live="polite" className="flex items-center gap-3 py-8 text-walnut/70">
      <span className="size-4 animate-spin rounded-full border-2 border-terracotta border-t-transparent" aria-hidden />
      {label}
    </div>
  );
}

export function ErrorBanner({ message }: { message: string }) {
  return (
    <div role="alert" className="rounded-lg border border-terracotta/40 bg-terracotta/10 px-4 py-3 text-sm text-terracotta-dark">
      {message}
    </div>
  );
}

export function Empty({ message }: { message: string }) {
  return <p className="rounded-lg border border-dashed border-walnut/25 px-4 py-8 text-center text-walnut/70">{message}</p>;
}
