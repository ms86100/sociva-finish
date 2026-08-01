// @ts-nocheck
import { describe, it, expect, vi, afterEach } from 'vitest';
import { computeStoreStatus, formatStoreClosedMessage, type StoreAvailability } from '../store-availability';

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
    mockTime('2026-03-08T14:00:00');
    const result = computeStoreStatus('09:00', '21:00', ['Mon', 'Tue'], true);
    expect(result.status).toBe('closed_today');
    expect(result.minutesUntilOpen).toBeNull();
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

  it('returns "Closed today" for closed_today status', () => {
    expect(formatStoreClosedMessage({ status: 'closed_today', nextOpenAt: null, minutesUntilOpen: null })).toBe('Closed today');
  });

  it('returns "Opens in X min" when under 60 minutes', () => {
    expect(formatStoreClosedMessage({ status: 'closed', nextOpenAt: null, minutesUntilOpen: 30 })).toBe('Opens in 30 min');
  });

  it('returns "Opens in 1 hr" when 60-119 minutes', () => {
    expect(formatStoreClosedMessage({ status: 'closed', nextOpenAt: null, minutesUntilOpen: 90 })).toBe('Opens in 1 hr');
  });

  it('returns "Opens at HH:MM" when >2 hrs and nextOpenAt provided', () => {
    const nextOpen = new Date('2026-03-07T09:00:00');
    const msg = formatStoreClosedMessage({ status: 'closed', nextOpenAt: nextOpen.toISOString(), minutesUntilOpen: 300 });
    expect(msg).toMatch(/Opens at/);
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
