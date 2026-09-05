export const SEARCH_PREVIEW_LIMIT = 12;
const STRONG_MATCH_SCORE = 70;
/** Typed queries must beat proximity-only browse rows (baseline used to be 20). */
export const MIN_TEXT_SEARCH_SCORE = 36;

export type SearchRankable = {
  product_name: string;
  seller_name?: string | null;
  category?: string | null;
  description?: string | null;
  is_same_society?: boolean | null;
  distance_km?: number | null;
};

export function tokenizeSearchQuery(query: string): string[] {
  return query.trim().toLowerCase().split(/\s+/).filter((token) => token.length > 0);
}

export function collapseSearchText(value: string): string {
  return value.toLowerCase().replace(/\s+/g, '');
}

export function scoreSearchHit(query: string, item: SearchRankable): number {
  const q = query.trim().toLowerCase();
  if (q.length < 2) return 0;

  const name = (item.product_name || '').toLowerCase();
  const seller = (item.seller_name || '').toLowerCase();
  const category = (item.category || '').toLowerCase();
  const description = (item.description || '').toLowerCase();
  const tokens = tokenizeSearchQuery(q);
  const qCollapsed = collapseSearchText(q);
  const nameCollapsed = collapseSearchText(name);
  const meaningfulTokens = tokens.filter((token) => token.length >= 2);

  let score = 0;
  if (name === q) score = 100;
  else if (name.startsWith(q)) score = 92;
  else if (name.includes(q)) score = 86;
  else if (qCollapsed.length >= 3 && nameCollapsed.includes(qCollapsed)) score = 82;
  else if (meaningfulTokens.length > 1 && meaningfulTokens.every((token) => name.includes(token))) score = 78;
  else if (
    meaningfulTokens.length > 0 &&
    meaningfulTokens.every(
      (token) => name.includes(token) || seller.includes(token) || description.includes(token) || category.includes(token),
    )
  ) {
    score = name.includes(meaningfulTokens[0]) ? 74 : 68;
  } else if (seller.includes(q) || (meaningfulTokens.length > 0 && meaningfulTokens.every((token) => seller.includes(token)))) {
    score = 64;
  } else if (category.includes(q) || tokens.some((token) => token.length >= 3 && category.includes(token))) {
    score = 58;
  } else if (tokens.some((token) => token.length >= 3 && (name.includes(token) || seller.includes(token)))) {
    score = 42;
  } else if (description.includes(q)) {
    score = 36;
  }

  if (score === 0) return 0;
  if (item.is_same_society) score += 6;
  const distance = item.distance_km;
  if (distance != null && distance < 2) score += 3;
  else if (distance != null && distance < 5) score += 1;

  return score;
}

export function selectSearchResultsForDisplay<T extends SearchRankable>(
  query: string,
  items: T[],
  isTextSearch: boolean,
): { items: T[]; preview: T[]; hiddenCount: number } {
  if (!isTextSearch || query.trim().length < 2 || items.length === 0) {
    return { items, preview: items, hiddenCount: 0 };
  }

  const scored = items
    .map((item) => ({ item, score: scoreSearchHit(query, item) }))
    .filter((entry) => entry.score >= MIN_TEXT_SEARCH_SCORE)
    .sort((a, b) => b.score - a.score);
  const sorted = scored.map((entry) => entry.item);

  if (sorted.length === 0) {
    return { items: [], preview: [], hiddenCount: 0 };
  }

  if (sorted.length <= SEARCH_PREVIEW_LIMIT) {
    return { items: sorted, preview: sorted, hiddenCount: 0 };
  }

  const strong = scored.filter((entry) => entry.score >= STRONG_MATCH_SCORE);
  const weakCount = scored.filter((entry) => entry.score < 50).length;
  const preferStrong = strong.length >= 3 && weakCount > 8;

  const preview = preferStrong && strong.length <= 16
    ? strong.map((entry) => entry.item)
    : sorted.slice(0, SEARCH_PREVIEW_LIMIT);

  return {
    items: sorted,
    preview,
    hiddenCount: Math.max(0, sorted.length - preview.length),
  };
}
