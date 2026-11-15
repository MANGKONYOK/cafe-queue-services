import { useId, useState, type FormEvent } from "react";

interface Props {
  title: string;
  label: string;
  min: number;
  max: number;
  confirm: string;
  onSubmit: (text: string) => Promise<void>;
  onClose: () => void;
}

/** Modal asking for a required note (cancel reason, completion summary, no-show note) with the API's limits. */
export function NoteDialog({ title, label, min, max, confirm, onSubmit, onClose }: Props) {
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const id = useId();

  async function submit(e: FormEvent) {
    e.preventDefault();
    const length = text.trim().length;
    if (length < min || length > max) {
      setError(`${label} must be ${min}-${max} characters.`);
      return;
    }
    setPending(true);
    try {
      await onSubmit(text.trim());
    } catch (err) {
      setError((err as Error).message);
      setPending(false);
    }
  }

  return (
    <div className="fixed inset-0 z-10 flex items-end justify-center bg-ink/40 p-4 sm:items-center" role="dialog" aria-modal="true" aria-label={title}>
      <form onSubmit={submit} noValidate className="w-full max-w-md space-y-3 rounded-2xl bg-mist p-5 shadow-xl">
        <h3 className="text-lg font-semibold text-walnut">{title}</h3>
        <div className="text-sm">
          <label htmlFor={id} className="font-medium">
            {label}
          </label>
          <textarea
            id={id}
            value={text}
            onChange={(e) => setText(e.target.value)}
            rows={3}
            maxLength={max + 50}
            aria-invalid={!!error}
            aria-describedby={`${id}-help`}
            className="mt-1 w-full rounded-md border border-limewash bg-white px-3 py-2 outline-none focus:border-terracotta"
          />
          <p id={`${id}-help`} className="mt-1 flex justify-between text-xs">
            <span className="text-terracotta-dark">{error}</span>
            <span className="text-walnut/60">
              {text.trim().length}/{max}
            </span>
          </p>
        </div>
        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} className="rounded-md px-3 py-2 text-sm text-walnut hover:bg-limewash">
            Back
          </button>
          <button type="submit" disabled={pending} className="rounded-md bg-terracotta px-4 py-2 text-sm font-semibold text-white hover:bg-terracotta-dark disabled:opacity-60">
            {pending ? "Saving…" : confirm}
          </button>
        </div>
      </form>
    </div>
  );
}
