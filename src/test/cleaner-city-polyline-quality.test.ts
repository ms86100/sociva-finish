import { describe, expect, it } from 'vitest';
import {
  encodePolyline,
  isPublishableRouteGeometry,
  preferredStoragePolyline,
  type LatLng,
} from '@/lib/cleaner-city/routing';

function line(n: number, start: LatLng = { lat: 13.07, lng: 77.75 }): LatLng[] {
  return Array.from({ length: n }, (_, i) => ({
    lat: start.lat - i * 0.001,
    lng: start.lng - i * 0.001,
  }));
}

describe('Cleaner City polyline publish quality', () => {
  it('prefers dense path encoding over sparse overview', () => {
    const path = line(20);
    const dense = encodePolyline(path);
    const sparse = encodePolyline(path.slice(0, 3));
    expect(preferredStoragePolyline(sparse, path)).toBe(dense);
  });

  it('rejects haversine fallback and sparse geometry', () => {
    const path = line(3);
    expect(
      isPublishableRouteGeometry({
        polyline: encodePolyline(path),
        path,
        provider: 'google',
      }).ok,
    ).toBe(false);
    expect(
      isPublishableRouteGeometry({
        polyline: encodePolyline(line(12)),
        path: line(12),
        provider: 'haversine_fallback',
      }).ok,
    ).toBe(false);
  });

  it('accepts dense path that snaps to origin and destination', () => {
    const path = line(16);
    const poly = encodePolyline(path);
    const check = isPublishableRouteGeometry({
      polyline: poly,
      path,
      provider: 'google',
      origin: path[0],
      destination: path[path.length - 1],
    });
    expect(check).toEqual({ ok: true });
  });

  it('rejects Pacific-style overview that does not snap to Bangalore pins', () => {
    // Classic 3-point garbage sample far from India
    const garbage = encodePolyline([
      { lat: 43.25, lng: -126.45 },
      { lat: 43.26, lng: -126.44 },
      { lat: 43.27, lng: -126.43 },
    ]);
    const check = isPublishableRouteGeometry({
      polyline: garbage,
      provider: 'google',
      origin: { lat: 13.0713, lng: 77.7514 },
      destination: { lat: 12.9716, lng: 77.5946 },
      minPoints: 3,
    });
    expect(check.ok).toBe(false);
  });
});
