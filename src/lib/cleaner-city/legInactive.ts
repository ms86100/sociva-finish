/**
 * Per-leg inactive markers stored on commute_overrides.note.
 * Whole-day off still uses is_working=false; single-leg off keeps the day working
 * and marks only that direction so the other side stays available.
 */

export type RideDirection = 'to_office' | 'to_home';

export type InactiveLegs = {
  to_office: boolean;
  to_home: boolean;
};

const MARKER_RE = /\bcc_inactive:(to_office|to_home|both)\b/;

export function parseInactiveLegs(
  schedule?: {
    is_working?: boolean | null;
    is_paused?: boolean | null;
    note?: string | null;
  } | null,
): InactiveLegs {
  if (!schedule || schedule.is_paused) {
    return { to_office: true, to_home: true };
  }
  if (!schedule.is_working) {
    return { to_office: true, to_home: true };
  }
  const match = String(schedule.note || '').match(MARKER_RE);
  if (!match) return { to_office: false, to_home: false };
  if (match[1] === 'both') return { to_office: true, to_home: true };
  if (match[1] === 'to_office') return { to_office: true, to_home: false };
  return { to_office: false, to_home: true };
}

export function isLegGoing(
  schedule: Parameters<typeof parseInactiveLegs>[0],
  direction: RideDirection,
): boolean {
  const inactive = parseInactiveLegs(schedule);
  return !inactive[direction];
}

export function stripInactiveMarker(note?: string | null): string | null {
  const cleaned = String(note || '')
    .replace(MARKER_RE, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
  return cleaned || null;
}

export function encodeInactiveNote(
  legs: InactiveLegs,
  existingNote?: string | null,
): string | null {
  const base = stripInactiveMarker(existingNote);
  let marker: string | null = null;
  if (legs.to_office && legs.to_home) marker = 'cc_inactive:both';
  else if (legs.to_office) marker = 'cc_inactive:to_office';
  else if (legs.to_home) marker = 'cc_inactive:to_home';
  if (!marker) return base;
  return base ? `${base} ${marker}` : marker;
}

export function withLegInactive(
  current: InactiveLegs,
  direction: RideDirection,
  inactive: boolean,
): InactiveLegs {
  return { ...current, [direction]: inactive };
}

export function addDaysIso(isoDate: string, days: number) {
  const d = new Date(`${isoDate}T12:00:00`);
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

/** Remaining Mon-Fri dates from selectedDate through end of that calendar week (Sun). */
export function remainingWeekdayDates(selectedDate: string): string[] {
  const start = new Date(`${selectedDate}T12:00:00`);
  const dow = start.getDay(); // 0 Sun .. 6 Sat
  const daysLeftInWeek = dow === 0 ? 0 : 7 - dow;
  const out: string[] = [];
  for (let i = 0; i <= daysLeftInWeek; i++) {
    const iso = addDaysIso(selectedDate, i);
    const d = new Date(`${iso}T12:00:00`).getDay();
    if (d >= 1 && d <= 5) out.push(iso);
  }
  return out.length ? out : [selectedDate];
}

export function formatTripWhen(
  dateIso: string,
  leaveHhmm: string,
  todayIso: string,
): string {
  const time = (() => {
    const raw = String(leaveHhmm || '').slice(0, 5);
    if (!/^\d{2}:\d{2}$/.test(raw)) return raw || '--:--';
    const [hRaw, m] = raw.split(':');
    let h = Number(hRaw);
    const suffix = h >= 12 ? 'PM' : 'AM';
    h = h % 12;
    if (h === 0) h = 12;
    return `${h}:${m} ${suffix}`;
  })();
  const day =
    dateIso === todayIso
      ? 'Today'
      : dateIso === addDaysIso(todayIso, 1)
        ? 'Tomorrow'
        : new Intl.DateTimeFormat('en-GB', {
            weekday: 'short',
            day: 'numeric',
            month: 'short',
          }).format(new Date(`${dateIso}T12:00:00`));
  return `${time} on ${day}`;
}
