import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import {
  allGuestsDropped,
  buildDropOrderPayload,
  guestDropRankFromOrder,
  guestStopId,
  mapsOriginForStop,
  mergeDropProgress,
  parseDropOrderJson,
  withUpdatedStopProgress,
} from '@/lib/cleaner-city/dropRun';
import { planDropSequence, type DropStop } from '@/lib/cleaner-city/routing';

/** Shriram Greenfield (approx) → Whitefield ITPL corridor. */
const GREENFIELD = { lat: 12.8948, lng: 77.6719 };
const WHITEFIELD = { lat: 12.9698, lng: 77.7499 };

/** Three guest dests along the corridor (A nearer Greenfield, C nearer Whitefield). */
const GUEST_A: DropStop = {
  id: guestStopId('ride-a'),
  label: 'Asha · Flat 101',
  lat: 12.91,
  lng: 77.69,
};
const GUEST_B: DropStop = {
  id: guestStopId('ride-b'),
  label: 'Bala · Flat 204',
  lat: 12.94,
  lng: 77.72,
};
const GUEST_C: DropStop = {
  id: guestStopId('ride-c'),
  label: 'Chitra · Flat 308',
  lat: 12.96,
  lng: 77.74,
};

describe('Greenfield → Whitefield auto drop run', () => {
  beforeEach(() => {
    vi.stubGlobal('google', undefined);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('builds an ordered plan for 3 guest dests (1+ guests, guest pins only)', async () => {
    const plan = await planDropSequence({
      origin: GREENFIELD,
      destination: WHITEFIELD,
      stops: [GUEST_C, GUEST_A, GUEST_B],
    });

    expect(plan.ordered).toHaveLength(3);
    expect(plan.ordered.every((s) => s.id.startsWith('guest-'))).toBe(true);
    expect(plan.ordered.map((s) => s.dropIndex)).toEqual([1, 2, 3]);
    // Nearest-neighbor from Greenfield should hit A then B then C.
    expect(plan.ordered[0].id).toBe(GUEST_A.id);
    expect(plan.ordered[2].id).toBe(GUEST_C.id);
  });

  it('builds Drop 1 of 1 for a single accepted guest', async () => {
    const plan = await planDropSequence({
      origin: GREENFIELD,
      destination: WHITEFIELD,
      stops: [GUEST_B],
    });
    expect(plan.ordered).toHaveLength(1);
    expect(plan.ordered[0].dropIndex).toBe(1);
    const payload = buildDropOrderPayload(plan);
    expect(guestDropRankFromOrder(payload, 'ride-b')).toEqual({ n: 1, m: 1 });
  });

  it('exposes Drop N of M for every guest from persisted order', async () => {
    const plan = await planDropSequence({
      origin: GREENFIELD,
      destination: WHITEFIELD,
      stops: [GUEST_A, GUEST_B, GUEST_C],
    });
    const payload = buildDropOrderPayload(plan);

    expect(guestDropRankFromOrder(payload, 'ride-a')?.m).toBe(3);
    expect(guestDropRankFromOrder(payload, 'ride-b')?.m).toBe(3);
    expect(guestDropRankFromOrder(payload, 'ride-c')?.m).toBe(3);

    const ranks = ['ride-a', 'ride-b', 'ride-c']
      .map((id) => guestDropRankFromOrder(payload, id)!)
      .sort((x, y) => x.n - y.n);
    expect(ranks.map((r) => r.n)).toEqual([1, 2, 3]);
    expect(guestDropRankFromOrder(payload, 'missing')).toBeNull();
  });

  it('tracks Arrived → Dropped progress stop-by-stop then all dropped', async () => {
    const plan = await planDropSequence({
      origin: GREENFIELD,
      destination: WHITEFIELD,
      stops: [GUEST_A, GUEST_B, GUEST_C],
    });
    let order = buildDropOrderPayload(plan);
    const first = order.ordered[0];
    const second = order.ordered[1];
    const third = order.ordered[2];

    order = withUpdatedStopProgress(order, first.id, 'arrived');
    expect(order.progress?.[first.id]?.status).toBe('arrived');
    expect(allGuestsDropped(order.ordered, order.progress)).toBe(false);

    order = withUpdatedStopProgress(order, first.id, 'dropped');
    order = withUpdatedStopProgress(order, second.id, 'arrived');
    order = withUpdatedStopProgress(order, second.id, 'dropped');
    order = withUpdatedStopProgress(order, third.id, 'arrived');
    order = withUpdatedStopProgress(order, third.id, 'dropped');

    expect(allGuestsDropped(order.ordered, order.progress)).toBe(true);

    const mapsOrigin2 = mapsOriginForStop({
      stopIndex: 1,
      ordered: order.ordered,
      missionOrigin: GREENFIELD,
    });
    expect(mapsOrigin2).toEqual({ lat: first.lat, lng: first.lng });
  });

  it('preserves progress when guest set is rebuilt', () => {
    const previous = {
      [GUEST_A.id]: { status: 'dropped' as const, updatedAt: '2026-01-01T00:00:00.000Z' },
      [GUEST_B.id]: { status: 'arrived' as const, updatedAt: '2026-01-01T00:01:00.000Z' },
    };
    const merged = mergeDropProgress(previous, [GUEST_A.id, GUEST_C.id]);
    expect(merged[GUEST_A.id].status).toBe('dropped');
    expect(merged[GUEST_C.id].status).toBe('pending');
    expect(merged[GUEST_B.id]).toBeUndefined();
  });

  it('parses drop_order_json with progress for mission chips', () => {
    const raw = {
      provider: 'haversine_fallback',
      distanceMeters: 12000,
      durationSeconds: 1800,
      polyline: '',
      ordered: [
        { ...GUEST_A, dropIndex: 1 },
        { ...GUEST_B, dropIndex: 2 },
        { ...GUEST_C, dropIndex: 3 },
      ],
      progress: {
        [GUEST_A.id]: { status: 'dropped', updatedAt: 'x' },
      },
      savedAt: '2026-11-01T10:00:00.000Z',
    };
    const parsed = parseDropOrderJson(raw);
    expect(parsed?.ordered).toHaveLength(3);
    expect(guestDropRankFromOrder(parsed, 'ride-b')).toEqual({ n: 2, m: 3 });
  });
});
