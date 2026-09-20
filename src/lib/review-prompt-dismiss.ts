const STORAGE_KEY = 'sociva:dismissed-review-prompts';

export function readDismissedReviewOrderIds(): Set<string> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return new Set();
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return new Set();
    return new Set(parsed.filter((id): id is string => typeof id === 'string' && id.length > 0));
  } catch {
    return new Set();
  }
}

export function rememberDismissedReviewOrderId(orderId: string): void {
  if (!orderId) return;
  const next = readDismissedReviewOrderIds();
  next.add(orderId);
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify([...next]));
  } catch {
    /* ignore quota / private mode */
  }
}

export function isReviewOrderLocallyDismissed(orderId: string): boolean {
  return readDismissedReviewOrderIds().has(orderId);
}
