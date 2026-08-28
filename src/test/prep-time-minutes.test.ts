import { describe, expect, it } from 'vitest';
import {
  parsePrepTimeMinutes,
  PREP_TIME_MINUTES_ERROR,
  sanitizePrepTimeMinutesInput,
} from '@/lib/prep-time-minutes';

describe('prep time minutes', () => {
  it('rejects decimal strings like .3 and 3.5', () => {
    expect(parsePrepTimeMinutes('.3').error).toBe(PREP_TIME_MINUTES_ERROR);
    expect(parsePrepTimeMinutes('3.5').error).toBe(PREP_TIME_MINUTES_ERROR);
    expect(parsePrepTimeMinutes('0.3').error).toBe(PREP_TIME_MINUTES_ERROR);
  });

  it('accepts whole minute values', () => {
    expect(parsePrepTimeMinutes('30')).toEqual({ minutes: 30 });
    expect(parsePrepTimeMinutes('1')).toEqual({ minutes: 1 });
  });

  it('treats empty as null', () => {
    expect(parsePrepTimeMinutes('')).toEqual({ minutes: null });
    expect(parsePrepTimeMinutes('   ')).toEqual({ minutes: null });
  });

  it('strips non-digits while typing', () => {
    expect(sanitizePrepTimeMinutesInput('.3')).toBe('3');
    expect(sanitizePrepTimeMinutesInput('12a')).toBe('12');
  });
});
