import { describe, it, expect } from 'vitest';
import {
  parseBookingDateTime,
  DEFAULT_CALENDAR_ALERTS,
  BOOKING_TIMEZONE_OFFSET,
} from '@/lib/calendar';

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
