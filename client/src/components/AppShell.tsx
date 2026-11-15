import type { ReactNode } from "react";
import { useState } from "react";
import { NavLink } from "react-router-dom";
import { useAuth } from "../auth";

export function AppShell({ title, children }: { title: string; children: ReactNode }) {
  const { user, logout } = useAuth();
  const [signingOut, setSigningOut] = useState(false);

  return (
    <div className="min-h-dvh">
      <header className="bg-walnut text-mist">
        <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-3 px-4 py-3">
          <div>
            <p className="text-lg font-semibold tracking-wide">Omkoi Station</p>
            <p className="text-xs text-mist/70">สถานีอมก๋อย · {title}</p>
          </div>
          <div className="flex flex-wrap items-center gap-3 text-sm">
            {user?.role === "ADMIN" && (
              <nav aria-label="Admin" className="flex gap-1">
                {[["/staff", "Console"], ["/admin", "Counters"]].map(([to, label]) => (
                  <NavLink
                    key={to}
                    to={to}
                    className={({ isActive }) => `rounded-md px-3 py-1.5 ${isActive ? "bg-walnut-dark text-mist" : "text-mist/80 hover:bg-walnut-dark"}`}
                  >
                    {label}
                  </NavLink>
                ))}
              </nav>
            )}
            <span>
              {user?.fullName} <span className="text-mist/60">({user?.role.toLowerCase()})</span>
            </span>
            <button
              type="button"
              disabled={signingOut}
              onClick={async () => {
                setSigningOut(true);
                try {
                  await logout();
                } finally {
                  setSigningOut(false);
                }
              }}
              className="rounded-md border border-mist/40 px-3 py-1.5 hover:bg-walnut-dark disabled:opacity-60"
            >
              Sign out
            </button>
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-5xl px-4 py-6">{children}</main>
    </div>
  );
}
