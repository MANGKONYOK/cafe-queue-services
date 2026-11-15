import { AppShell } from "../components/AppShell";
import { CategoryCard } from "../components/CategoryCard";
import { Empty, ErrorBanner, Loading } from "../components/States";
import { useCategories } from "../useCategories";

/** Customer home. F-01 lists the counters; F-02 adds joining, my tickets and cancel. */
export function QueuePage() {
  const { categories, error } = useCategories();
  return (
    <AppShell title="Customer queue">
      <h2 className="mb-4 text-xl font-semibold text-walnut">Choose a counter</h2>
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
