import { useState, type FormEvent } from "react";
import { Navigate, useNavigate } from "react-router-dom";
import { ApiError, homeFor } from "../api";
import { useAuth } from "../auth";
import { ErrorBanner } from "../components/States";

export function LoginPage() {
  const { user, login } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [fieldErrors, setFieldErrors] = useState<{ email?: string; password?: string }>({});
  const [banner, setBanner] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  if (user) return <Navigate to={homeFor(user.role)} replace />;

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    const errors = {
      email: email.trim() ? undefined : "Email is required.",
      password: password ? undefined : "Password is required.",
    };
    setFieldErrors(errors);
    setBanner(null);
    if (errors.email || errors.password) return;
    setPending(true);
    try {
      const u = await login(email, password);
      navigate(homeFor(u.role), { replace: true });
    } catch (err) {
      setBanner(err instanceof ApiError && err.status === 401 ? "Invalid email or password." : (err as Error).message);
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="flex min-h-dvh items-center justify-center px-4">
      <form onSubmit={onSubmit} noValidate className="w-full max-w-sm space-y-4 rounded-2xl bg-white/80 p-6 shadow-md">
        <div>
          <h1 className="text-2xl font-semibold text-walnut">Omkoi Station</h1>
          <p className="text-sm text-walnut/70">Sign in to join a counter or run the queue.</p>
        </div>
        {banner && <ErrorBanner message={banner} />}
        <label className="block text-sm">
          <span className="font-medium">Email</span>
          <input
            type="email"
            autoComplete="username"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            aria-invalid={!!fieldErrors.email}
            className="mt-1 w-full rounded-md border border-limewash bg-white px-3 py-2 outline-none focus:border-terracotta"
          />
          {fieldErrors.email && <span className="mt-1 block text-xs text-terracotta-dark">{fieldErrors.email}</span>}
        </label>
        <label className="block text-sm">
          <span className="font-medium">Password</span>
          <input
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            aria-invalid={!!fieldErrors.password}
            className="mt-1 w-full rounded-md border border-limewash bg-white px-3 py-2 outline-none focus:border-terracotta"
          />
          {fieldErrors.password && <span className="mt-1 block text-xs text-terracotta-dark">{fieldErrors.password}</span>}
        </label>
        <button
          type="submit"
          disabled={pending}
          className="w-full rounded-md bg-terracotta px-4 py-2 font-semibold text-white hover:bg-terracotta-dark disabled:opacity-60"
        >
          {pending ? "Signing in…" : "Sign in"}
        </button>
      </form>
    </div>
  );
}
