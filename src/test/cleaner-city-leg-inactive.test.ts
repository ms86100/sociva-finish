import { describe, expect, it } from 'vitest';
import {
  encodeInactiveNote,
  isLegGoing,
  parseInactiveLegs,
  remainingWeekdayDates,
  stripInactiveMarker,
  withLegInactive,
} from '@/lib/cleaner-city/legInactive';

describe('legInactive helpers', () => {
  it('treats whole-day off as both legs inactive', () => {
    expect(parseInactiveLegs({ is_working: false, note: null })).toEqual({
      to_office: true,
      to_home: true,
    });
  });

  it('parses single-leg inactive from note while day stays working', () => {
    const schedule = { is_working: true, note: 'cc_inactive:to_home' };
    expect(parseInactiveLegs(schedule)).toEqual({ to_office: false, to_home: true });
    expect(isLegGoing(schedule, 'to_office')).toBe(true);
    expect(isLegGoing(schedule, 'to_home')).toBe(false);
  });

  it('encodes and strips markers without losing other note text', () => {
    const next = withLegInactive({ to_office: false, to_home: false }, 'to_office', true);
    const note = encodeInactiveNote(next, 'WFH half day');
    expect(note).toContain('WFH half day');
    expect(note).toContain('cc_inactive:to_office');
    expect(stripInactiveMarker(note)).toBe('WFH half day');
  });

  it('lists remaining weekdays including selected date', () => {
    // Wed 11 Nov 2026
    expect(remainingWeekdayDates('2026-11-11')).toEqual([
      '2026-11-11',
      '2026-11-12',
      '2026-11-13',
    ]);
  });

  it('keeps a working override when turning both legs on for a WFH weekday', () => {
    // Turning morning then evening Going on a Friday template-off day must not
    // clear the override, or both cards fall back to Not Going.
    const fromDayOff = parseInactiveLegs({ is_working: false, note: null });
    expect(fromDayOff).toEqual({ to_office: true, to_home: true });

    const morningOn = withLegInactive(fromDayOff, 'to_office', false);
    expect(morningOn).toEqual({ to_office: false, to_home: true });
    expect(encodeInactiveNote(morningOn, null)).toBe('cc_inactive:to_home');

    const bothOn = withLegInactive(morningOn, 'to_home', false);
    expect(bothOn).toEqual({ to_office: false, to_home: false });
    expect(encodeInactiveNote(bothOn, 'cc_inactive:to_home')).toBe(null);
  });
});
