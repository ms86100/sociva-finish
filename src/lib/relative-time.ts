import { format, formatDistanceToNow, isYesterday, differenceInDays } from 'date-fns';

export function parseTimestamp(value: unknown): Date | null {
  if (value == null || value === '') return null;
  const d = value instanceof Date ? value : new Date(String(value));
  return Number.isNaN(d.getTime()) ? null : d;
}

export function compareIsoDesc(a: unknown, b: unknown): number {
  const aMs = parseTimestamp(a)?.getTime() ?? 0;
  const bMs = parseTimestamp(b)?.getTime() ?? 0;
  return bMs - aMs;
}

export function compareIsoAsc(a: unknown, b: unknown): number {
  return -compareIsoDesc(a, b);
}

/** Safe relative time for order list cards. Never throws on missing/invalid dates. */
export function humanizeRelativeTime(iso: unknown): string {
  const d = parseTimestamp(iso);
  if (!d) return '';
  try {
    const days = differenceInDays(new Date(), d);
    if (days < 1) return formatDistanceToNow(d, { addSuffix: true });
    if (isYesterday(d)) return 'Yesterday';
    if (days < 7) return format(d, 'EEEE');
    return format(d, 'MMM d');
  } catch {
    return '';
  }
}
