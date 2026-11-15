import { AppShell } from "../components/AppShell";
import { CategoryCard } from "../components/CategoryCard";
import { Empty, ErrorBanner, Loading } from "../components/States";
import { useCategories } from "../useCategories";

/** Staff and admin home. F-01 shows the counters; F-03 adds the queue console and call-next. */
export function StaffPage() {
  const { categories, error } = useCategories();
  return (
    <AppShell title="Counter console">
      <h2 className="mb-4 text-xl font-semibold text-walnut">Counters</h2>
      {error && <ErrorBanner message={error} />}
      {!error && !categories && <Loading />}
      {categories && categories.length === 0 && <Empty message="No counters available" />}
      {categories && categories.length > 0 && (
        <div className="grid gap-4 sm:grid-cols-2">
          {categories.map((c) => (
            <CategoryCard key={c.id} category={c} />
          ))}
        </div>
      )}
    </AppShell>
  );
}
