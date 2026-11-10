export type PerspectiveId = 'priya' | 'arjun';
export type CommuteMode = 'find' | 'offer';
export type VehicleKind = 'two_wheeler' | 'four_wheeler';
export type RideStatus =
  | 'requested'
  | 'confirmed'
  | 'pickup_pending'
  | 'started'
  | 'completed'
  | 'declined'
  | 'cancelled'
  | 'no_show'
  | 'disputed'
  | 'timed_out';

export type OnboardingStep =
  | 'welcome'
  | 'intent'
  | 'email'
  | 'pins'
  | 'schedule'
  | 'done';

export type ProfileSection =
  | 'overview'
  | 'email'
  | 'locations'
  | 'schedule'
  | 'vehicle'
  | 'emergency'
  | 'circles'
  | 'safety'
  | 'notifications'
  | 'settings'
  | 'matrix';

export interface Persona {
  id: PerspectiveId;
  name: string;
  company: string;
  email: string;
  verified: boolean;
  homeLabel: string;
  officeLabel: string;
  leaveTime: string;
  days: string[];
  hasVehicle: boolean;
  vehicleLabel: string;
  seats: number;
  emergencyOk: boolean;
  rating: number;
  ridesDone: number;
}

export interface Offer {
  id: string;
  hostId: PerspectiveId | 'mock';
  hostName: string;
  company: string;
  rating: number;
  ridesDone: number;
  vehicleLabel: string;
  vehicleKind: VehicleKind;
  date: string;
  time: string;
  arriveTime: string;
  durationMin: number;
  direction: 'to_office' | 'to_home';
  seatsOpen: number;
  seatsTotal: number;
  fuelEstimate: number;
  why: string[];
  stops: string[];
  tags: string[];
  corridor: string;
  published: boolean;
  officeVerified: boolean;
  communityVerified: boolean;
  bestFit?: boolean;
  requestable: boolean;
}

export interface ChatMessage {
  id: string;
  from: PerspectiveId;
  text: string;
  at: string;
}

export interface Ride {
  id: string;
  offerId: string;
  guestId: PerspectiveId;
  hostId: PerspectiveId;
  status: RideStatus;
  meetingPoint: string | null;
  otp: string | null;
  otpEntered: string;
  chat: ChatMessage[];
  fuelProposed: number | null;
  fuelAccepted: boolean;
  guestRated: boolean;
  hostRated: boolean;
  shareToken: string | null;
  dropStops: { label: string; done: boolean }[];
}

export interface FindSearch {
  pickup: string;
  dropoff: string;
  date: string;
  leaveTime: string;
  seatsNeeded: number;
  flexible: boolean;
  verifiedOnly: boolean;
  days: string[];
  searched: boolean;
}

export interface OfferDraft {
  pickup: string;
  dropoff: string;
  date: string;
  leaveTime: string;
  seats: number;
  vehicleKind: VehicleKind;
  fuelGuide: number;
  days: string[];
  flexible: boolean;
  stops: string[];
  stopInput: string;
  saved: boolean;
}

export interface ProtoState {
  onboardingComplete: boolean;
  onboardingStep: OnboardingStep;
  preferredMode: CommuteMode;
  perspective: PerspectiveId;
  mode: CommuteMode;
  waitlisted: boolean;
  sheet: string | null;
  offers: Offer[];
  findMatches: Offer[];
  findSearch: FindSearch;
  offerDraft: OfferDraft;
  ride: Ride | null;
  notifications: { id: string; title: string; body: string; read: boolean }[];
  demoHint: string;
}
