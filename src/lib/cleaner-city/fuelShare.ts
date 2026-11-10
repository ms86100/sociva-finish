/**
 * Admin-controlled automatic fuel-sharing engine (client mirror of Postgres).
 * Host/guest never enter amounts. Mileage is a system constant (10 km/L).
 * All money in integer paise.
 */

export const FUEL_MILEAGE_KM_PER_LITRE = 10;
export const FUEL_DEFAULT_PETROL_PAISE_PER_LITRE = 12000; // ₹120
export const FUEL_CALC_VERSION = 1;

export type FuelSegmentTraveler = {
  id: string;
  /** Inclusive start along route, meters from origin */
  startMeters: number;
  /** Exclusive end along route, meters from origin */
  endMeters: number;
};

export type FuelShareAllocation = {
  petrolPaisePerLitre: number;
  mileageKmPerLitre: number;
  distanceMeters: number;
  fuelPaisePerKm: number;
  consumptionMl: number;
  totalFuelPaise: number;
  hostSharePaise: number;
  guestShares: Record<string, number>;
  segments: Array<{
    startMeters: number;
    endMeters: number;
    participantIds: string[];
    fuelPaise: number;
    sharePaise: number;
  }>;
  calcVersion: number;
};

function assertPositive(n: number, label: string) {
  if (!Number.isFinite(n) || n <= 0) {
    throw new Error(`Invalid ${label}`);
  }
}

/** Petrol paise / mileage km per litre = paise per km */
export function fuelPaisePerKm(
  petrolPaisePerLitre: number,
  mileageKmPerLitre = FUEL_MILEAGE_KM_PER_LITRE,
): number {
  assertPositive(petrolPaisePerLitre, 'petrol price');
  assertPositive(mileageKmPerLitre, 'mileage');
  return Math.round(petrolPaisePerLitre / mileageKmPerLitre);
}

/**
 * Equal split when everyone rides the full route.
 * host + guests share total fuel cost equally.
 */
export function equalRouteFuelShare(input: {
  distanceMeters: number;
  petrolPaisePerLitre: number;
  guestIds: string[];
  mileageKmPerLitre?: number;
}): FuelShareAllocation {
  const mileage = input.mileageKmPerLitre ?? FUEL_MILEAGE_KM_PER_LITRE;
  assertPositive(input.distanceMeters, 'distance');
  assertPositive(input.petrolPaisePerLitre, 'petrol price');

  const perKm = fuelPaisePerKm(input.petrolPaisePerLitre, mileage);
  const km = input.distanceMeters / 1000;
  const totalFuelPaise = Math.round(km * perKm);
  const consumptionMl = Math.round((km / mileage) * 1000);
  const participants = 1 + input.guestIds.length;
  if (participants < 1) throw new Error('Invalid participant count');

  const base = Math.floor(totalFuelPaise / participants);
  let remainder = totalFuelPaise - base * participants;

  const guestShares: Record<string, number> = {};
  // Host gets first remainder paise, then guests in stable id order
  let hostShare = base + (remainder > 0 ? 1 : 0);
  if (remainder > 0) remainder -= 1;

  const sortedGuests = [...input.guestIds].sort();
  for (const id of sortedGuests) {
    const extra = remainder > 0 ? 1 : 0;
    if (remainder > 0) remainder -= 1;
    guestShares[id] = base + extra;
  }

  return {
    petrolPaisePerLitre: input.petrolPaisePerLitre,
    mileageKmPerLitre: mileage,
    distanceMeters: input.distanceMeters,
    fuelPaisePerKm: perKm,
    consumptionMl,
    totalFuelPaise,
    hostSharePaise: hostShare,
    guestShares,
    segments: [
      {
        startMeters: 0,
        endMeters: input.distanceMeters,
        participantIds: ['host', ...sortedGuests],
        fuelPaise: totalFuelPaise,
        sharePaise: base,
      },
    ],
    calcVersion: FUEL_CALC_VERSION,
  };
}

/**
 * Segment-based allocation for different pickup/drop points.
 * Host always travels 0..distanceMeters. Guests travel [start, end).
 */
