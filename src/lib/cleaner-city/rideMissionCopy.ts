export const RIDE_MISSION_STEPS = [
  'requested',
  'confirmed',
  'pickup_pending',
  'started',
  'completed',
] as const;

export type RideMissionStep = (typeof RIDE_MISSION_STEPS)[number];

const STATUS_LABEL: Record<string, string> = {
  requested: 'Waiting for host',
  confirmed: 'Seat confirmed',
  pickup_pending: 'Meet at the gate',
  started: 'On the road',
  completed: 'Ride done',
  rejected: 'Declined',
  cancelled: 'Cancelled',
  no_show: 'No-show',
  disputed: 'Under review',
  safety_incident: 'SOS active',
};

/** SOS while meeting or riding. Trip share only once the trip has started. */
export function canShowRideSos(status?: string | null) {
  return ['pickup_pending', 'started', 'safety_incident'].includes(String(status || ''));
}

export function canShowTripShare(status?: string | null) {
  return ['started', 'safety_incident'].includes(String(status || ''));
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

export function rideNextHint(status: string, isHost: boolean) {
  if (status === 'requested') {
    return isHost
      ? 'Accept to hold this seat, or decline if it does not fit.'
      : 'Hang tight - the host will accept or decline soon.';
  }
  if (status === 'confirmed') {
    return isHost
      ? 'Set a meeting point, then generate the pickup OTP.'
      : 'Confirm the meeting point so you both know where to wait.';
  }
  if (status === 'pickup_pending') {
    return isHost
      ? 'Show the code to your guest. They type it to start.'
      : 'Ask the host for the 6-digit code, then start.';
  }
  if (status === 'started') {
    return isHost
      ? 'When everyone is dropped, complete the ride.'
      : 'Live map is on - message if you are late.';
  }
  if (status === 'completed') {
    return 'Rate your partner and settle fuel if needed.';
  }
  if (status === 'disputed') {
    return 'A society admin will review. Tell your side if you disagree.';
  }
  if (status === 'safety_incident') {
    return 'SOS is active. Call 112 if you are in danger.';
  }
  if (status === 'no_show' || status === 'cancelled') {
    return 'This ride ended early. You can report a problem if needed.';
  }
  return 'Follow the next step below.';
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
