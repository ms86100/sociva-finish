import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  parseBookingDateTime,
  DEFAULT_CALENDAR_ALERTS,
  BOOKING_TIMEZONE_OFFSET,
  addToCalendar,
} from '@/lib/calendar';

vi.mock('@capacitor/core', () => ({
  Capacitor: {
    isNativePlatform: vi.fn(() => true),
    getPlatform: vi.fn(() => 'ios'),
    isPluginAvailable: vi.fn(() => false),
  },
}));

vi.mock('@capacitor/browser', () => ({
  Browser: {
    open: vi.fn(async () => undefined),
  },
}));

describe('calendar booking datetime', () => {
  it('parses HH:mm as IST', () => {
    const d = parseBookingDateTime('2026-08-15', '10:30');
    expect(d.toISOString()).toBe('2026-08-15T05:00:00.000Z'); // 10:30 IST = 05:00 UTC
  });

  it('parses HH:mm:ss as IST', () => {
    const d = parseBookingDateTime('2026-08-15', '10:30:00');
    expect(d.toISOString()).toBe('2026-08-15T05:00:00.000Z');
  });

  it('computes duration correctly from start/end', () => {
    const start = parseBookingDateTime('2026-08-15', '10:00');
    const end = parseBookingDateTime('2026-08-15', '11:30');
    expect(end.getTime() - start.getTime()).toBe(90 * 60 * 1000);
  });

  it('uses IST offset constant', () => {
    expect(BOOKING_TIMEZONE_OFFSET).toBe('+05:30');
  });

  it('defaults reminders to 1 day and 1 hour before', () => {
    expect([...DEFAULT_CALENDAR_ALERTS]).toEqual([-1440, -60]);
  });
});

describe('addToCalendar iOS without native plugin', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('falls back to ICS handoff instead of unimplemented toast', async () => {
    const { Capacitor } = await import('@capacitor/core');
    const { Browser } = await import('@capacitor/browser');
    vi.mocked(Capacitor.isNativePlatform).mockReturnValue(true);
    vi.mocked(Capacitor.getPlatform).mockReturnValue('ios');
    vi.mocked(Capacitor.isPluginAvailable).mockReturnValue(false);

    const start = parseBookingDateTime('2026-08-15', '10:00');
    const end = parseBookingDateTime('2026-08-15', '11:00');
    const result = await addToCalendar({
      title: 'Haircut',
      startDate: start,
      endDate: end,
      location: 'Salon',
    });

    expect(result.status).toBe('downloaded');
    expect(result.message).toBeUndefined();
    expect(Browser.open).toHaveBeenCalled();
    const url = vi.mocked(Browser.open).mock.calls[0]?.[0]?.url ?? '';
    expect(url.startsWith('data:text/calendar')).toBe(true);
  });
});
