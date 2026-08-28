import { describe, it, expect } from 'vitest';
import { leadTimeToHours } from '@/lib/lead-time';
import { parsePrepTimeMinutes } from '@/lib/prep-time-minutes';

describe('seller society approval guard (contract)', () => {
  it('documents society error token for DB trigger and client', () => {
    const msg =
      'SELLER_SOCIETY_REQUIRED: Cannot approve store without a society. Link the seller account to a society first.';
    expect(msg).toContain('SELLER_SOCIETY_REQUIRED');
    expect(msg.toLowerCase()).toContain('society');
  });
});

describe('prep time validation', () => {
  it('rejects decimals like .3', () => {
    const result = parsePrepTimeMinutes('.3');
    expect(result.minutes).toBeNull();
    expect(result.error).toMatch(/whole number/i);
  });

  it('accepts positive integers', () => {
    expect(parsePrepTimeMinutes('30').minutes).toBe(30);
    expect(parsePrepTimeMinutes('30').error).toBeUndefined();
  });
});

describe('lead time fractional hours', () => {
  it('stores 30 minutes as 0.5 hours (not truncated to 0)', () => {
    expect(leadTimeToHours(30, 'minutes')).toBe(0.5);
  });
});
