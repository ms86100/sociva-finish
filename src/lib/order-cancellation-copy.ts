/**
 * Human-readable cancel/reject hero copy for order detail.
 * Prefers failure_owner; falls back to rejection_reason prefixes.
 */

export type CancelView = 'buyer' | 'seller' | 'other';

export function formatOrderCancellationHeroReason(
  order: {
    failure_owner?: string | null;
    rejection_reason?: string | null;
  },
  view: CancelView,
): string {
  const raw = (order.rejection_reason || '').trim();
  const cleanedBuyer = raw.replace(/^Cancelled by buyer:\s*/i, '');
  const cleanedSeller = raw.replace(/^(Rejected by seller|Cancelled by seller):\s*/i, '');

  const owner =
    order.failure_owner ||
    (raw.startsWith('Cancelled by buyer:')
      ? 'buyer'
      : /^(Rejected by seller|Cancelled by seller):/i.test(raw)
        ? 'seller'
        : /not completed in time|seller didn't respond|payment was not completed|auto-?cancel/i.test(raw)
          ? 'platform'
          : null);

  if (owner === 'buyer') {
    const who = view === 'buyer' ? 'You cancelled this order' : 'Cancelled by buyer';
    return cleanedBuyer ? `${who} — ${cleanedBuyer}` : who;
  }

  if (owner === 'seller') {
    const who = view === 'seller' ? 'You rejected this order' : 'Rejected by seller';
    const detail = cleanedSeller || cleanedBuyer || raw;
    return detail ? `${who} — ${detail}` : who;
  }

  if (owner === 'platform' || /not completed in time|seller didn't respond|payment was not completed/i.test(raw)) {
    return raw ? `Auto-cancelled — ${raw}` : 'Auto-cancelled';
  }

  // Unknown actor: keep reason only
  return raw || 'Order cancelled';
}
