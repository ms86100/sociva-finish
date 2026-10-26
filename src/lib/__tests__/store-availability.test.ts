// @ts-nocheck
import { describe, it, expect, vi, afterEach } from 'vitest';
import { computeStoreStatus, formatStoreClosedMessage, formatStoreClosedBuyerMessage, parseStoreClosedBuyerError, type StoreAvailability } from '../store-availability';

function mockTime(dateStr: string) {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(dateStr));
}

afterEach(() => { vi.useRealTimers(); });

describe('computeStoreStatus', () => {
  it('returns paused when isAvailable is false', () => {
    mockTime('2026-03-07T14:00:00');
    const result = computeStoreStatus('09:00', '21:00', ['Sat'], false);
    expect(result.status).toBe('paused');
    expect(result.nextOpenAt).toBeNull();
    expect(result.minutesUntilOpen).toBeNull();
  });

  it('returns open when no hours configured (null)', () => {
    mockTime('2026-03-07T04:00:00');
    const result = computeStoreStatus(null, null, null, true);
    expect(result.status).toBe('open');
    expect(result.minutesUntilOpen).toBe(0);
  });

  it('returns open when current time is within operating window', () => {
    mockTime('2026-03-07T14:00:00');
    const result = computeStoreStatus('09:00', '21:00', ['Sat'], true);
    expect(result.status).toBe('open');
    expect(result.minutesUntilOpen).toBe(0);
  });

  it('returns closed with correct minutesUntilOpen when before opening', () => {
    mockTime('2026-03-07T04:00:00');
    const result = computeStoreStatus('09:00', '21:00', ['Sat'], true);
    expect(result.status).toBe('closed');
    expect(result.minutesUntilOpen).toBe(300);
    expect(result.nextOpenAt).not.toBeNull();
  });

  it('returns closed with nextOpenAt tomorrow when after closing', () => {
    mockTime('2026-03-07T22:00:00');
    const result = computeStoreStatus('09:00', '21:00', ['Sat', 'Sun'], true);
    expect(result.status).toBe('closed');
    expect(result.nextOpenAt).not.toBeNull();
    const nextOpen = new Date(result.nextOpenAt!);
    expect(nextOpen.getHours()).toBe(9);
    expect(nextOpen.getMinutes()).toBe(0);
    expect(nextOpen.getDate()).toBe(8);
  });

  it('returns closed_today when current day is not in operating days', () => {
    mockTime('2026-03-08T14:00:00'); // Sunday IST-ish depending on local; use UTC carefully
    const result = computeStoreStatus('09:00', '21:00', ['Mon', 'Tue'], true);
    expect(result.status).toBe('closed_today');
  });

  it('closed_today includes next open day and time', () => {
    // Monday 26 Oct 2026 12:00 IST = 06:30 UTC
    mockTime('2026-10-26T06:30:00.000Z');
    const result = computeStoreStatus('10:00', '22:30', ['Sun', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'], true);
    expect(result.status).toBe('closed_today');
    expect(result.nextOpenAt).not.toBeNull();
    expect(result.minutesUntilOpen).toBeGreaterThan(0);
    const msg = formatStoreClosedMessage(result);
    expect(msg).toMatch(/Closed today/);
    expect(msg).toMatch(/Opens Tue/i);
    expect(msg).toMatch(/10:00/i);
  });

  it('treats lowercase operating days as open (seed/form mixed case)', () => {
    mockTime('2026-03-07T14:00:00');
    const result = computeStoreStatus('09:00', '21:00', ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'], true);
    expect(result.status).toBe('open');
  });

  it('treats numeric 0-6 operating days as Sun-Sat', () => {
    mockTime('2026-03-07T14:00:00'); // Saturday
    const result = computeStoreStatus('09:00', '21:00', ['0', '1', '2', '3', '4', '5', '6'], true);
    expect(result.status).toBe('open');
  });

  it('returns open when operating days is empty array and within hours', () => {
    mockTime('2026-03-07T14:00:00');
    const result = computeStoreStatus('09:00', '21:00', [], true);
    expect(result.status).toBe('open');
  });

  it('returns open when operating days is null and within hours', () => {
    mockTime('2026-03-07T14:00:00');
    const result = computeStoreStatus('09:00', '21:00', null, true);
    expect(result.status).toBe('open');
  });

  it('returns open at exact opening minute', () => {
    mockTime('2026-03-07T09:00:00');
    const result = computeStoreStatus('09:00', '21:00', null, true);
    expect(result.status).toBe('open');
  });

  it('returns closed at exact closing minute', () => {
    mockTime('2026-03-07T21:00:00');
    const result = computeStoreStatus('09:00', '21:00', null, true);
    expect(result.status).toBe('closed');
  });

  it('handles overnight hours 20:00-03:00 IST (seller opens at 8pm, closes at 3am IST)', () => {
    // 20:00-03:00 is an overnight window. Seller opens at 8pm IST, closes at 3am IST next day.
    // Device may be in CET, but stored times are already IST; store-availability uses UTC+5:30 internally.
    // Test: mocked time = 10pm IST (so seller is inside the overnight window, should be "open")
    // mockTime sets the system time; computeStoreStatus converts to IST internally.
    mockTime('2026-03-07T17:00:00.000Z'); // 5pm UTC → 10:30pm IST
    const result = computeStoreStatus('20:00', '03:00', ['Sat', 'Sun'], true);
    // At 10:30pm IST, the seller is within the 20:00-03:00 overnight window → open
    expect(result.status).toBe('open');
    expect(result.minutesUntilOpen).toBe(0);
  });

  it('backward compat: undefined fields treated as always open', () => {
    mockTime('2026-03-07T04:00:00');
    const result = computeStoreStatus(undefined, undefined, undefined, true);
    expect(result.status).toBe('open');
  });

  it('backward compat: HH:MM:SS time format works', () => {
    mockTime('2026-03-07T14:00:00');
    const result = computeStoreStatus('09:00:00', '21:00:00', null, true);
    expect(result.status).toBe('open');
  });

  it('backward compat: empty string times treated as no hours configured', () => {
    mockTime('2026-03-07T04:00:00');
    const result = computeStoreStatus('' as any, '' as any, null, true);
    expect(result.status).toBe('open');
  });
});

describe('formatStoreClosedMessage', () => {
  it('returns "Store paused" for paused status', () => {
    expect(formatStoreClosedMessage({ status: 'paused', nextOpenAt: null, minutesUntilOpen: null })).toBe('Store paused');
  });

  it('returns "Closed today" for closed_today status without next open', () => {
    expect(formatStoreClosedMessage({ status: 'closed_today', nextOpenAt: null, minutesUntilOpen: null })).toBe('Closed today');
  });

  it('appends next open label for closed_today when nextOpenAt is set', () => {
    // Tue 27 Oct 2026 10:00 IST = 04:30 UTC
    const msg = formatStoreClosedMessage({
      status: 'closed_today',
      nextOpenAt: '2026-10-27T04:30:00.000Z',
      minutesUntilOpen: 1320,
    });
    expect(msg).toMatch(/Closed today · Opens Tue/i);
    expect(msg).toMatch(/10:00/i);
  });

  it('returns "Opens in X min" when under 60 minutes', () => {
    expect(formatStoreClosedMessage({ status: 'closed', nextOpenAt: null, minutesUntilOpen: 30 })).toBe('Opens in 30 min');
  });

  it('returns "Opens in 1 hr" when 60-119 minutes', () => {
    expect(formatStoreClosedMessage({ status: 'closed', nextOpenAt: null, minutesUntilOpen: 90 })).toBe('Opens in 1 hr');
  });

  it('returns day + time when >2 hrs and nextOpenAt provided', () => {
    const nextOpen = new Date('2026-03-07T09:00:00');
    const msg = formatStoreClosedMessage({ status: 'closed', nextOpenAt: nextOpen.toISOString(), minutesUntilOpen: 300 });
    expect(msg).toMatch(/^Opens /);
    expect(msg).toMatch(/9:00/i);
  });

  it('returns empty string for open status', () => {
    expect(formatStoreClosedMessage({ status: 'open', nextOpenAt: null, minutesUntilOpen: 0 })).toBe('');
  });

  it('returns "Store closed" when minutes is null', () => {
    expect(formatStoreClosedMessage({ status: 'closed', nextOpenAt: null, minutesUntilOpen: null })).toBe('Store closed');
  });

  it('returns "Opens in X hrs" when >2 hrs and no nextOpenAt', () => {
    expect(formatStoreClosedMessage({ status: 'closed', nextOpenAt: null, minutesUntilOpen: 300 })).toBe('Opens in 5 hrs');
  });
});

describe('formatStoreClosedBuyerMessage', () => {
  it('explains paused without sounding like a system failure', () => {
    expect(formatStoreClosedBuyerMessage({ status: 'paused', nextOpenAt: null, minutesUntilOpen: null }))
      .toBe('This store is currently paused. Your items may still be available when it reopens.');
  });

  it('explains closed today', () => {
    expect(formatStoreClosedBuyerMessage({ status: 'closed_today', nextOpenAt: null, minutesUntilOpen: null }))
      .toBe('This store is closed today. Your items may still be available when it reopens.');
  });

  it('includes minutes until reopen', () => {
    expect(formatStoreClosedBuyerMessage({ status: 'closed', nextOpenAt: null, minutesUntilOpen: 30 }))
      .toBe('This store is currently closed. It will reopen in 30 minutes.');
  });

  it('includes hours until reopen', () => {
    expect(formatStoreClosedBuyerMessage({ status: 'closed', nextOpenAt: null, minutesUntilOpen: 120 }))
      .toBe('This store is currently closed. It will reopen in 2 hours.');
  });

  it('is empty when the store is open', () => {
    expect(formatStoreClosedBuyerMessage({ status: 'open', nextOpenAt: null, minutesUntilOpen: 0 })).toBe('');
  });
});

describe('parseStoreClosedBuyerError', () => {
  it('reads STORE_CLOSED codes from cart insert errors', () => {
    expect(parseStoreClosedBuyerError(new Error('STORE_CLOSED:paused'))).toMatch(/currently paused/);
    expect(parseStoreClosedBuyerError(new Error('STORE_CLOSED:closed'))).toMatch(/currently closed/);
  });

  it('returns null for unrelated failures', () => {
    expect(parseStoreClosedBuyerError(new Error('network timeout'))).toBeNull();
  });
});
