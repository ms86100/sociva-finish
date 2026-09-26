/** Soft penalty so a second item from the same seller loses to an equal item from someone else. */
export const SELLER_REPEAT_PENALTY = 8;
export const SELLER_MAX_CONSECUTIVE = 2;
/** Small enough that a clearly closer or better match still wins. */
export const NEW_SELLER_BOOST = 4;
const NEW_SELLER_WINDOW_MS = 14 * 24 * 60 * 60 * 1000;

export function isSellerDiversityEnabled(): boolean {
  const flag = String(import.meta.env.VITE_SELLER_DIVERSITY ?? '').trim().toLowerCase();
  if (flag === '0' || flag === 'false' || flag === 'off') return false;
  return true;
}

export function shouldDiversifySort(sortBy: string | null | undefined): boolean {
  if (!isSellerDiversityEnabled()) return false;
  return sortBy == null || sortBy === '' || sortBy === 'relevance';
}

export function newSellerBaseBoost(createdAt: string | null | undefined, now = Date.now()): number {
  if (!createdAt) return 0;
  const created = new Date(createdAt).getTime();
  if (!Number.isFinite(created)) return 0;
  const age = now - created;
  if (age < 0 || age > NEW_SELLER_WINDOW_MS) return 0;
  return NEW_SELLER_BOOST;
}

export function diversifyRankedProducts<T>(
  items: T[],
  opts: {
    sellerId: (item: T) => string;
    base: (item: T, index: number) => number;
    createdAt?: (item: T) => string | null | undefined;
    now?: number;
  },
): T[] {
  if (items.length < 2) return items.slice();
  const sellerIds = new Set(items.map((item) => opts.sellerId(item)));
  if (sellerIds.size < 2) return items.slice();

  const remaining = items.map((item, index) => ({
    item,
    index,
    base: opts.base(item, index) + newSellerBaseBoost(opts.createdAt?.(item), opts.now),
  }));
  const picked: T[] = [];
  const counts = new Map<string, number>();
  let lastSeller: string | null = null;
  let run = 0;

  while (remaining.length > 0) {
    let bestIndex = 0;
    let bestScore = Number.NEGATIVE_INFINITY;
    for (let i = 0; i < remaining.length; i++) {
      const row = remaining[i];
      const seller = opts.sellerId(row.item);
      const earlier = counts.get(seller) || 0;
      let score = row.base - SELLER_REPEAT_PENALTY * earlier;
      if (seller === lastSeller && run >= SELLER_MAX_CONSECUTIVE) {
        const otherStillWaiting = remaining.some((candidate) => opts.sellerId(candidate.item) !== seller);
        if (otherStillWaiting) score -= 1000;
      }
      if (score > bestScore || (score === bestScore && row.index < remaining[bestIndex].index)) {
        bestScore = score;
        bestIndex = i;
      }
    }
    const chosen = remaining.splice(bestIndex, 1)[0];
    const seller = opts.sellerId(chosen.item);
    counts.set(seller, (counts.get(seller) || 0) + 1);
    run = seller === lastSeller ? run + 1 : 1;
    lastSeller = seller;
    picked.push(chosen.item);
  }

  return picked;
}
