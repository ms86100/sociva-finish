/**
 * Search query ↔ URL sync.
 *
 * HashRouter + URLSearchParams round-trip can trim or lag behind keystrokes.
 * If we hydrate `q` with `.trim()`, a typed space after a word ("jhol ") is
 * rewritten to "jhol", and the next letters concatenate ("jholmomo").
 */

export function readSearchQueryParam(searchParams: URLSearchParams): string {
  return searchParams.get('q') ?? '';
}

/**
 * Keep in-progress spaces when the URL is the same query with different
 * padding. Apply a different URL (back/forward, shared link, suggestion tap).
 */
export function resolveSearchQueryFromUrl(current: string, urlQuery: string): string {
  if (current === urlQuery) return current;

  const currentTrim = current.trim();
  const urlTrim = urlQuery.trim();

  if (currentTrim === urlTrim) return current;

  if (urlQuery && current.startsWith(urlQuery)) return current;
  if (urlTrim && current.startsWith(urlTrim)) return current;

  return urlQuery;
}
