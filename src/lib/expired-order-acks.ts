/** Persist buyer acknowledgment of expired home-strip orders. */

const EXPIRED_ACK_KEY = 'home_expired_order_acks';
const MAX_STORED = 80;

export function getExpiredOrderAcks(): Set<string> {
  try {
    const raw = localStorage.getItem(EXPIRED_ACK_KEY);
    if (!raw) return new Set();
    const arr = JSON.parse(raw);
    return new Set(Array.isArray(arr) ? arr : []);
  } catch {
    return new Set();
  }
}

export function acknowledgeExpiredOrder(orderId: string): void {
  if (!orderId) return;
  const set = getExpiredOrderAcks();
  set.add(orderId);
  const arr = [...set].slice(-MAX_STORED);
  try {
    localStorage.setItem(EXPIRED_ACK_KEY, JSON.stringify(arr));
  } catch {
    /* quota — ignore */
  }
}

export function isOrderAcceptanceExpired(
  autoCancelAt: string | null | undefined,
  status: string | null | undefined,
): boolean {
  if (!autoCancelAt) return false;
  if (status && status !== 'placed') return false;
  return new Date(autoCancelAt).getTime() <= Date.now();
}
