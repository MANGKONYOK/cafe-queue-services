import { useEffect, useRef } from "react";

/** Calls `fn` now, then every `ms` while the page is visible (SDS 3.1: refresh every 10 seconds). */
export function usePolling(fn: () => void, ms = 10_000) {
  const ref = useRef(fn);
  ref.current = fn;
  useEffect(() => {
    ref.current();
    const timer = setInterval(() => {
      if (document.visibilityState === "visible") ref.current();
    }, ms);
    return () => clearInterval(timer);
  }, [ms]);
}
