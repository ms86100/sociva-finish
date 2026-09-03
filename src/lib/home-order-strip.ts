/** Persist home-strip orders the buyer hid with X. Survives force-close. */

const DISMISS_KEY = 'home_active_order_strip_dismissed';
const MAX_STORED = 80;

export function getDismissedHomeOrderIds(): Set<string> {
  try {
    const raw = localStorage.getItem(DISMISS_KEY);
    if (!raw) return new Set();
    const arr = JSON.parse(raw);
    return new Set(Array.isArray(arr) ? arr : []);
  } catch {
    return new Set();
  }
}

export function dismissHomeOrderStrip(orderId: string): void {
  if (!orderId) return;
  const set = getDismissedHomeOrderIds();
  set.add(orderId);
  try {
    localStorage.setItem(DISMISS_KEY, JSON.stringify([...set].slice(-MAX_STORED)));
  } catch {
    /* quota — ignore */
  }
}
