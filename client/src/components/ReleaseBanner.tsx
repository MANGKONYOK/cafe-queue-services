import { useEffect, useState } from "react";
import { api } from "../api";

/** Shows which release is running: the short commit SHA from /api/health (APP_VERSION, C-06, R-08). */
export function ReleaseBanner() {
  const [version, setVersion] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    api<{ status: string; version?: string }>("/health")
      .then((h) => {
        if (active && h.version) setVersion(h.version);
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, []);

  if (!version) return null;
  const label = /^[0-9a-f]{40}$/.test(version) ? version.slice(0, 7) : version;
  return (
    <div
      role="status"
      aria-label="Release"
      title={version}
      className="pointer-events-none fixed bottom-3 right-3 rounded-full bg-walnut px-3 py-1 font-mono text-xs text-mist shadow-md"
    >
      Release {label}
    </div>
  );
}
