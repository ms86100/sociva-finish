/**
 * Phase 0: human-readable copy for A Cleaner City match reason codes.
 * Reason codes come from cleaner_city_find_matches (see unit6 migration).
 */

const REASON_LABELS: Record<string, string> = {
  departure_within_window: 'Leaves near your time',
  departure_unchecked: 'Time flexible',
  seats_available: 'Seats open',
  pickup_within_corridor: 'Pickup nearby',
  pickup_on_route_corridor: 'Pickup on route',
  drop_on_route_corridor: 'Drop on route',
  drop_mid_route: 'Drop mid-route',
  pickup_before_drop: 'Stops in order',
  pickup_coords_missing: 'Pickup TBD',
  destination_near_host_end: 'Drops near you',
  destination_along_route_candidate: 'Along the way',
  destination_coords_missing: 'Drop TBD',
  detour_within_limit: 'Small detour',
  overlap_soft_below_target: 'Loose route fit',
  overlap_proxy_ok: 'Good corridor fit',
  road_polyline_overlap: 'Fits their route',
  road_overlap_below_target: 'Weak route fit',
  shared_circle: 'Trusted circle',
  drop_near_extra_stop: 'Near an extra stop',
  circle_with_two_completed_rides: 'Circle + history',
  vehicle_documents_verified: 'Docs verified',
};

/** Short chips for the match card (max clarity, less prose). */
export function matchReasonChips(reasons: string[], limit = 3): string[] {
  if (!reasons?.length) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const code of reasons) {
    const label = formatMatchReason(code);
    if (!label || seen.has(label)) continue;
    seen.add(label);
    out.push(label);
    if (out.length >= limit) break;
  }
  return out;
}

export function hostTierLabel(completedRides?: number | null) {
  const n = Number(completedRides) || 0;
  if (n >= 20) return 'Pro host';
  if (n >= 5) return 'Regular';
  if (n >= 1) return 'Rising';
  return 'New host';
}

export function matchFitPercent(score?: number | null) {
  const s = Number(score);
  if (!Number.isFinite(s) || s <= 0) return 35;
  return Math.max(28, Math.min(98, Math.round(s)));
}

export function vehicleKindLabel(type?: string | null) {
  const t = String(type || '').toLowerCase();
  if (t === 'bike') return '2-wheeler';
  if (t === 'car') return '4-wheeler';
  return t ? t : 'Vehicle';
}

export function formatVehicleTitle(input: {
  vehicle_type?: string | null;
  vehicle_make?: string | null;
  vehicle_model?: string | null;
  vehicle_color?: string | null;
}) {
  const kind = vehicleKindLabel(input.vehicle_type);
  const makeModel = [input.vehicle_make, input.vehicle_model].filter(Boolean).join(' ').trim();
  const color = String(input.vehicle_color || '').trim();
  if (makeModel && color) return `${kind} · ${color} ${makeModel}`;
  if (makeModel) return `${kind} · ${makeModel}`;
  if (color) return `${kind} · ${color}`;
  return kind;
}

/** Compact distance for trip strip (40 m / 1.2 km). */
export function formatTripMeters(meters?: number | null): string | null {
  const m = Number(meters);
  if (!Number.isFinite(m) || m < 0) return null;
  if (m < 1000) return `${Math.max(1, Math.round(m))} m`;
  const km = m / 1000;
  return `${km >= 100 ? Math.round(km) : km.toFixed(1)} km`;
}

export function formatFuelShareRupees(paise?: number | null): number | null {
  const p = Number(paise);
  if (!Number.isFinite(p) || p <= 0) return null;
  return Math.max(1, Math.round(p / 100));
}

/** Leave window around host depart time, e.g. 08:25 - 08:35. */
export function pickupWindowLabel(departTime?: string | null, windowMinutes = 5): string | null {
  const raw = String(departTime || '').slice(0, 5);
  if (!/^\d{2}:\d{2}$/.test(raw)) return null;
  const [hh, mm] = raw.split(':').map(Number);
  const base = hh * 60 + mm;
  const pad = (n: number) => String(((n % (24 * 60)) + 24 * 60) % (24 * 60));
  const fmt = (mins: number) => {
    const t = Number(pad(mins));
    const h = Math.floor(t / 60);
    const m = t % 60;
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
  };
  return `${fmt(base - windowMinutes)} - ${fmt(base + windowMinutes)}`;
}

export function tripLegsFromMatch(input: {
  pickup_walk_meters?: number | null;
  pickup_deviation_meters?: number | null;
  route_distance_meters?: number | null;
  estimated_detour_minutes?: number | null;
  reasons?: string[] | null;
  extra_stop_meters?: number | null;
}): { walkPickup: number | null; drive: number | null; walkDrop: number | null } {
  const walkPickup =
    Number(input.pickup_walk_meters) > 0
      ? Number(input.pickup_walk_meters)
      : Number(input.pickup_deviation_meters) > 0
        ? Number(input.pickup_deviation_meters)
        : null;
  let drive =
    Number(input.route_distance_meters) > 0 ? Number(input.route_distance_meters) : null;
  if (drive == null && Number(input.estimated_detour_minutes) > 0) {
    // Rough fallback: ~400 m per detour minute of host path stretch.
    drive = Math.round(Number(input.estimated_detour_minutes) * 400 + 8000);
  }
  const reasons = input.reasons || [];
  let walkDrop: number | null =
    Number(input.extra_stop_meters) > 0 ? Number(input.extra_stop_meters) : null;
  if (walkDrop == null && reasons.some((r) => /destination_near|drop_near/i.test(String(r)))) {
    walkDrop = 180;
  }
  if (walkDrop == null && walkPickup != null) {
    walkDrop = Math.min(400, Math.max(80, Math.round(walkPickup * 0.7)));
  }
  return { walkPickup, drive, walkDrop };
}

function humanizeReasonCode(code: string): string {
  return code
    .split('_')
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

/** Maps a single reason code to its human-readable label, falling back to a humanized form. */
export function formatMatchReason(reason: string): string {
  if (!reason) return '';
  return REASON_LABELS[reason] || humanizeReasonCode(reason);
}

/**
 * Formats an array of reason codes into a single human-readable string
 * for display on a match card, e.g. "Pickup near your usual spot - Good route overlap".
 */
export function formatMatchReasons(reasons: string[]): string {
  if (!reasons || reasons.length === 0) return 'Match details pending';
  const labels = reasons.map(formatMatchReason).filter(Boolean);
  if (labels.length === 0) return 'Match details pending';
  return labels.join(' - ');
}
