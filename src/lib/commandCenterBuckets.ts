export type CommandCenterBucketId =
  | 'pending_stores'
  | 'pending_products'
  | 'orders_today'
  | 'unanswered_enquiries'
  | 'open_disputes'
  | 'payment_waiting';

export type CommandCenterBucket = {
  id: CommandCenterBucketId;
  label: string;
  emptyCopy: string;
};

export const COMMAND_CENTER_BUCKETS: CommandCenterBucket[] = [
  {
    id: 'pending_stores',
    label: 'Pending stores',
    emptyCopy: 'No stores waiting for approval.',
  },
  {
    id: 'pending_products',
    label: 'Pending products',
    emptyCopy: 'No products waiting for approval.',
  },
  {
    id: 'orders_today',
    label: 'Orders today',
    emptyCopy: 'No orders since 12:00 AM IST.',
  },
  {
    id: 'unanswered_enquiries',
    label: 'Unanswered enquiries',
    emptyCopy: 'No enquiries waiting for a seller reply.',
  },
  {
    id: 'open_disputes',
    label: 'Open disputes',
    emptyCopy: 'No open disputes.',
  },
  {
    id: 'payment_waiting',
    label: 'Payment waiting',
    emptyCopy: 'No payments waiting.',
  },
];

const PAYMENT_WAITING = new Set(['pending', 'payment_pending', 'awaiting_payment']);

export type CommandCenterFixtureRow = {
  kind: 'seller' | 'product' | 'order' | 'enquiry' | 'dispute' | 'ticket';
  status?: string;
  paymentStatus?: string;
  createdAt?: string;
  sellerResponded?: boolean;
  orderId?: string | null;
  societyId?: string | null;
};

export function istDayStart(now: Date): Date {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Kolkata',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(now);
  const year = parts.find((part) => part.type === 'year')?.value;
  const month = parts.find((part) => part.type === 'month')?.value;
  const day = parts.find((part) => part.type === 'day')?.value;
  return new Date(`${year}-${month}-${day}T00:00:00+05:30`);
}

export function rowInBucket(
  bucket: CommandCenterBucketId,
  row: CommandCenterFixtureRow,
  now: Date,
  societyId: string | null = null,
): boolean {
  if (societyId && row.societyId && row.societyId !== societyId) return false;
  if (societyId && !row.societyId) return false;

  if (bucket === 'pending_stores') {
    return row.kind === 'seller' && row.status === 'pending';
  }
  if (bucket === 'pending_products') {
    return row.kind === 'product' && row.status === 'pending';
  }
  if (bucket === 'orders_today') {
    if (row.kind !== 'order' || !row.createdAt) return false;
    return new Date(row.createdAt).getTime() >= istDayStart(now).getTime();
  }
  if (bucket === 'unanswered_enquiries') {
    return row.kind === 'enquiry' && row.status === 'enquired' && !row.sellerResponded;
  }
  if (bucket === 'open_disputes') {
    if (!row.orderId) return false;
    if (row.kind === 'dispute') {
      return !['resolved', 'closed', 'rejected'].includes(row.status || '');
    }
    if (row.kind === 'ticket') {
      return !['resolved', 'closed'].includes(row.status || '');
    }
    return false;
  }
  if (bucket === 'payment_waiting') {
    return row.kind === 'order' && PAYMENT_WAITING.has(row.paymentStatus || '');
  }
  return false;
}

export function bucketTotal(
  bucket: CommandCenterBucketId,
  rows: CommandCenterFixtureRow[],
  now: Date,
  societyId: string | null = null,
): number {
  return rows.filter((row) => rowInBucket(bucket, row, now, societyId)).length;
}
