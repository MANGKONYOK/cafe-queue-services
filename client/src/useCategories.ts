import { useEffect, useState } from "react";
import { api, ApiError, type Category } from "./api";
import { useAuth } from "./auth";

export function useCategories() {
  const { sessionEnded } = useAuth();
  const [categories, setCategories] = useState<Category[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api<{ categories: Category[] }>("/categories")
      .then((r) => setCategories(r.categories))
      .catch((e: ApiError) => (e.status === 401 ? sessionEnded() : setError(e.message)));
  }, [sessionEnded]);

  return { categories, error };
}
