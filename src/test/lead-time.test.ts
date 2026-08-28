import { describe, it, expect } from 'vitest';
import { leadTimeFromHours, leadTimeToHours, formatLeadTime } from '@/lib/lead-time';

describe('lead-time helpers', () => {
  it('converts minutes to fractional hours', () => {
    expect(leadTimeToHours(30, 'minutes')).toBe(0.5);
    expect(leadTimeToHours(90, 'minutes')).toBe(1.5);
  });

  it('round-trips hours', () => {
    const { value, unit } = leadTimeFromHours(2);
    expect(value).toBe('2');
    expect(unit).toBe('hours');
  });

  it('round-trips sub-hour values as minutes', () => {
    const { value, unit } = leadTimeFromHours(0.5);
    expect(value).toBe('30');
    expect(unit).toBe('minutes');
  });

  it('formats for display', () => {
    expect(formatLeadTime(0.5)).toBe('30 min');
    expect(formatLeadTime(2)).toBe('2 hrs');
  });
});
