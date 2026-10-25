import type { StoreStatus } from '@/lib/store-availability';

/** Cart/shop scheduled orders use IST, matching store hours. */
export const SCHEDULE_TZ_OFFSET_MS = (5 * 60 + 30) * 60 * 1000;
export const SLOT_INTERVAL_MINUTES = 15;
export const DEFAULT_SCHEDULE_PREP_MINUTES = 15;
export const MAX_SCHEDULE_DAYS = 14;
/** Extra accept window after opening so the first slot is cookable. */
export const CLOSED_STORE_ACCEPT_BUFFER_MINUTES = 30;

export const CLOSED_STORE_BUYER_CONFIRM_COPY =
  'The seller confirms when the store opens. If they don\'t accept in time, this order is cancelled.';

export const CLOSED_STORE_SELLER_ACCEPT_COPY =
  'Accept after you open. If you don\'t accept in time, this order is cancelled.';

export const VACATION_BUYER_CTA = 'On a break';

export const OPEN_STORE_SCHEDULE_ACCEPT_COPY =
  'The seller must accept this order. If they don\'t accept in time, it is cancelled.';

export function formatIstDeadline(at: Date): string {
  return at.toLocaleString('en-IN', {
    timeZone: 'Asia/Kolkata',
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  });
}

export function formatClosedStoreBuyerConfirmCopy(deadlineLabel?: string | null): string {
  if (!deadlineLabel) return CLOSED_STORE_BUYER_CONFIRM_COPY;
  return `The seller confirms when the store opens. If they don't accept by ${deadlineLabel}, this order is cancelled.`;
}

export function formatClosedStoreSellerAcceptCopy(deadlineLabel?: string | null): string {
  if (!deadlineLabel) return CLOSED_STORE_SELLER_ACCEPT_COPY;
  return `Accept after you open. If you don't accept by ${deadlineLabel}, this order is cancelled.`;
}

export function formatOpenStoreScheduleAcceptCopy(deadlineLabel?: string | null): string {
  if (!deadlineLabel) return OPEN_STORE_SCHEDULE_ACCEPT_COPY;
  return `The seller must accept this order. If they don't accept by ${deadlineLabel}, it is cancelled.`;
}

const DAY_ABBREVS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export type StoreHoursInput = {
  availabilityStart?: string | null;
  availabilityEnd?: string | null;
  operatingDays?: string[] | null;
  isAvailable?: boolean | null;
  vacationMode?: boolean | null;
  prepMinutes?: number | null;
  /** Extra advance notice (pre-order lead), in minutes. */
  leadMinutes?: number | null;
};

export type ScheduleSlot = {
  date: string;
  time: string;
  at: Date;
};

function operatingDayMatches(operatingDays: string[] | null | undefined, currentDay: string): boolean {
  if (!operatingDays || operatingDays.length === 0) return true;
  const needle = currentDay.slice(0, 3).toLowerCase();
  const dayIdx = DAY_ABBREVS.findIndex((d) => d.toLowerCase() === needle);
  return operatingDays.some((d) => {
    const s = String(d ?? '').trim();
    if (!s) return false;
    if (s.slice(0, 3).toLowerCase() === needle) return true;
    if (/^\d+$/.test(s) && Number(s) === dayIdx) return true;
    return false;
  });
}

function parseHm(raw: string | null | undefined): number | null {
  if (!raw) return null;
  const parts = String(raw).trim().split(':');
  if (parts.length < 2) return null;
  const h = Number(parts[0]);
  const m = Number(parts[1]);
  if (!Number.isFinite(h) || !Number.isFinite(m)) return null;
  return h * 60 + m;
}

function sessionBounds(startRaw: string | null | undefined, endRaw: string | null | undefined) {
  const startM = parseHm(startRaw);
  const rawEnd = parseHm(endRaw);
  if (startM == null || rawEnd == null) {
    return { startM: 0, endM: 1440, overnight: false, configured: false };
  }
  const endM = rawEnd === 0 ? 1440 : rawEnd;
  return { startM, endM, overnight: endM <= startM, configured: true };
}

