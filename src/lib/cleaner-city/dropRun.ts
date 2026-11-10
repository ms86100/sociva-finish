import type { DropSequenceResult, DropStop, LatLng } from '@/lib/cleaner-city/routing';

export type DropProgressStatus = 'pending' | 'arrived' | 'dropped';

export type DropProgressEntry = {
  status: DropProgressStatus;
  updatedAt: string;
};

export type DropOrderPersisted = {
  provider: string;
  distanceMeters: number;
  durationSeconds: number;
  polyline: string;
  ordered: Array<DropStop & { dropIndex: number }>;
  progress?: Record<string, DropProgressEntry>;
  savedAt: string;
};

export function guestStopId(rideId: string): string {
  return `guest-${rideId}`;
}

export function parseDropOrderJson(raw: unknown): DropOrderPersisted | null {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Partial<DropOrderPersisted>;
  if (!Array.isArray(o.ordered) || o.ordered.length === 0) return null;
  return {
    provider: String(o.provider || 'haversine_fallback'),
    distanceMeters: Number(o.distanceMeters) || 0,
    durationSeconds: Number(o.durationSeconds) || 0,
    polyline: String(o.polyline || ''),
    ordered: o.ordered as Array<DropStop & { dropIndex: number }>,
    progress:
      o.progress && typeof o.progress === 'object'
        ? (o.progress as Record<string, DropProgressEntry>)
        : {},
    savedAt: String(o.savedAt || ''),
  };
}

/** Guest rank from persisted publication drop_order_json. */
export function guestDropRankFromOrder(
  dropOrder: unknown,
  rideId: string | null | undefined,
): { n: number; m: number } | null {
  if (!rideId) return null;
  const parsed = parseDropOrderJson(dropOrder);
  if (!parsed) return null;
  const mine = parsed.ordered.find((s) => s.id === guestStopId(rideId));
  if (!mine) return null;
  return { n: mine.dropIndex, m: parsed.ordered.length };
}

const PROGRESS_RANK: Record<DropProgressStatus, number> = {
  pending: 0,
  arrived: 1,
  dropped: 2,
};

/** Keep the furthest status when merging cached + local progress. */
export function preferDropProgress(
  a?: Record<string, DropProgressEntry>,
  b?: Record<string, DropProgressEntry>,
): Record<string, DropProgressEntry> {
  const ids = new Set([...Object.keys(a || {}), ...Object.keys(b || {})]);
  const next: Record<string, DropProgressEntry> = {};
  for (const id of ids) {
    const left = a?.[id];
    const right = b?.[id];
    if (!left && !right) continue;
    if (!left) {
      next[id] = right!;
      continue;
    }
    if (!right) {
      next[id] = left;
      continue;
    }
    const leftRank = PROGRESS_RANK[left.status] ?? 0;
    const rightRank = PROGRESS_RANK[right.status] ?? 0;
    next[id] = rightRank >= leftRank ? right : left;
  }
  return next;
}

export function mergeDropProgress(
  previous: Record<string, DropProgressEntry> | undefined,
  orderedIds: string[],
): Record<string, DropProgressEntry> {
  const next: Record<string, DropProgressEntry> = {};
  for (const id of orderedIds) {
    const prev = previous?.[id];
    next[id] = prev?.status
      ? prev
      : { status: 'pending', updatedAt: new Date().toISOString() };
  }
  return next;
}

export function buildDropOrderPayload(
  plan: DropSequenceResult,
  previousProgress?: Record<string, DropProgressEntry>,
): DropOrderPersisted {
  const orderedIds = plan.ordered.map((s) => s.id);
  return {
    provider: plan.provider,
    distanceMeters: plan.distanceMeters,
    durationSeconds: plan.durationSeconds,
    polyline: plan.polyline,
    ordered: plan.ordered,
    progress: mergeDropProgress(previousProgress, orderedIds),
    savedAt: new Date().toISOString(),
  };
}

export function stopProgressStatus(
  progress: Record<string, DropProgressEntry> | undefined,
  stopId: string,
): DropProgressStatus {
  return progress?.[stopId]?.status || 'pending';
}

export function withUpdatedStopProgress(
  dropOrder: DropOrderPersisted,
  stopId: string,
  status: DropProgressStatus,
): DropOrderPersisted {
  return {
    ...dropOrder,
    progress: {
      ...(dropOrder.progress || {}),
      [stopId]: { status, updatedAt: new Date().toISOString() },
    },
    savedAt: new Date().toISOString(),
  };
}

/** Origin for navigating to stop N: previous dropped pin, else mission origin. */
export function mapsOriginForStop(input: {
  stopIndex: number;
  ordered: Array<DropStop & { dropIndex: number }>;
  missionOrigin: LatLng;
  currentGps?: LatLng | null;
}): LatLng {
  if (input.currentGps) return input.currentGps;
  if (input.stopIndex <= 0) return input.missionOrigin;
  const prev = input.ordered[input.stopIndex - 1];
  if (prev) return { lat: prev.lat, lng: prev.lng };
  return input.missionOrigin;
}

export function allGuestsDropped(
  ordered: Array<{ id: string }>,
  progress: Record<string, DropProgressEntry> | undefined,
): boolean {
  if (!ordered.length) return false;
  return ordered.every((s) => progress?.[s.id]?.status === 'dropped');
}
