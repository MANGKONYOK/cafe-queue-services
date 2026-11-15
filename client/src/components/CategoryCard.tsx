import type { ReactNode } from "react";
import type { Category } from "../api";

export function CategoryCard({ category, children }: { category: Category; children?: ReactNode }) {
  return (
    <article className="flex flex-col gap-2 rounded-xl border border-limewash bg-white/70 p-4 shadow-sm">
      <div className="flex items-start justify-between gap-2">
        <h3 className="font-semibold text-walnut">{category.name}</h3>
        <span
          className={
            category.isOpen
              ? "shrink-0 rounded-full bg-pine/15 px-2 py-0.5 text-xs font-semibold text-pine"
              : "shrink-0 rounded-full bg-walnut/10 px-2 py-0.5 text-xs font-semibold text-walnut/60"
          }
        >
          {category.isOpen ? "OPEN" : "PAUSED"}
        </span>
      </div>
      {category.description && <p className="text-sm text-ink/75">{category.description}</p>}
      <p className="text-xs text-walnut/70">
        Prefix <span className="font-mono">{category.prefix}</span> · {category.waitingCount} waiting · about {category.estMinsPerTicket} min per guest
      </p>
      {children}
    </article>
  );
}
