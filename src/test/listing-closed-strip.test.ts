import { describe, expect, it, vi, afterEach } from 'vitest';
import { buildListingClosedStrip } from '@/lib/listing-closed-strip';

afterEach(() => {
  vi.useRealTimers();
});

describe('buildListingClosedStrip', () => {
  it('builds a full closed message for Monday-closed Mountain High style stores', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-26T06:30:00.000Z')); // Mon 12:00 IST

    const strip = buildListingClosedStrip([
      {
        seller_id: 's1',
        seller_name: 'Mountain High Studio Cafe',
        seller_availability_start: '10:00:00',
        seller_availability_end: '22:30:00',
        seller_operating_days: ['Sun', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'],
        seller_is_available: true,
      },
      {
        seller_id: 's1',
        seller_name: 'Mountain High Studio Cafe',
        seller_availability_start: '10:00:00',
        seller_availability_end: '22:30:00',
        seller_operating_days: ['Sun', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'],
        seller_is_available: true,
      },
    ]);

    expect(strip).not.toBeNull();
    expect(strip!.message).toMatch(/Closed today · Opens Tue/i);
    expect(strip!.message).toMatch(/10:00/i);
    expect(strip!.hint).toMatch(/Mountain High/);
  });

  it('returns null when everything is open', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-27T06:30:00.000Z')); // Tue 12:00 IST
    const strip = buildListingClosedStrip([
      {
        seller_id: 's1',
        seller_name: 'Mountain High Studio Cafe',
        seller_availability_start: '10:00:00',
        seller_availability_end: '22:30:00',
        seller_operating_days: ['Sun', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'],
        seller_is_available: true,
      },
    ]);
    expect(strip).toBeNull();
  });
});
