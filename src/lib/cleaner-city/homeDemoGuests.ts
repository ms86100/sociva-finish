/**
 * Seeded guests on the host corridor for Find Guests testing.
 * Not live request inventory - Offer Ride keeps seats open for when they ask.
 */

export type HomeDemoGuest = {
  id: string;
  guestName: string;
  /** Work company from verified company email */
  companyName: string;
  societyOrCompany?: string;
  verified: boolean;
  avatarSeed: string;
  avatarUrl?: string | null;
  wantLeaveTime: string;
  arriveByTime: string;
  walkPickupMeters: number;
  driveMeters: number;
  walkDropMeters: number;
  fuelListRs: number;
  fuelOfferRs: number;
  pickupHint: string;
  dropHint: string;
  tags: string[];
};

type LatLng = { lat: number; lng: number };

export function haversineMeters(a: LatLng, b: LatLng) {
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

function shiftArrive(hhmm: string, driveMeters: number) {
  const mins = Math.max(12, Math.round(driveMeters / 1000 / 0.35));
  return shiftHhmm(hhmm, mins);
}

/** Map a live seat-request ride into the rich guest card model. */
export function rideRequestToGuestCard(
  ride: {
    id: string;
    guest_name?: string | null;
    guest_flat?: string | null;
    guest_society?: string | null;
    guest_avatar_url?: string | null;
    guest_company?: string | null;
    depart_time?: string | null;
    travel_date?: string | null;
    origin_label?: string | null;
    destination_label?: string | null;
    meeting_point_label?: string | null;
    estimated_fuel_paise?: number | null;
    fuel_distance_meters?: number | null;
    guest_pickup_latitude?: number | null;
    guest_pickup_longitude?: number | null;
    guest_dest_latitude?: number | null;
    guest_dest_longitude?: number | null;
  },
  opts?: {
    hostOrigin?: LatLng | null;
    hostDest?: LatLng | null;
    defaultDepart?: string | null;
  },
): HomeDemoGuest {
  const guestName = String(ride.guest_name || 'Neighbour').trim() || 'Neighbour';
  const leave = String(ride.depart_time || opts?.defaultDepart || '08:30').slice(0, 5);
  const guestPickup =
    ride.guest_pickup_latitude != null && ride.guest_pickup_longitude != null
      ? { lat: Number(ride.guest_pickup_latitude), lng: Number(ride.guest_pickup_longitude) }
      : null;
  const guestDest =
    ride.guest_dest_latitude != null && ride.guest_dest_longitude != null
      ? { lat: Number(ride.guest_dest_latitude), lng: Number(ride.guest_dest_longitude) }
      : null;

  const driveMeters =
    Number(ride.fuel_distance_meters) > 0
      ? Math.round(Number(ride.fuel_distance_meters))
      : guestPickup && guestDest
        ? haversineMeters(guestPickup, guestDest)
        : 6500;

  const walkPickupMeters =
    opts?.hostOrigin && guestPickup
      ? Math.max(80, haversineMeters(opts.hostOrigin, guestPickup))
      : 600;
  const walkDropMeters =
    opts?.hostDest && guestDest
      ? Math.max(80, haversineMeters(guestDest, opts.hostDest))
      : 900;

  const fuelOfferRs = Math.max(
    1,
    Math.round(Number(ride.estimated_fuel_paise || driveMeters * 0.6) / 100),
  );
  const fuelListRs = Math.max(1, fuelOfferRs - 5);
  const driveKm = (driveMeters / 1000).toFixed(driveMeters >= 10000 ? 0 : 1);
  const flat = String(ride.guest_flat || '').trim();
  const society = shortPlace(ride.guest_society, '');
  const placeLine = [flat ? `Flat ${flat}` : null, society || null]
    .filter(Boolean)
    .join(' · ');

  return {
    id: ride.id,
    guestName,
    companyName: String(ride.guest_company || '').trim() || 'Verified neighbour',
    societyOrCompany: placeLine || 'Live seat request',
    verified: true,
    avatarSeed: guestName,
    avatarUrl: ride.guest_avatar_url || null,
    wantLeaveTime: leave,
    arriveByTime: shiftArrive(leave, driveMeters),
    walkPickupMeters,
    driveMeters,
    walkDropMeters,
    fuelListRs,
    fuelOfferRs,
    pickupHint:
      ride.meeting_point_label ||
      shortPlace(ride.origin_label, 'Pickup on your road'),
    dropHint: shortPlace(ride.destination_label, 'Drop on your road'),
    tags: [
      'Live request',
      `${driveKm} km shared`,
      walkPickupMeters <= 900 ? 'Pickup on route' : 'Small detour',
    ],
  };
}

function shiftHhmm(hhmm: string, deltaMin: number) {
  const raw = String(hhmm || '08:30').slice(0, 5);
  const [h, m] = raw.split(':').map(Number);
  const total = (((h || 0) * 60 + (m || 0) + deltaMin) % (24 * 60) + 24 * 60) % (24 * 60);
  const nh = Math.floor(total / 60);
  const nm = total % 60;
  return `${String(nh).padStart(2, '0')}:${String(nm).padStart(2, '0')}`;
}

function shortPlace(label: string | null | undefined, fallback: string) {
  const raw = String(label || '').trim();
  if (!raw) return fallback;
  const first = raw.split(',')[0]?.trim() || raw;
  return first.length > 28 ? `${first.slice(0, 26)}…` : first;
}

/** Build several corridor guests around the host leave time and pins. */
export function buildHomeDemoGuests(input: {
  homeLabel?: string | null;
  officeLabel?: string | null;
  direction: 'to_office' | 'to_home';
  leaveTime?: string | null;
}): HomeDemoGuest[] {
  const leave = String(input.leaveTime || '08:30').slice(0, 5);
  const home = shortPlace(input.homeLabel, 'Home');
  const office = shortPlace(input.officeLabel, 'Office');
  const towardOffice = input.direction !== 'to_home';
  const pickup = towardOffice ? home : office;
  const drop = towardOffice ? office : home;

  return [
    {
      id: 'demo-guest-yathish',
      guestName: 'Yathish H',
      companyName: 'Amazon',
      societyOrCompany: 'Amat',
      verified: true,
      avatarSeed: 'yathish',
      wantLeaveTime: shiftHhmm(leave, -15),
      arriveByTime: shiftHhmm(leave, 25),
      walkPickupMeters: 1300,
      driveMeters: 6300,
      walkDropMeters: 1500,
      fuelListRs: 30,
      fuelOfferRs: 37,
      pickupHint: `Near ${pickup}`,
      dropHint: `Near ${drop}`,
      tags: ['Pickup on route', 'Small walk'],
    },
    {
      id: 'demo-guest-meera',
      guestName: 'Meera Iyer',
      companyName: 'Flipkart',
      societyOrCompany: 'Greenfield',
      verified: true,
      avatarSeed: 'meera',
      wantLeaveTime: shiftHhmm(leave, 5),
      arriveByTime: shiftHhmm(leave, 40),
      walkPickupMeters: 450,
      driveMeters: 7100,
      walkDropMeters: 900,
      fuelListRs: 42,
      fuelOfferRs: 48,
      pickupHint: `Tower side · ${pickup}`,
      dropHint: drop,
      tags: ['Closest pickup', 'Same society'],
    },
    {
      id: 'demo-guest-rahul',
      guestName: 'Rahul Desai',
      companyName: 'Swiggy',
      societyOrCompany: 'Tower H',
      verified: true,
      avatarSeed: 'rahul',
      wantLeaveTime: shiftHhmm(leave, 10),
      arriveByTime: shiftHhmm(leave, 45),
      walkPickupMeters: 800,
      driveMeters: 5800,
      walkDropMeters: 1200,
      fuelListRs: 28,
      fuelOfferRs: 34,
      pickupHint: pickup,
      dropHint: `Gate · ${drop}`,
      tags: ['Fits your road', 'Flexible time'],
    },
    {
      id: 'demo-guest-sana',
      guestName: 'Sana Khan',
      companyName: 'Infosys',
      societyOrCompany: 'Phase-2',
      verified: true,
      avatarSeed: 'sana',
      wantLeaveTime: shiftHhmm(leave, -5),
      arriveByTime: shiftHhmm(leave, 35),
      walkPickupMeters: 1600,
      driveMeters: 6900,
      walkDropMeters: 700,
      fuelListRs: 35,
      fuelOfferRs: 41,
      pickupHint: `Along way to ${drop}`,
      dropHint: drop,
      tags: ['Mid-route drop', 'Quiet rider'],
    },
  ];
}

const OFFERED_KEY = 'cleaner-city-host-demo-offers-v1';

export function loadDemoGuestOffers(): string[] {
  try {
    const raw = sessionStorage.getItem(OFFERED_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.map(String) : [];
  } catch {
    return [];
  }
}

export function markDemoGuestOffered(guestId: string) {
  const next = Array.from(new Set([...loadDemoGuestOffers(), guestId])).slice(0, 24);
  try {
    sessionStorage.setItem(OFFERED_KEY, JSON.stringify(next));
  } catch {
    /* ignore */
  }
  return next;
}
