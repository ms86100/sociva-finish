/** Minimal timeout helper for seller-manual-complete tests on master. */
export function shouldApplyReadTimeout(url: string, init?: RequestInit): boolean {
  const method = String(init?.method || 'GET').toUpperCase();
  if (method !== 'GET' && method !== 'HEAD') return false;
  // Write RPCs (e.g. seller_complete_order_without_otp) must not use read timeouts.
  if (/\/rpc\//i.test(url)) return false;
  return true;
}
