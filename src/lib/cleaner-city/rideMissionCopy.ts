export const RIDE_MISSION_STEPS = [
  'requested',
  'confirmed',
  'pickup_pending',
  'started',
  'completed',
] as const;

export type RideMissionStep = (typeof RIDE_MISSION_STEPS)[number];

/** Active-ride strip omits Request - that step is already done once the ride opens. */
export const RIDE_VISIBLE_STEPS = [
  'confirmed',
  'pickup_pending',
  'started',
  'completed',
] as const;

export type RideVisibleStep = (typeof RIDE_VISIBLE_STEPS)[number];

const STATUS_LABEL: Record<string, string> = {
  requested: 'Waiting for host',
  confirmed: 'Seat confirmed',
  pickup_pending: 'Meet at the gate',
  started: 'On the way',
  completed: 'Ride done',
  rejected: 'Declined',
  cancelled: 'Cancelled',
  no_show: 'No-show',
  disputed: 'Under review',
  safety_incident: 'SOS active',
};

/** SOS from seat confirmed onward. Trip share from confirmed (pre-trip + live). */
export function canShowRideSos(status?: string | null) {
  return ['confirmed', 'pickup_pending', 'started', 'safety_incident'].includes(
    String(status || ''),
  );
}

export function canShowTripShare(status?: string | null) {
  return ['confirmed', 'pickup_pending', 'started', 'safety_incident'].includes(
    String(status || ''),
  );
}

export function canOpenDispute(status?: string | null) {
  return ['completed', 'no_show', 'cancelled'].includes(String(status || ''));
}

export function formatStraightLineDistance(meters: number | null | undefined) {
  const m = Number(meters);
  if (!Number.isFinite(m) || m < 0) return null;
  if (m < 1000) return `${Math.round(m)} m`;
  return `${(m / 1000).toFixed(m >= 10000 ? 0 : 1)} km`;
}

const STEP_TITLE: Record<RideMissionStep, string> = {
  requested: 'Request',
  confirmed: 'Confirm',
  pickup_pending: 'Pickup',
  started: 'En route',
  completed: 'Done',
};

export function rideStatusLabel(status?: string | null) {
  if (!status) return 'Ride';
  return STATUS_LABEL[status] || status.replace(/_/g, ' ');
}

export function rideStepTitle(status: RideMissionStep) {
  return STEP_TITLE[status];
}

export function rideVisibleStepTitle(status: RideVisibleStep) {
  return STEP_TITLE[status];
}

/** Index into RIDE_VISIBLE_STEPS (Confirm → Done). Request maps to Confirm. */
export function visibleStepIndex(status?: string | null) {
  if (status === 'disputed' || status === 'safety_incident') {
    return RIDE_VISIBLE_STEPS.length - 1;
  }
  if (status === 'no_show' || status === 'cancelled' || status === 'rejected') {
    return RIDE_VISIBLE_STEPS.length - 1;
  }
  if (status === 'requested') return 0;
  const i = RIDE_VISIBLE_STEPS.indexOf(status as RideVisibleStep);
  return i >= 0 ? i : 0;
}

export function rideNextHint(status: string, isHost: boolean) {
  if (status === 'requested') {
    return isHost ? 'Accept or decline this seat.' : 'Waiting for the host.';
  }
  if (status === 'confirmed') {
    return isHost
      ? 'Confirm meet spot, then wait for the guest code.'
      : 'Go to the meet spot, then create your pickup code.';
  }
  if (status === 'pickup_pending') {
    return isHost
      ? "Enter the guest's 6-digit code to start."
      : 'Show your code to the host.';
  }
  if (status === 'started') {
    return isHost ? 'Drop guests, then complete.' : 'On the way - message if delayed.';
  }
  if (status === 'completed') {
    return 'Rate and settle fuel if needed.';
  }
  if (status === 'disputed') {
    return 'Under review.';
  }
  if (status === 'safety_incident') {
    return 'SOS active. Call 112 if needed.';
  }
  if (status === 'no_show' || status === 'cancelled') {
    return 'This ride ended early.';
  }
  return 'Continue below.';
}

export function firstName(name?: string | null) {
  const n = String(name || '').trim();
  if (!n) return 'Neighbour';
  return n.split(/\s+/)[0];
}

export function formatDepartTime(value?: string | null) {
  if (!value) return null;
  return String(value).slice(0, 5);
}

export function formatCountdown(iso?: string | null) {
  if (!iso) return null;
  const ms = Date.parse(iso) - Date.now();
  if (!Number.isFinite(ms)) return null;
  if (ms <= 0) return 'Expired';
  const mins = Math.round(ms / 60000);
  if (mins < 60) return `${mins} min left`;
  const hrs = Math.floor(mins / 60);
  const rem = mins % 60;
  return rem ? `${hrs}h ${rem}m left` : `${hrs}h left`;
}

export function stepIndex(status?: string | null) {
  if (status === 'disputed' || status === 'safety_incident') return RIDE_MISSION_STEPS.length - 1;
  if (status === 'no_show' || status === 'cancelled' || status === 'rejected') {
    return RIDE_MISSION_STEPS.length - 1;
  }
  const i = RIDE_MISSION_STEPS.indexOf(status as RideMissionStep);
  return i >= 0 ? i : 0;
}

/** Age of a location ping for live map honesty. */
export function locationFreshnessLabel(recordedAt?: string | null) {
  if (!recordedAt) return 'No live ping yet';
  const ageMs = Date.now() - Date.parse(recordedAt);
  if (!Number.isFinite(ageMs) || ageMs < 0) return 'Location time unknown';
  const sec = Math.round(ageMs / 1000);
  if (sec < 20) return 'Live · just now';
  if (sec < 60) return `Live · ${sec}s ago`;
  const mins = Math.round(sec / 60);
  if (mins < 5) return `Stale · ${mins} min ago`;
  if (mins < 60) return `Offline · last seen ${mins} min ago`;
  return 'Offline · last ping over an hour ago';
}

export function locationFreshnessTone(recordedAt?: string | null): 'live' | 'stale' | 'offline' {
  if (!recordedAt) return 'offline';
  const ageMs = Date.now() - Date.parse(recordedAt);
  if (!Number.isFinite(ageMs) || ageMs < 0) return 'offline';
  if (ageMs < 60_000) return 'live';
  if (ageMs < 5 * 60_000) return 'stale';
  return 'offline';
}

const LIFECYCLE_LABEL: Record<string, string> = {
  ride_created: 'Ride created',
  status_requested: 'Seat requested',
  status_confirmed: 'Seat confirmed',
  status_pickup_pending: 'Pickup started',
  status_started: 'Trip started',
  status_completed: 'Ride completed',
  status_cancelled: 'Cancelled',
  status_rejected: 'Declined',
  status_no_show: 'Marked no-show',
  status_disputed: 'Dispute opened',
  status_safety_incident: 'SOS recorded',
  meeting_pin_set: 'Meet spot set',
  share_token_created: 'Trip share link created',
  share_token_revoked: 'Trip share link revoked',
};

export function rideLifecycleEventLabel(event?: string | null) {
  if (!event) return 'Update';
  return LIFECYCLE_LABEL[event] || String(event).replace(/^status_/, '').replace(/_/g, ' ');
}
