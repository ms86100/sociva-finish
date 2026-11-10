/** Dummy corridor rides for Home Find feeling until live search is wired here. */

export type HomeDemoRide = {
  id: string;
  hostName: string;
  company: string;
  stars: number;
  completedRides: number;
  vehicle: string;
  vehicleKind: 'car' | 'bike';
  pickupLabel: string;
  dropLabel: string;
  departTime: string;
  arriveTime: string;
  durationMin: number;
  alongWay: string[];
  fuelShareRs: number;
  seatsOpen: number;
  tags: string[];
  bestOverlap?: boolean;
  overlapPct: number;
  /** Present when card came from live findMatches */
  publicationId?: string | null;
  live?: boolean;
};

export const HOME_DEMO_SEARCH = {
  pickup: 'Koramangala, Beng',
  dropoff: 'Manyata Tech P',
  dateLabel: 'Today',
  leaving: '8:00 AM',
  seats: 1,
};

export const HOME_DEMO_RIDES: HomeDemoRide[] = [
  {
    id: 'demo-ananya',
    hostName: 'Ananya Mehta',
    company: 'Office email',
    stars: 4.9,
    completedRides: 128,
    vehicle: 'Honda City · White',
    vehicleKind: 'car',
    pickupLabel: 'Koramangala',
    dropLabel: 'Manyata Tech Park',
    departTime: '8:15 AM',
    arriveTime: '9:05 AM',
    durationMin: 40,
    alongWay: ['Koramangala', 'Sony Signal', 'MG Road', 'Hebbal', 'Manyata Tech Park'],
    fuelShareRs: 95,
    seatsOpen: 2,
    tags: ['AC', 'Quiet ride'],
    bestOverlap: true,
    overlapPct: 92,
  },
  {
    id: 'demo-vikram',
    hostName: 'Vikram Shah',
    company: 'Office verified',
    stars: 4.7,
    completedRides: 64,
    vehicle: 'Honda Activa · Scooter',
    vehicleKind: 'bike',
    pickupLabel: 'Koramangala',
    dropLabel: 'Manyata Tech Park',
    departTime: '8:05 AM',
    arriveTime: '8:55 AM',
    durationMin: 50,
    alongWay: ['Koramangala', 'Dairy Circle', 'Hebbal', 'Manyata Tech Park'],
    fuelShareRs: 55,
    seatsOpen: 1,
    tags: ['Helmet provided'],
    overlapPct: 78,
  },
  {
    id: 'demo-neha',
    hostName: 'Neha Krishnan',
    company: 'Community profile',
    stars: 5.0,
    completedRides: 41,
    vehicle: 'Hyundai Creta · Grey',
    vehicleKind: 'car',
    pickupLabel: 'Koramangala 5th Block',
    dropLabel: 'Manyata Tech Park',
    departTime: '8:20 AM',
    arriveTime: '9:10 AM',
    durationMin: 45,
    alongWay: ['Koramangala', 'Trinity', 'Hebbal', 'Manyata Tech Park'],
    fuelShareRs: 90,
    seatsOpen: 3,
    tags: ['AC', 'Women preferred'],
    overlapPct: 85,
  },
  {
    id: 'demo-arjun',
    hostName: 'Arjun Rao',
    company: 'Office email',
    stars: 4.6,
    completedRides: 22,
    vehicle: 'Maruti Swift · Blue',
    vehicleKind: 'car',
    pickupLabel: 'Koramangala',
    dropLabel: 'Manyata Outer Ring',
    departTime: '7:55 AM',
    arriveTime: '8:50 AM',
    durationMin: 55,
    alongWay: ['Koramangala', 'Indiranagar', 'Hebbal', 'Manyata'],
    fuelShareRs: 80,
    seatsOpen: 2,
    tags: ['Flexible pickup'],
    overlapPct: 71,
  },
];
