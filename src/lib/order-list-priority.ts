/** Priority buckets for Orders list: active/upcoming → completed → cancelled. */

export type OrderListPriorityBucket = 'active' | 'completed' | 'cancelled';

const CANCELLED_FALLBACK = new Set([
  'cancelled',
  'rejected',
  'no_show',
  'returned',
  'failed',
]);

export function resolveOrderListPriority(
  status: string,
  successSet: Set<string>,
  terminalSet: Set<string>,
): OrderListPriorityBucket {
  const s = (status || '').toLowerCase();
  if (successSet.has(s)) return 'completed';
  if (terminalSet.has(s) || CANCELLED_FALLBACK.has(s)) return 'cancelled';
  return 'active';
}

const BUCKET_RANK: Record<OrderListPriorityBucket, number> = {
  active: 0,
  completed: 1,
  cancelled: 2,
};

export function compareOrdersByListPriority<
  T extends { status?: string | null; created_at?: string | null },
>(
  a: T,
  b: T,
  successSet: Set<string>,
  terminalSet: Set<string>,
): number {
  const aBucket = resolveOrderListPriority(String(a.status || ''), successSet, terminalSet);
  const bBucket = resolveOrderListPriority(String(b.status || ''), successSet, terminalSet);
  const rankDiff = BUCKET_RANK[aBucket] - BUCKET_RANK[bBucket];
  if (rankDiff !== 0) return rankDiff;
  const aTs = a.created_at ? new Date(a.created_at).getTime() : 0;
  const bTs = b.created_at ? new Date(b.created_at).getTime() : 0;
  return bTs - aTs;
}

export function sortOrdersByListPriority<
  T extends { status?: string | null; created_at?: string | null },
>(
  orders: T[],
  successSet: Set<string>,
  terminalSet: Set<string>,
): T[] {
  return [...orders].sort((a, b) =>
    compareOrdersByListPriority(a, b, successSet, terminalSet),
  );
}
