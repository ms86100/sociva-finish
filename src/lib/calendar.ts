import { Capacitor } from '@capacitor/core';
import type { CapacitorCalendarPlugin } from '@ebarooni/capacitor-calendar';

/** Booking times are stored as IST wall-clock values. */
export const BOOKING_TIMEZONE_OFFSET = '+05:30';

/** Reminder offsets in minutes relative to event start (negative = before). */
export const DEFAULT_CALENDAR_ALERTS = [-1440, -60] as const; // 1 day, 1 hour

export interface CalendarEventData {
  title: string;
  startDate: Date;
  endDate: Date;
  location?: string;
  description?: string;
  /** Override default alerts (−1440, −60). Empty array disables reminders. */
  alerts?: number[];
}

export type AddToCalendarStatus =
  | 'added'
  | 'cancelled'
  | 'denied'
  | 'downloaded'
  | 'error';

export interface AddToCalendarResult {
  status: AddToCalendarStatus;
  message?: string;
}

/**
 * Parse a booking date + time (IST) into a Date.
 * Accepts `HH:mm` or `HH:mm:ss` (and optional fractional seconds).
 */
export function parseBookingDateTime(date: string, time: string): Date {
  const normalizedTime = normalizeTime(time);
  return new Date(`${date}T${normalizedTime}${BOOKING_TIMEZONE_OFFSET}`);
}

function normalizeTime(time: string): string {
  const raw = (time || '').trim();
  if (!raw) return '00:00:00';
  // HH:mm
  if (/^\d{2}:\d{2}$/.test(raw)) return `${raw}:00`;
  // HH:mm:ss or HH:mm:ss.sss
  if (/^\d{2}:\d{2}:\d{2}/.test(raw)) return raw.slice(0, 8);
  return raw;
}

function isValidDate(d: Date): boolean {
  return d instanceof Date && !Number.isNaN(d.getTime());
}

/**
 * Add a booking to the device calendar.
 * - Native Android/iOS: Capacitor Calendar plugin (system UI / EventKit / Calendar Provider)
 * - Web: download / open an .ics file with reminders
 */
export async function addToCalendar(data: CalendarEventData): Promise<AddToCalendarResult> {
  if (!isValidDate(data.startDate) || !isValidDate(data.endDate)) {
    return { status: 'error', message: 'Invalid booking date or time' };
  }
  if (data.endDate.getTime() <= data.startDate.getTime()) {
    return { status: 'error', message: 'End time must be after start time' };
  }

  if (Capacitor.isNativePlatform()) {
    return addToNativeCalendar(data);
  }
  return openICS(data);
}

async function addToNativeCalendar(data: CalendarEventData): Promise<AddToCalendarResult> {
  const alerts = data.alerts ?? [...DEFAULT_CALENDAR_ALERTS];
  const platform = Capacitor.getPlatform();

  try {
    const { CapacitorCalendar } = await import('@ebarooni/capacitor-calendar');

    const base = {
      title: data.title,
      startDate: data.startDate.getTime(),
      endDate: data.endDate.getTime(),
      location: data.location || undefined,
      description: data.description || undefined,
    };

    if (platform === 'android') {
      return addToAndroidCalendar(CapacitorCalendar, base, alerts);
    }

    // iOS — write-only access + system event editor (supports alerts + cancel)
    const permResult = await CapacitorCalendar.requestWriteOnlyCalendarAccess();
    if (permResult?.result === 'denied') {
      return {
        status: 'denied',
        message: 'Calendar access is required. Enable it in Settings to add bookings.',
      };
    }

    const { id } = await CapacitorCalendar.createEventWithPrompt({
      ...base,
      alerts,
    });

    // null = user cancelled the system editor
    if (id === null) {
      return { status: 'cancelled' };
    }
    return { status: 'added' };
  } catch (error) {
    console.warn('[Calendar] Native calendar failed:', error);
    // Last-resort: never silently "succeed" — surface a clear error on native.
    // ICS blob downloads are unreliable inside Capacitor WebViews.
    return {
      status: 'error',
      message: error instanceof Error ? error.message : 'Could not open calendar',
    };
  }
}

