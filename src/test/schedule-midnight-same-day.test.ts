import { describe, expect, it } from 'vitest';
import {
  earliestScheduleSlot,
  formatScheduleCta,
  scheduleCtaParts,
} from '@/lib/store-schedule';

const hours = {
  availabilityStart: '10:00',
  availabilityEnd: '22:00',
  operatingDays: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'],
  isAvailable: true,
  vacationMode: false,
  prepMinutes: 15,
};

describe('same-day morning schedule after midnight', () => {
  it('at 12:35 AM IST Monday offers Monday morning, not Tuesday', () => {
    // Mon 26 Oct 2026 00:35 IST
    const now = new Date('2026-10-25T19:05:00.000Z');
    const earliest = earliestScheduleSlot(hours, now);
    expect(earliest?.date).toBe('2026-10-26');
    expect(earliest?.time).toBe('10:45');
    expect(scheduleCtaParts(hours, now)).toEqual({ timeLabel: '10:45 AM', day: 'today' });
    expect(formatScheduleCta(hours, now)).toBe('Schedule for 10:45 AM');
  });

  it('at 11:30 PM IST Sunday still offers Monday morning as tomorrow', () => {
    // Sun 25 Oct 2026 23:30 IST
    const now = new Date('2026-10-25T18:00:00.000Z');
    const earliest = earliestScheduleSlot(hours, now);
    expect(earliest?.date).toBe('2026-10-26');
    expect(earliest?.time).toBe('10:45');
    expect(scheduleCtaParts(hours, now)).toEqual({ timeLabel: '10:45 AM', day: 'tomorrow' });
  });
});
