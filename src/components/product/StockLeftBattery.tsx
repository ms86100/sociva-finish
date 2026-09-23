import { cn } from '@/lib/utils';

/**
 * Compact Blinkit-style stock battery for product cards.
 * Shows remaining units with a fill gauge — builds urgency without fear copy.
 */
export function StockLeftBattery({
  quantity,
  /** Visual full scale; clamps fill below 100%. */
  capacity = 20,
  className,
}: {
  quantity: number;
  capacity?: number;
  className?: string;
}) {
  if (!Number.isFinite(quantity) || quantity <= 0) return null;
  const pct = Math.max(8, Math.min(100, Math.round((quantity / Math.max(capacity, 1)) * 100)));
  const low = quantity <= 5;
  const fill = low ? 'bg-warning' : 'bg-success';

  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 text-[9px] font-semibold tabular-nums',
        low ? 'text-warning' : 'text-success',
        className,
      )}
      aria-label={`${quantity} left in stock`}
    >
      <span
        className="relative inline-flex w-[18px] h-[9px] rounded-[2px] border border-current/50 overflow-hidden shrink-0"
        aria-hidden
      >
        <span className={cn('absolute inset-y-0 left-0 transition-[width]', fill)} style={{ width: `${pct}%` }} />
        <span className="absolute -right-[3px] top-1/2 -translate-y-1/2 w-[2px] h-[5px] rounded-r-sm bg-current/50" />
      </span>
      {quantity} left
    </span>
  );
}

export type CardTrustSignal =
  | { kind: 'stock'; quantity: number }
  | { kind: 'prep'; minutes: number }
  | { kind: 'active'; label: string }
  | null;

/**
 * Prefer useful buyer signals over fear copy like "store may be unresponsive".
 * Order: stock battery → prep time → soft recent-activity label.
 * Inactive sellers: show stock/prep if known; otherwise show nothing.
 */
export function resolveCardTrustSignal(input: {
  stockQuantity?: number | null;
  prepMinutes?: number | null;
  lastActiveAt?: string | null;
  activityLabel?: string | null;
  inactiveAfterMs?: number;
}): CardTrustSignal {
  const stock = input.stockQuantity;
  if (typeof stock === 'number' && stock > 0) {
    return { kind: 'stock', quantity: stock };
  }
  const prep = input.prepMinutes;
  if (typeof prep === 'number' && prep > 0) {
    return { kind: 'prep', minutes: prep };
  }
  const last = input.lastActiveAt;
  if (!last) return null;
  const inactiveAfter = input.inactiveAfterMs ?? 7 * 24 * 60 * 60 * 1000;
  const age = Date.now() - new Date(last).getTime();
  if (!Number.isFinite(age) || age > inactiveAfter) {
    // Do not scare buyers — omit negative "unresponsive" messaging.
    return null;
  }
  const label = (input.activityLabel || '').trim();
  return label ? { kind: 'active', label } : null;
}