async function addToAndroidCalendar(
  CapacitorCalendar: CapacitorCalendarPlugin,
  base: {
    title: string;
    startDate: number;
    endDate: number;
    location?: string;
    description?: string;
  },
  alerts: number[],
): Promise<AddToCalendarResult> {
  // Prefer write permission + createEvent so reminders (alerts) are applied.
  // If the user denies permission, fall back to the system INSERT intent
  // (ACTION_INSERT) which does not require calendar permission.
  try {
    const permResult = await CapacitorCalendar.requestWriteOnlyCalendarAccess();
    if (permResult?.result === 'granted') {
      await CapacitorCalendar.createEvent({ ...base, alerts });
      return { status: 'added' };
    }
  } catch (permErr) {
    console.warn('[Calendar] Android write permission unavailable, using system intent:', permErr);
  }

  // Intent-based create — works without WRITE_CALENDAR; alerts not supported by Intent extras.
  // Bake reminder guidance into notes so the user can set them in the calendar UI.
  const reminderNote =
    alerts.length > 0
      ? `\n\nSuggested reminders: ${alerts
          .map((m) => formatAlertLabel(m))
          .join(', ')}`
      : '';
  await CapacitorCalendar.createEventWithPrompt({
    ...base,
    description: `${base.description || ''}${reminderNote}`.trim() || undefined,
  });
  // Android createEventWithPrompt always returns id: null; treat a successful launch as added.
  // If the user cancels the system UI, Android still resolves — we cannot distinguish cancel.
  return { status: 'added' };
}

function formatAlertLabel(minutes: number): string {
  const abs = Math.abs(minutes);
  const when = minutes <= 0 ? 'before' : 'after';
  if (abs % 1440 === 0) {
    const days = abs / 1440;
    return `${days} day${days === 1 ? '' : 's'} ${when}`;
  }
  if (abs % 60 === 0) {
    const hours = abs / 60;
    return `${hours} hour${hours === 1 ? '' : 's'} ${when}`;
  }
  return `${abs} min ${when}`;
}

function formatICSDateUTC(d: Date): string {
  return d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
}

function escapeICS(text: string): string {
  return text
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\r?\n/g, '\\n');
}

function buildICSContent(data: CalendarEventData): string {
  const now = formatICSDateUTC(new Date());
  const uid = `${Date.now()}-${Math.random().toString(36).slice(2)}@sociva.in`;
  const alerts = data.alerts ?? [...DEFAULT_CALENDAR_ALERTS];

  const alarmBlocks = alerts.flatMap((minutes) => [
    'BEGIN:VALARM',
    'ACTION:DISPLAY',
    `DESCRIPTION:${escapeICS(data.title)}`,
    `TRIGGER:${minutes <= 0 ? `-PT${Math.abs(minutes)}M` : `PT${minutes}M`}`,
    'END:VALARM',
  ]);

  return [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Sociva//ServiceBooking//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'BEGIN:VEVENT',
    `UID:${uid}`,
    `DTSTART:${formatICSDateUTC(data.startDate)}`,
    `DTEND:${formatICSDateUTC(data.endDate)}`,
    `DTSTAMP:${now}`,
    `SUMMARY:${escapeICS(data.title)}`,
    data.location ? `LOCATION:${escapeICS(data.location)}` : '',
    data.description ? `DESCRIPTION:${escapeICS(data.description)}` : '',
    'STATUS:CONFIRMED',
    ...alarmBlocks,
    'END:VEVENT',
    'END:VCALENDAR',
  ]
    .filter(Boolean)
    .join('\r\n');
}

function isMedianOrMobileWeb(): boolean {
  if (typeof window === 'undefined') return false;
  const ua = navigator.userAgent || '';
  const w = window as Window & { median?: unknown; gonative?: unknown };
  return !!(
    w.median ||
    w.gonative ||
    /gonative|median/i.test(ua) ||
    /iPhone|iPad|iPod|Android/i.test(ua)
  );
}

/**
 * Opens / downloads an ICS file on web (and Median webviews).
 *
 * Median Calendar plugin intercepts `data:text/calendar` / `.ics` links —
 * blob: URLs with a `download` attribute are NOT intercepted and fail silently
 * inside native webviews.
 */
function openICS(data: CalendarEventData): AddToCalendarResult {
  try {
    const content = buildICSContent(data);
    const filename = `${sanitizeFilename(data.title) || 'appointment'}.ics`;

    if (isMedianOrMobileWeb()) {
      // data URI (not blob) so Median / mobile OS can hand off to Calendar
      const dataUri = `data:text/calendar;charset=utf-8,${encodeURIComponent(content)}`;
      const link = document.createElement('a');
      link.href = dataUri;
      // Intentionally no `download` attribute — that blocks calendar interceptors
      link.rel = 'noopener';
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      return { status: 'downloaded' };
    }

    // Desktop browsers: file download
    const blob = new Blob([content], { type: 'text/calendar;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    link.type = 'text/calendar';
    link.rel = 'noopener';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    setTimeout(() => URL.revokeObjectURL(url), 2000);
    return { status: 'downloaded' };
  } catch (error) {
    console.warn('[Calendar] ICS export failed:', error);
    return {
      status: 'error',
      message: error instanceof Error ? error.message : 'Could not download calendar file',
    };
  }
}

function sanitizeFilename(name: string): string {
  return name.replace(/[^\w\s-]+/g, '').trim().replace(/\s+/g, '-').slice(0, 60);
}
