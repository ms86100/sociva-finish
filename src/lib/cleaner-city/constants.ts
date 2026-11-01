export const CLEANER_CITY_ROLES = [
  { value: 'host', label: 'Host', hint: 'I can offer seats' },
  { value: 'guest', label: 'Guest', hint: 'I need a commute' },
  { value: 'both', label: 'Both', hint: 'Offer and find rides' },
] as const;

export const CLEANER_CITY_TRANSPORT = [
  { value: 'car', label: 'Car' },
  { value: 'bike', label: 'Bike' },
  { value: 'looking', label: 'Looking for a ride' },
] as const;

export const WORK_EMAIL_BADGE = 'Work email verified';

/** Matches Postgres EXTRACT(DOW): 0 Sunday ... 6 Saturday */
export const CLEANER_CITY_WEEKDAYS = [
  { value: 1, label: 'Mon', full: 'Monday' },
  { value: 2, label: 'Tue', full: 'Tuesday' },
  { value: 3, label: 'Wed', full: 'Wednesday' },
  { value: 4, label: 'Thu', full: 'Thursday' },
  { value: 5, label: 'Fri', full: 'Friday' },
  { value: 6, label: 'Sat', full: 'Saturday' },
  { value: 0, label: 'Sun', full: 'Sunday' },
] as const;

export const CLEANER_CITY_OVERRIDE_KINDS = [
  { value: 'time_change', label: 'Different time' },
  { value: 'wfh', label: 'Working from home' },
  { value: 'leave', label: 'Leave' },
  { value: 'holiday', label: 'Holiday' },
  { value: 'custom', label: 'Custom' },
] as const;

export const DEFAULT_COMMUTE_TIMEZONE = 'Asia/Kolkata';

export const CLEANER_CITY_VEHICLE_TYPES = [
  { value: 'car', label: 'Car', maxSeats: 8 },
  { value: 'bike', label: 'Bike', maxSeats: 1 },
] as const;

export const CLEANER_CITY_DOCUMENT_TYPES = [
  { value: 'registration', label: 'Registration' },
  { value: 'insurance', label: 'Insurance' },
  { value: 'licence', label: 'Driving licence' },
  { value: 'other', label: 'Other' },
] as const;

export const CLEANER_CITY_DIRECTIONS = [
  { value: 'to_office', label: 'To office' },
  { value: 'to_home', label: 'To home' },
] as const;
