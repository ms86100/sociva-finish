// @ts-nocheck
/**
 * Client-side mirror of the DB function `compute_store_status`.
 */

export type StoreStatus = 'open' | 'closed' | 'closed_today' | 'paused';

export interface StoreAvailability {
  status: StoreStatus;
  nextOpenAt: string | null;
  minutesUntilOpen: number | null;
}

const DAY_ABBREVS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export function computeStoreStatus(
  availabilityStart: string | null | undefined,
  availabilityEnd: string | null | undefined,
  operatingDays: string[] | null | undefined,
  isAvailable: boolean
): StoreAvailability {
  if (!isAvailable) return { status: 'paused', nextOpenAt: null, minutesUntilOpen: null };
  if (!availabilityStart || !availabilityEnd) return { status: 'open', nextOpenAt: null, minutesUntilOpen: 0 };

  // Use IST (UTC+5:30) to match the DB function `compute_store_status`.
  // Derive the IST wall clock via Intl (locale-independent) instead of
  // re-parsing a localized string, and keep the real UTC instant separately
  // so `nextOpenAt` is a correct absolute timestamp in any device timezone.
  const nowUtc = new Date();
  const IST_OFFSET_MS = (5 * 60 + 30) * 60 * 1000;
  const ist = new Date(nowUtc.getTime() + IST_OFFSET_MS);
  const currentDay = DAY_ABBREVS[ist.getUTCDay()];

  if (operatingDays && operatingDays.length > 0 && !operatingDays.includes(currentDay)) {
    return { status: 'closed_today', nextOpenAt: null, minutesUntilOpen: null };
  }

  const [startH, startM] = availabilityStart.split(':').map(Number);
  const [endH, endM] = availabilityEnd.split(':').map(Number);
  const currentMinutes = ist.getUTCHours() * 60 + ist.getUTCMinutes();
  const startMinutes = startH * 60 + startM;
  const rawEndMinutes = endH * 60 + endM;
  // Treat 00:00 as end-of-day (1440) so "09:00–00:00" means open until midnight
  const endMinutes = rawEndMinutes === 0 ? 1440 : rawEndMinutes;

  // Handle overnight hours (e.g. 20:00–02:00)
  const isOvernight = endMinutes <= startMinutes;

  const isOpen = isOvernight
    ? (currentMinutes >= startMinutes || currentMinutes < endMinutes)
    : (currentMinutes >= startMinutes && currentMinutes < endMinutes);

  if (isOpen) {
    return { status: 'open', nextOpenAt: null, minutesUntilOpen: 0 };
  }

  const minutesUntilOpen =
    currentMinutes < startMinutes
      ? startMinutes - currentMinutes
      : 24 * 60 - currentMinutes + startMinutes;

  // Absolute instant of the next opening, correct regardless of device TZ.
  const nextOpen = new Date(nowUtc.getTime() + minutesUntilOpen * 60 * 1000);
  nextOpen.setSeconds(0, 0);

  return { status: 'closed', nextOpenAt: nextOpen.toISOString(), minutesUntilOpen };

}

export function formatStoreClosedMessage(availability: StoreAvailability): string {
  if (availability.status === 'paused') return 'Store paused';
  if (availability.status === 'closed_today') return 'Closed today';
  if (availability.status !== 'closed') return '';

  const mins = availability.minutesUntilOpen;
  if (mins == null) return 'Store closed';
  if (mins < 60) return `Opens in ${mins} min`;
  if (mins < 120) return `Opens in 1 hr`;

  if (availability.nextOpenAt) {
    const d = new Date(availability.nextOpenAt);
    return `Opens at ${d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
  }

  const hours = Math.round(mins / 60);
  return `Opens in ${hours} hrs`;
}
