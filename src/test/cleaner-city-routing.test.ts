import { describe, expect, it } from 'vitest';
import {
  decodePolyline,
  encodePolyline,
  estimateDetourMinutesFallback,
  haversineMeters,
} from '@/lib/cleaner-city/routing';

describe('cleaner-city routing helpers', () => {
  it('round-trips polyline encode/decode', () => {
    const path = [
      { lat: 12.9716, lng: 77.5946 },
      { lat: 12.98, lng: 77.6 },
      { lat: 13.0, lng: 77.61 },
    ];
    const encoded = encodePolyline(path);
    const decoded = decodePolyline(encoded);
    expect(decoded).toHaveLength(3);
    expect(decoded[0].lat).toBeCloseTo(12.9716, 4);
    expect(decoded[2].lng).toBeCloseTo(77.61, 4);
  });

  it('estimates positive detour when guest is off the direct path', () => {
    const hostOrigin = { lat: 12.9, lng: 77.5 };
    const hostDest = { lat: 13.0, lng: 77.6 };
    const guestPickup = { lat: 12.95, lng: 77.45 };
    const guestDest = { lat: 12.99, lng: 77.65 };
    const direct = haversineMeters(hostOrigin, hostDest);
    expect(direct).toBeGreaterThan(1000);
    const detour = estimateDetourMinutesFallback(hostOrigin, hostDest, guestPickup, guestDest);
    expect(detour.ok).toBe(true);
    expect(detour.estimatedDetourMinutes).toBeGreaterThan(0);
  });
});
