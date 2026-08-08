export interface SearchTelemetryFilters {
  categories: string[];
  minRating: number;
  isVeg: boolean | null;
  priceRange: [number, number];
  sortBy: string | null;
  browseBeyond: boolean;
  radiusKm: number;
}

export function committedSearchKey(
  query: string,
  filters: SearchTelemetryFilters,
): string {
  return JSON.stringify({
    query: query.trim().toLowerCase(),
    ...filters,
    categories: [...filters.categories].sort(),
  });
}

export function getSessionQueryId(
  cache: Map<string, string>,
  key: string,
  createId: () => string = () => crypto.randomUUID(),
): string {
  const existing = cache.get(key);
  if (existing) return existing;

  const id = createId();
  cache.set(key, id);
  return id;
}