export function istWall(now: Date) {
  const ist = new Date(now.getTime() + SCHEDULE_TZ_OFFSET_MS);
  return {
    year: ist.getUTCFullYear(),
    month: ist.getUTCMonth(),
    date: ist.getUTCDate(),
    day: ist.getUTCDay(),
    hours: ist.getUTCHours(),
    minutes: ist.getUTCMinutes(),
    minutesOfDay: ist.getUTCHours() * 60 + ist.getUTCMinutes(),
  };
}

export function fromIstWall(year: number, month: number, date: number, minutesOfDay: number): Date {
  return new Date(Date.UTC(year, month, date, 0, minutesOfDay) - SCHEDULE_TZ_OFFSET_MS);
}

function addIstDays(year: number, month: number, date: number, days: number) {
  const utc = Date.UTC(year, month, date + days);
  const d = new Date(utc);
  return { year: d.getUTCFullYear(), month: d.getUTCMonth(), date: d.getUTCDate(), day: d.getUTCDay() };
}

function ymd(year: number, month: number, date: number): string {
  return `${year}-${String(month + 1).padStart(2, '0')}-${String(date).padStart(2, '0')}`;
}

export function formatMinutes12h(minutesOfDay: number): string {
  const wrapped = ((minutesOfDay % 1440) + 1440) % 1440;
  const h = Math.floor(wrapped / 60);
  const m = wrapped % 60;
  const period = h >= 12 ? 'PM' : 'AM';
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${String(m).padStart(2, '0')} ${period}`;
}

export function ceilToSlot(minutesOfDay: number, interval = SLOT_INTERVAL_MINUTES): number {
  if (minutesOfDay <= 0) return 0;
  return Math.ceil(minutesOfDay / interval) * interval;
}

export function resolvedPrepMinutes(input: StoreHoursInput): number {
  const prep = Number(input.prepMinutes);
  if (Number.isFinite(prep) && prep > 0) {
    return Math.max(DEFAULT_SCHEDULE_PREP_MINUTES, Math.round(prep));
  }
  return DEFAULT_SCHEDULE_PREP_MINUTES;
}

export function resolvedLeadMinutes(input: StoreHoursInput): number {
  const lead = Number(input.leadMinutes);
  if (Number.isFinite(lead) && lead > 0) return Math.round(lead);
  return 0;
}

export function isHardBlockedStore(status: StoreStatus | string, vacationMode?: boolean | null): boolean {
  if (vacationMode) return true;
  return status === 'paused';
}

export function canScheduleWhileClosed(status: StoreStatus | string, vacationMode?: boolean | null): boolean {
  if (isHardBlockedStore(status, vacationMode)) return false;
  return status === 'closed' || status === 'closed_today';
}

function isOperatingOn(input: StoreHoursInput, day: number): boolean {
  return operatingDayMatches(input.operatingDays, DAY_ABBREVS[day]);
}

/**
 * Eligible 15-minute slots for the next operating sessions.
 * Earliest slot of a session is opening time + prep, rounded up to the interval.
 */
export function listScheduleSlots(input: StoreHoursInput, now = new Date()): ScheduleSlot[] {
  if (input.isAvailable === false || input.vacationMode) return [];
  const prep = resolvedPrepMinutes(input);
  const lead = resolvedLeadMinutes(input);
  const minAt = new Date(now.getTime() + lead * 60 * 1000);
  const { startM, endM, overnight } = sessionBounds(input.availabilityStart, input.availabilityEnd);
  const wall = istWall(now);
  const slots: ScheduleSlot[] = [];

  for (let offset = 0; offset < MAX_SCHEDULE_DAYS; offset += 1) {
    const day = addIstDays(wall.year, wall.month, wall.date, offset);
    if (!isOperatingOn(input, day.day)) continue;

    const sessionStart = fromIstWall(day.year, day.month, day.date, startM);
    const sessionEnd = overnight
      ? fromIstWall(day.year, day.month, day.date, startM + (1440 - startM) + endM)
      : fromIstWall(day.year, day.month, day.date, endM);
    // Future sessions add an accept buffer so the first slot is cookable
    // after the seller opens. Already-open sessions keep open + prep.
    const acceptBuffer = sessionStart.getTime() > now.getTime() ? CLOSED_STORE_ACCEPT_BUFFER_MINUTES : 0;
    const earliest = new Date(sessionStart.getTime() + (prep + acceptBuffer) * 60 * 1000);
    let cursor = earliest.getTime();
    if (cursor < minAt.getTime()) cursor = minAt.getTime();

    const cursorWall = istWall(new Date(cursor));
    let minutes = ceilToSlot(cursorWall.minutesOfDay);
    let cursorDate = { year: cursorWall.year, month: cursorWall.month, date: cursorWall.date };
    if (minutes >= 1440) {
      minutes -= 1440;
      cursorDate = addIstDays(cursorDate.year, cursorDate.month, cursorDate.date, 1);
    }

    while (true) {
      const at = fromIstWall(cursorDate.year, cursorDate.month, cursorDate.date, minutes);
      if (at.getTime() >= sessionEnd.getTime()) break;
      // Exclusive of now/lead so the client never offers a slot the SQL
      // `v_slot_ts <= now() + lead` check will reject.
      if (at.getTime() > minAt.getTime() && at.getTime() >= earliest.getTime()) {
        slots.push({
          date: ymd(cursorDate.year, cursorDate.month, cursorDate.date),
          time: `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`,
          at,
        });
      }
      minutes += SLOT_INTERVAL_MINUTES;
      if (minutes >= 1440) {
        minutes -= 1440;
        cursorDate = addIstDays(cursorDate.year, cursorDate.month, cursorDate.date, 1);
      }
      if (slots.length > 400) break;
    }
  }
  return slots;
}

export function earliestScheduleSlot(input: StoreHoursInput, now = new Date()): ScheduleSlot | null {
  return listScheduleSlots(input, now)[0] ?? null;
}

export function slotsForDate(input: StoreHoursInput, date: Date, now = new Date()): string[] {
  const wall = istWall(date);
  const key = ymd(wall.year, wall.month, wall.date);
  return listScheduleSlots(input, now).filter((slot) => slot.date === key).map((slot) => slot.time);
}

export function eligibleScheduleDates(input: StoreHoursInput, now = new Date()): Date[] {
  const seen = new Set<string>();
  const dates: Date[] = [];
  for (const slot of listScheduleSlots(input, now)) {
    if (seen.has(slot.date)) continue;
    seen.add(slot.date);
    const [y, m, d] = slot.date.split('-').map(Number);
    dates.push(fromIstWall(y, m - 1, d, 12 * 60));
  }
  return dates;
}

export function isValidScheduleSlot(
  input: StoreHoursInput,
  dateStr: string | null | undefined,
  timeStr: string | null | undefined,
  now = new Date(),
): boolean {
  if (!dateStr || !timeStr) return false;
  const time = timeStr.slice(0, 5);
  return listScheduleSlots(input, now).some((slot) => slot.date === dateStr && slot.time === time);
}

export function isValidIntersectedSlot(
  inputs: StoreHoursInput[],
  dateStr: string | null | undefined,
  timeStr: string | null | undefined,
  now = new Date(),
): boolean {
  if (!dateStr || !timeStr || inputs.length === 0) return false;
  if (inputs.length === 1) return isValidScheduleSlot(inputs[0], dateStr, timeStr, now);
  const time = timeStr.slice(0, 5);
  return intersectScheduleSlots(inputs, now).some((slot) => slot.date === dateStr && slot.time === time);
}

/** Keep cart schedule state on a valid slot instead of null <-> first-slot ping-pong. */
export function pickValidScheduleSlot(
  slots: ScheduleSlot[],
  selectedDate: string | null | undefined,
  selectedTime: string | null | undefined,
): ScheduleSlot | null {
  if (slots.length === 0) return null;
  const time = selectedTime?.slice(0, 5) || null;
  if (selectedDate && time) {
    const current = slots.find((slot) => slot.date === selectedDate && slot.time === time);
    if (current) return current;
  }
  if (selectedDate) {
    const sameDay = slots.find((slot) => slot.date === selectedDate);
    if (sameDay) return sameDay;
  }
  return slots[0];
}

/** Buyer/seller glance: "Thu, 22 Oct at 9:15 AM" */
export function formatScheduleSlotLabel(dateStr: string | null | undefined, timeStr: string | null | undefined): string {
  if (!dateStr || !timeStr) return '';
  const [y, m, d] = dateStr.split('-').map(Number);
  const mins = Number(timeStr.slice(0, 2)) * 60 + Number(timeStr.slice(3, 5) || 0);
  if (!Number.isFinite(y) || !Number.isFinite(m) || !Number.isFinite(d) || !Number.isFinite(mins)) return '';
  const at = fromIstWall(y, m - 1, d, 12 * 60);
  const day = at.toLocaleDateString('en-IN', {
    timeZone: 'Asia/Kolkata',
    weekday: 'short',
    day: 'numeric',
    month: 'short',
  });
  return `${day} at ${formatMinutes12h(mins)}`;
}

/**
 * Closed-store accept deadline: preparation start (slot minus prep), never
 * after the promised slot, never before store open. Overnight / after-midnight
 * slots (clock before open) keep the slot instant.
 */
export function closedStoreAcceptDeadlineAt(
  availabilityStart: string | null | undefined,
  dateStr: string,
  timeStr: string,
  prepMinutes?: number | null,
): Date | null {
  const [y, m, d] = dateStr.split('-').map(Number);
  const slotMins = Number(timeStr.slice(0, 2)) * 60 + Number(timeStr.slice(3, 5) || 0);
  if (!Number.isFinite(y) || !Number.isFinite(m) || !Number.isFinite(d) || !Number.isFinite(slotMins)) {
    return null;
  }
  const slotAt = fromIstWall(y, m - 1, d, slotMins);
  const startM = parseHm(availabilityStart);
  if (startM == null || slotMins < startM) return slotAt;
  const prep = resolvedPrepMinutes({ prepMinutes });
  const prepStart = new Date(slotAt.getTime() - prep * 60 * 1000);
  const openAt = fromIstWall(y, m - 1, d, startM);
  const acceptAt = prepStart.getTime() > openAt.getTime() ? prepStart : openAt;
  return acceptAt.getTime() < slotAt.getTime() ? acceptAt : slotAt;
}

export function intersectScheduleSlots(inputs: StoreHoursInput[], now = new Date()): ScheduleSlot[] {
  if (!inputs.length) return [];
  const first = listScheduleSlots(inputs[0], now);
  if (inputs.length === 1) return first;
  return first.filter((slot) =>
    inputs.slice(1).every((hours) => isValidScheduleSlot(hours, slot.date, slot.time, now)),
  );
}

export function formatClosedScheduleMessage(input: StoreHoursInput, now = new Date()): string {
  if (input.vacationMode) {
    return 'This store is on a break. Scheduling is unavailable until it reopens.';
  }
  if (input.isAvailable === false) {
    return 'This store is currently paused. Scheduling is unavailable.';
  }
  const earliest = earliestScheduleSlot(input, now);
  if (!earliest) {
    return 'This store is closed and has no upcoming hours to schedule.';
  }
  const openMins = parseHm(input.availabilityStart) ?? parseHm(earliest.time) ?? 9 * 60;
  const openLabel = formatMinutes12h(openMins);
  const wallNow = istWall(now);
  const todayKey = ymd(wallNow.year, wallNow.month, wallNow.date);
  const tomorrow = addIstDays(wallNow.year, wallNow.month, wallNow.date, 1);
  const tomorrowKey = ymd(tomorrow.year, tomorrow.month, tomorrow.date);
  const when = earliest.date === todayKey
    ? `at ${openLabel}`
    : earliest.date === tomorrowKey
      ? `tomorrow at ${openLabel}`
      : `${earliest.date} at ${openLabel}`;
  return `Closed now. Opens ${when}. You can schedule for then.`;
}

export type ScheduleCtaDay = 'today' | 'tomorrow' | null;

export function scheduleCtaParts(input: StoreHoursInput, now = new Date()): {
  timeLabel: string;
  day: ScheduleCtaDay;
} {
  const earliest = earliestScheduleSlot(input, now);
  if (!earliest) return { timeLabel: '', day: null };
  const mins = Number(earliest.time.slice(0, 2)) * 60 + Number(earliest.time.slice(3, 5));
  const timeLabel = formatMinutes12h(mins);
  const wallNow = istWall(now);
  const todayKey = ymd(wallNow.year, wallNow.month, wallNow.date);
  if (earliest.date === todayKey) return { timeLabel, day: 'today' };
  const tomorrow = addIstDays(wallNow.year, wallNow.month, wallNow.date, 1);
  const tomorrowKey = ymd(tomorrow.year, tomorrow.month, tomorrow.date);
  if (earliest.date === tomorrowKey) return { timeLabel, day: 'tomorrow' };
  return { timeLabel, day: null };
}

export function formatScheduleCta(input: StoreHoursInput, now = new Date()): string {
  const { timeLabel, day } = scheduleCtaParts(input, now);
  if (!timeLabel) return 'Schedule';
  if (day === 'tomorrow') return `Schedule for ${timeLabel} tomorrow`;
  return `Schedule for ${timeLabel}`;
}

export function formatClosedStoreAddWhen(input: StoreHoursInput, now = new Date()): string {
  const { timeLabel, day } = scheduleCtaParts(input, now);
  if (timeLabel && day === 'tomorrow') return `tomorrow at ${timeLabel}`;
  if (timeLabel && day === 'today') return `today at ${timeLabel}`;
  if (timeLabel) return timeLabel;
  return 'the next available time';
}

export function formatClosedStoreAddPopupCopy(input: StoreHoursInput, now = new Date()): {
  title: string;
  message: string;
  primaryLabel: string;
  secondaryLabel: string;
} {
  const when = formatClosedStoreAddWhen(input, now);
  return {
    title: 'Added - schedule when they open',
    message: `This store is closed. Keep adding sizes if you want, then pick a time in your cart (from ${when}) to place the order.`,
    primaryLabel: 'Pick a time in cart',
    secondaryLabel: 'Keep adding',
  };
}

export function scheduleHoursFromProduct(product: {
  seller_availability_start?: string | null;
  seller_availability_end?: string | null;
  seller_operating_days?: string[] | null;
  seller_is_available?: boolean | null;
  seller_vacation_mode?: boolean | null;
  prep_time_minutes?: number | null;
  lead_time_hours?: number | null;
  seller?: {
    availability_start?: string | null;
    availability_end?: string | null;
    operating_days?: string[] | null;
    is_available?: boolean | null;
    vacation_mode?: boolean | null;
  } | null;
} | null | undefined): StoreHoursInput {
  const p = product as any;
  const seller = p?.seller;
  const leadHours = Number(p?.lead_time_hours);
  const acceptsPreorders = p?.accepts_preorders === true;
  return {
    availabilityStart: p?.seller_availability_start ?? seller?.availability_start ?? null,
    availabilityEnd: p?.seller_availability_end ?? seller?.availability_end ?? null,
    operatingDays: p?.seller_operating_days ?? seller?.operating_days ?? null,
    isAvailable: p?.seller_is_available ?? seller?.is_available ?? true,
    vacationMode: p?.seller_vacation_mode ?? seller?.vacation_mode ?? false,
    prepMinutes: p?.prep_time_minutes ?? null,
    leadMinutes: acceptsPreorders && Number.isFinite(leadHours) && leadHours > 0
      ? Math.round(leadHours * 60)
      : 0,
  };
}

export function hoursFromCartItems(items: Array<{ product?: any } | null | undefined>): StoreHoursInput {
  const products = items.map((item) => item?.product).filter(Boolean);
  if (products.length === 0) {
    return { prepMinutes: DEFAULT_SCHEDULE_PREP_MINUTES };
  }
  let chosen = scheduleHoursFromProduct(products[0]);
  let prep = resolvedPrepMinutes(chosen);
  let lead = resolvedLeadMinutes(chosen);
  for (const product of products) {
    const hours = scheduleHoursFromProduct(product);
    const chosenHasHours = !!(chosen.availabilityStart && chosen.availabilityEnd);
    const hoursHasHours = !!(hours.availabilityStart && hours.availabilityEnd);
    if (!chosenHasHours && hoursHasHours) {
      chosen = {
        ...chosen,
        availabilityStart: hours.availabilityStart,
        availabilityEnd: hours.availabilityEnd,
        operatingDays: hours.operatingDays ?? chosen.operatingDays,
      };
    }
    if (hours.vacationMode) chosen.vacationMode = true;
    if (hours.isAvailable === false) chosen.isAvailable = false;
    prep = Math.max(prep, resolvedPrepMinutes(hours));
    lead = Math.max(lead, resolvedLeadMinutes(hours));
  }
  return { ...chosen, prepMinutes: prep, leadMinutes: lead };
}
