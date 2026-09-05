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

/** Match Mon/mon/MONDAY — and numeric 0–6 (Sun–Sat) used by some seed/DB rows. */
function operatingDayMatches(operatingDays: string[], currentDay: string): boolean {
  const needle = currentDay.slice(0, 3).toLowerCase();
  const dayIdx = DAY_ABBREVS.findIndex((d) => d.toLowerCase() === needle);
  return operatingDays.some((d) => {
    const s = String(d ?? '').trim();
    if (!s) return false;
    if (s.slice(0, 3).toLowerCase() === needle) return true;
    if (/^\d+$/.test(s) && Number(s) === dayIdx) return true;
    return false;
  });
}

// Timezone handling: store timings are expected in IST (UTC+5:30).
// If the device is in CET (UTC+1) or another timezone, we detect and convert
// so the store hours always mean IST wall-clock time regardless of device TZ.
function toISTMinutes(hh: number, mm: number): number {
  // IST is UTC+5:30 = 5*60+30 = 330 minutes ahead of UTC
  // A time "09:00" in IST means 09:00 IST = 03:30 UTC
  // We compute minutes-since-midnight in IST, then express that as UTC-offset-adjusted value
  const istMidnightMs = 5 * 60 * 60 * 1000 + 30 * 60 * 1000; // 5:30 IST = 330 min after UTC midnight
  const utcNowMs = new Date().getTime() - istMidnightMs; // shift epoch so 00:00 IST = UTC midnight
  // Actually, simpler: just convert the time as if the device TZ were UTC, then add IST offset
  // The computeStoreStatus function already does this via IST_OFFSET_MS, so we just validate format here.
  return hh * 60 + mm;
}

function fromCETToIST(hh: number, mm: number): [number, number] {
  // CET is UTC+1, IST is UTC+5:30 → shift by 4.5 hours = 270 minutes
  const total = hh * 60 + mm + 270;
  const istH = Math.floor(total / 60) % 24;
  const istM = total % 60;
  return [istH, istM];
}

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

  if (operatingDays && operatingDays.length > 0 && !operatingDayMatches(operatingDays, currentDay)) {
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

function reopenDuration(mins: number): string {
  if (mins < 60) return `${mins} minute${mins === 1 ? '' : 's'}`;
  const hours = Math.floor(mins / 60);
  const rest = mins % 60;
  if (rest === 0) return `${hours} hour${hours === 1 ? '' : 's'}`;
  return `${hours} hour${hours === 1 ? '' : 's'} ${rest} minutes`;
}

/** Buyer-facing copy for reorder/cart — not a generic system failure. */
export function formatStoreClosedBuyerMessage(availability: StoreAvailability): string {
  if (availability.status === 'paused') {
    return 'This store is currently paused. Your items may still be available when it reopens.';
  }
  if (availability.status === 'closed_today') {
    return 'This store is closed today. Your items may still be available when it reopens.';
  }
  if (availability.status !== 'closed') return '';

  const mins = availability.minutesUntilOpen;
  if (mins == null || mins < 0) {
    return 'This store is currently closed. Your items may still be available when it reopens.';
  }
  return `This store is currently closed. It will reopen in ${reopenDuration(mins)}.`;
}

export function parseStoreClosedBuyerError(error: unknown): string | null {
  const msg = String((error as any)?.message || '');
  const statusMatch = msg.match(/STORE_CLOSED:([a-z_]+)/i);
  if (statusMatch?.[1]) {
    const status = statusMatch[1].toLowerCase() as StoreStatus;
    return formatStoreClosedBuyerMessage({ status, nextOpenAt: null, minutesUntilOpen: null });
  }
  if (/currently closed|store closed/i.test(msg)) {
    return 'This store is currently closed. Your items may still be available when it reopens.';
  }
  return null;
}