export function segmentFuelShare(input: {
  distanceMeters: number;
  petrolPaisePerLitre: number;
  guests: FuelSegmentTraveler[];
  mileageKmPerLitre?: number;
}): FuelShareAllocation {
  const mileage = input.mileageKmPerLitre ?? FUEL_MILEAGE_KM_PER_LITRE;
  assertPositive(input.distanceMeters, 'distance');
  assertPositive(input.petrolPaisePerLitre, 'petrol price');

  const perKm = fuelPaisePerKm(input.petrolPaisePerLitre, mileage);
  const totalMeters = input.distanceMeters;
  const bounds = new Set<number>([0, totalMeters]);
  for (const g of input.guests) {
    const start = Math.max(0, Math.min(totalMeters, g.startMeters));
    const end = Math.max(0, Math.min(totalMeters, g.endMeters));
    if (end <= start) continue;
    bounds.add(start);
    bounds.add(end);
  }
  const cuts = Array.from(bounds).sort((a, b) => a - b);

  const hostShareByGuest: Record<string, number> = {};
  for (const g of input.guests) hostShareByGuest[g.id] = 0;
  let hostTotal = 0;
  const segments: FuelShareAllocation['segments'] = [];

  for (let i = 0; i < cuts.length - 1; i++) {
    const a = cuts[i];
    const b = cuts[i + 1];
    if (b <= a) continue;
    const segMeters = b - a;
    const segPaise = Math.round((segMeters / 1000) * perKm);
    const onSeg = ['host'];
    for (const g of input.guests) {
      const start = Math.max(0, Math.min(totalMeters, g.startMeters));
      const end = Math.max(0, Math.min(totalMeters, g.endMeters));
      if (start < b && end > a) onSeg.push(g.id);
    }
    const n = onSeg.length;
    const base = Math.floor(segPaise / n);
    let rem = segPaise - base * n;
    // Remainder to host first for determinism
    const shares: Record<string, number> = {};
    for (const id of onSeg) {
      const extra = rem > 0 ? 1 : 0;
      if (rem > 0) rem -= 1;
      shares[id] = base + extra;
    }
    hostTotal += shares.host || 0;
    for (const g of input.guests) {
      if (shares[g.id] != null) hostShareByGuest[g.id] += shares[g.id];
    }
    segments.push({
      startMeters: a,
      endMeters: b,
      participantIds: onSeg,
      fuelPaise: segPaise,
      sharePaise: base,
    });
  }

  const totalFuelPaise = segments.reduce((s, seg) => s + seg.fuelPaise, 0);
  const km = totalMeters / 1000;
  const guestShares: Record<string, number> = {};
  for (const g of input.guests) guestShares[g.id] = hostShareByGuest[g.id] || 0;

  // Fix any 1-paise drift so sum equals total
  const allocated =
    hostTotal + Object.values(guestShares).reduce((s, v) => s + v, 0);
  if (allocated !== totalFuelPaise) {
    hostTotal += totalFuelPaise - allocated;
  }

  return {
    petrolPaisePerLitre: input.petrolPaisePerLitre,
    mileageKmPerLitre: mileage,
    distanceMeters: totalMeters,
    fuelPaisePerKm: perKm,
    consumptionMl: Math.round((km / mileage) * 1000),
    totalFuelPaise,
    hostSharePaise: hostTotal,
    guestShares,
    segments,
    calcVersion: FUEL_CALC_VERSION,
  };
}

/** Guest preview share for match cards: equal split with host + seats open as capacity hint */
export function estimateGuestSharePaise(input: {
  distanceMeters: number;
  petrolPaisePerLitre: number;
  /** seats_total on publication (host + all seats) */
  seatsTotal: number;
}): number | null {
  if (!input.distanceMeters || input.distanceMeters <= 0) return null;
  if (!input.petrolPaisePerLitre || input.petrolPaisePerLitre <= 0) return null;
  const participants = Math.max(2, input.seatsTotal || 2);
  const alloc = equalRouteFuelShare({
    distanceMeters: input.distanceMeters,
    petrolPaisePerLitre: input.petrolPaisePerLitre,
    guestIds: Array.from({ length: participants - 1 }, (_, i) => `seat-${i}`),
  });
  return alloc.guestShares['seat-0'] ?? Math.floor(alloc.totalFuelPaise / participants);
}

export function formatFuelRupeesFromPaise(paise?: number | null): number | null {
  if (paise == null || !Number.isFinite(paise)) return null;
  return Math.max(1, Math.round(paise / 100));
}
