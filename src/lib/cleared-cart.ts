const STORAGE_KEY = 'sociva-cleared-cart';
const SNAPSHOT_TTL_MS = 30 * 60 * 1000;

export type ClearedCartLine = {
  productId: string;
  name: string;
  imageUrl: string | null;
  quantity: number;
  price: number;
  product: unknown;
};

export type ClearedCartSnapshot = {
  at: number;
  sellerName: string | null;
  sellerId: string | null;
  itemCount: number;
  lines: ClearedCartLine[];
};

export function emptyCartHeadline(now = new Date(), opts?: {
  justCleared?: boolean;
  sellerName?: string | null;
}): { title: string; subtitle: string } {
  const seller = opts?.sellerName?.trim() || null;
  if (opts?.justCleared) {
    return {
      title: seller ? `Cleared ${seller}` : 'Bag cleared',
      subtitle: 'Changed your mind? Put everything back in one tap, or pick something nearby.',
    };
  }
  const hour = now.getHours();
  if (hour >= 21 || hour < 7) {
    return {
      title: 'Your bag is empty',
      subtitle: 'Neighbourhood kitchens nearby still take scheduled orders for morning.',
    };
  }
  if (hour < 11) {
    return {
      title: 'Your bag is empty',
      subtitle: 'Breakfast and tiffin from neighbours is a tap away.',
    };
  }
  return {
    title: 'Your bag is empty',
    subtitle: 'See what neighbours are cooking, then add it back in one tap.',
  };
}

export function clearedCartSummary(snapshot: ClearedCartSnapshot | null): string | null {
  if (!snapshot || snapshot.itemCount <= 0) return null;
  const n = snapshot.itemCount === 1 ? '1 item' : `${snapshot.itemCount} items`;
  if (snapshot.sellerName) return `Removed ${n} from ${snapshot.sellerName}`;
  return `Removed ${n} from your bag`;
}

export function saveClearedCartSnapshot(snapshot: ClearedCartSnapshot): void {
  try {
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(snapshot));
  } catch {
    /* private mode */
  }
}

export function readClearedCartSnapshot(now = Date.now()): ClearedCartSnapshot | null {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as ClearedCartSnapshot;
    if (!parsed?.at || now - parsed.at > SNAPSHOT_TTL_MS) {
      sessionStorage.removeItem(STORAGE_KEY);
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

export function clearClearedCartSnapshot(): void {
  try {
    sessionStorage.removeItem(STORAGE_KEY);
  } catch {
    /* ignore */
  }
}
