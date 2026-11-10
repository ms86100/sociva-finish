/**
 * Smart meet-spot suggestion for host/guest after seat confirm.
 * Same society → nearest gate/lobby for guest walk.
 * Different society → snap guest pickup onto host corridor so host stays on route.
 */

export type MeetLatLng = { lat: number; lng: number };

export type MeetCandidate = {
  id: string;
  label: string;
  lat: number;
  lng: number;
  walkMeters?: number | null;
  detourMinutes?: number | null;
};

export type SmartMeetSpot = {
  id: string;
  label: string;
  lat: number;
  lng: number;
  /** Why this pin was chosen */
  reason: string;
  /** Guest walk to the pin */
  guestWalkMeters: number;
  /** Host detour from usual road (approx) */
  hostDetourMeters: number;
  sameSociety: boolean;
  kind: 'society_gate' | 'guest_on_corridor' | 'corridor_snap' | 'fallback';
};

export function meetHaversineMeters(a: MeetLatLng, b: MeetLatLng) {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const R = 6371000;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return Math.round(2 * R * Math.asin(Math.min(1, Math.sqrt(h))));
}

/** Closest vertex on a decoded path to a point (good enough for meet snaps). */
export function closestPointOnPath(path: MeetLatLng[], point: MeetLatLng) {
  if (!path.length) {
    return { point, meters: Number.POSITIVE_INFINITY, index: -1 };
  }
  let best = path[0];
  let bestMeters = meetHaversineMeters(path[0], point);
  let bestIndex = 0;
  for (let i = 1; i < path.length; i++) {
    const meters = meetHaversineMeters(path[i], point);
    if (meters < bestMeters) {
      best = path[i];
      bestMeters = meters;
      bestIndex = i;
    }
  }
  return { point: best, meters: bestMeters, index: bestIndex };
}

function formatWalk(meters: number) {
  if (meters < 1000) return `${Math.max(1, Math.round(meters))} m walk for guest`;
  return `${(meters / 1000).toFixed(1)} km walk for guest`;
}

/**
 * Pick one primary meet spot both sides should use.
 */
export function suggestSmartMeetSpot(input: {
  sameSociety: boolean;
  guestPickup: MeetLatLng | null;
  guestSocietyLabel?: string | null;
  hostOrigin: MeetLatLng | null;
  hostPath: MeetLatLng[];
  societyGates: MeetCandidate[];
}): SmartMeetSpot | null {
  const guest = input.guestPickup;
  const gates = [...(input.societyGates || [])].filter(
    (g) => Number.isFinite(g.lat) && Number.isFinite(g.lng),
  );
  const path = input.hostPath || [];

  // Same society: nearest gate/lobby within a sensible walk, else guest pin itself.
  if (input.sameSociety && guest) {
    const ranked = gates
      .map((g) => ({
        ...g,
        walk: g.walkMeters != null ? Number(g.walkMeters) : meetHaversineMeters(guest, g),
      }))
      .sort((a, b) => a.walk - b.walk);
    const gate = ranked[0];
    if (gate && gate.walk <= 1200) {
      const onRoute =
        path.length >= 2 ? closestPointOnPath(path, { lat: gate.lat, lng: gate.lng }).meters : 0;
      return {
        id: gate.id,
        label: gate.label,
        lat: gate.lat,
        lng: gate.lng,
        sameSociety: true,
        kind: 'society_gate',
        guestWalkMeters: Math.round(gate.walk),
        hostDetourMeters: Math.round(onRoute > 250 ? onRoute : 0),
        reason: `Same society - meet at ${gate.label}. Guest: ${formatWalk(gate.walk)}. You stay on your usual road.`,
      };
    }
    const snap =
      path.length >= 2 ? closestPointOnPath(path, guest) : { point: guest, meters: 0, index: 0 };
    return {
      id: 'guest-same-society',
      label: input.guestSocietyLabel
        ? `Near ${input.guestSocietyLabel}`
        : 'Guest building on your road',
      lat: snap.point.lat,
      lng: snap.point.lng,
      sameSociety: true,
      kind: 'guest_on_corridor',
      guestWalkMeters: Math.round(snap.meters),
      hostDetourMeters: 0,
      reason: `Same society - meet near their building on your corridor. Guest: ${formatWalk(snap.meters)}.`,
    };
  }

  // Different society (or unknown): snap guest onto host corridor so host does not leave route.
  if (guest && path.length >= 2) {
    const snap = closestPointOnPath(path, guest);
    // If a ranked gate is already very close to the snap, prefer the named gate.
    const nearGate = gates
      .map((g) => ({
        ...g,
        toSnap: meetHaversineMeters(snap.point, { lat: g.lat, lng: g.lng }),
        guestWalk: meetHaversineMeters(guest, { lat: g.lat, lng: g.lng }),
      }))
      .sort((a, b) => a.toSnap - b.toSnap)[0];
    if (nearGate && nearGate.toSnap <= 180 && nearGate.guestWalk <= 1500) {
      return {
        id: nearGate.id,
        label: nearGate.label,
        lat: nearGate.lat,
        lng: nearGate.lng,
        sameSociety: false,
        kind: 'society_gate',
        guestWalkMeters: Math.round(nearGate.guestWalk),
        hostDetourMeters: Math.round(nearGate.toSnap),
        reason: `Different society - meet at ${nearGate.label} on your road. Guest walks from their side (${formatWalk(nearGate.guestWalk)}).`,
      };
    }
    return {
      id: 'corridor-snap',
      label: 'Meet on your road near guest',
      lat: snap.point.lat,
      lng: snap.point.lng,
      sameSociety: false,
      kind: 'corridor_snap',
      guestWalkMeters: Math.round(snap.meters),
      hostDetourMeters: 0,
      reason: `Different society - you stay on your usual road. Guest walks ${formatWalk(snap.meters)} to this corridor pin.`,
    };
  }

  if (guest) {
    return {
      id: 'guest-fallback',
      label: input.guestSocietyLabel
        ? `Near ${input.guestSocietyLabel}`
        : 'Guest pickup pin',
      lat: guest.lat,
      lng: guest.lng,
      sameSociety: input.sameSociety,
      kind: 'fallback',
      guestWalkMeters: 0,
      hostDetourMeters: 0,
      reason: input.sameSociety
        ? 'Meet at the guest pickup pin from their request.'
        : 'Meet at the guest pickup pin - confirm only if it sits on your road.',
    };
  }

  return null;
}

export function openMapsToMeetSpot(spot: { lat: number; lng: number; label?: string }) {
  const q = encodeURIComponent(spot.label || 'Meet spot');
  const url = `https://www.google.com/maps/dir/?api=1&destination=${spot.lat},${spot.lng}&destination_place_id=&travelmode=driving&dir_action=navigate`;
  // Prefer lat/lng destination; label is informational only.
  const direct = `https://www.google.com/maps/dir/?api=1&destination=${spot.lat},${spot.lng}&travelmode=driving`;
  return { url: direct || url, queryLabel: q };
}
