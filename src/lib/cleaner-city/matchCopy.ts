/**
 * Phase 0: human-readable copy for A Cleaner City match reason codes.
 * Reason codes come from cleaner_city_find_matches (see unit6 migration).
 */

const REASON_LABELS: Record<string, string> = {
  departure_within_window: 'Departs around your time',
  departure_unchecked: 'Departure time not confirmed yet',
  seats_available: 'Seats available',
  pickup_within_corridor: 'Pickup near your usual spot',
  pickup_coords_missing: 'Host pickup corridor unverified',
  destination_near_host_end: 'Drops near your destination',
  destination_along_route_candidate: 'Destination roughly along the route',
  destination_coords_missing: 'Destination corridor unverified',
  detour_within_limit: 'Short estimated detour for host',
  overlap_soft_below_target: 'Approximate corridor fit (straight-line estimate)',
  overlap_proxy_ok: 'Approximate corridor fit (straight-line estimate)',
  road_polyline_overlap: 'Fits the saved driving route',
  road_overlap_below_target: 'Saved driving route is a weak fit',
  shared_circle: 'In your trusted circle',
  drop_near_extra_stop: 'Drops near an extra stop on this commute',
  circle_with_two_completed_rides: 'In your circle, with at least two completed rides',
  vehicle_documents_verified: 'Vehicle documents verified',
};

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
