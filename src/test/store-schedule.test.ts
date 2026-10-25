import { describe, expect, it } from 'vitest';
import {
  canScheduleWhileClosed,
  closedStoreAcceptDeadlineAt,
  earliestScheduleSlot,
  formatClosedStoreBuyerConfirmCopy,
  formatClosedScheduleMessage,
  formatClosedStoreAddPopupCopy,
  formatClosedStoreAddWhen,
  formatScheduleCta,
  scheduleCtaParts,
  formatScheduleSlotLabel,
  hoursFromCartItems,
  intersectScheduleSlots,
  isHardBlockedStore,
  isValidIntersectedSlot,
  isValidScheduleSlot,
  listScheduleSlots,
  pickValidScheduleSlot,
  slotsForDate,
} from '@/lib/store-schedule';

const hours = {
  availabilityStart: '09:00',
  availabilityEnd: '21:00',
  operatingDays: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'],
  isAvailable: true,
  vacationMode: false,
  prepMinutes: 15,
};

describe('store schedule slots', () => {
  it('uses 9:45 AM as the earliest slot after a 10 PM close (open + 30 min accept + 15 min prep)', () => {
    const now = new Date('2026-10-21T16:30:00.000Z');
    const earliest = earliestScheduleSlot(hours, now);
    expect(earliest?.date).toBe('2026-10-22');
    expect(earliest?.time).toBe('09:45');
    expect(slotsForDate(hours, new Date('2026-10-22T03:30:00.000Z'), now)[0]).toBe('09:45');
    expect(slotsForDate(hours, new Date('2026-10-22T03:30:00.000Z'), now)).not.toContain('09:00');
    expect(slotsForDate(hours, new Date('2026-10-22T03:30:00.000Z'), now)).not.toContain('09:15');
    expect(slotsForDate(hours, new Date('2026-10-22T03:30:00.000Z'), now)).not.toContain('21:00');
  });

  it('uses 10:00 AM when prep is 30 minutes on a future session', () => {
    const now = new Date('2026-10-21T16:30:00.000Z');
    const earliest = earliestScheduleSlot({ ...hours, prepMinutes: 30 }, now);
    expect(earliest?.time).toBe('10:00');
  });

  it('floors prep below 15 minutes to match the server GREATEST(prep, 15)', () => {
    const now = new Date('2026-10-21T16:30:00.000Z');
    const earliest = earliestScheduleSlot({ ...hours, prepMinutes: 5 }, now);
    expect(earliest?.time).toBe('09:45');
  });

  it('does not offer the slot that is exactly now, matching SQL v_slot_ts <= now()', () => {
    const now = new Date('2026-10-22T03:45:00.000Z');
    const slots = listScheduleSlots(hours, now);
    expect(slots[0]?.time).toBe('09:30');
    expect(slots.some((slot) => slot.time === '09:15' && slot.date === '2026-10-22')).toBe(false);
  });

  it('skips a closed operating day instead of assuming tomorrow', () => {
    const now = new Date('2026-10-24T16:30:00.000Z');
    const earliest = earliestScheduleSlot({
      ...hours,
      operatingDays: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'],
    }, now);
    expect(earliest?.date).toBe('2026-10-26');
    expect(earliest?.time).toBe('09:45');
  });

  it('never emits past slots or slots after close', () => {
    const now = new Date('2026-10-21T08:00:00.000Z');
    const slots = listScheduleSlots(hours, now);
    expect(slots.every((slot) => slot.at.getTime() >= now.getTime())).toBe(true);
    expect(slots.some((slot) => slot.time === '21:00' || slot.time === '21:15')).toBe(false);
  });

  it('returns no slots when paused or on vacation', () => {
    const now = new Date('2026-10-21T16:30:00.000Z');
    expect(listScheduleSlots({ ...hours, isAvailable: false }, now)).toEqual([]);
    expect(listScheduleSlots({ ...hours, vacationMode: true }, now)).toEqual([]);
    expect(isHardBlockedStore('closed', true)).toBe(true);
    expect(canScheduleWhileClosed('closed', false)).toBe(true);
    expect(canScheduleWhileClosed('paused', false)).toBe(false);
  });

  it('rejects 2 AM and past timestamps for a 9-9 store', () => {
    const now = new Date('2026-10-21T16:30:00.000Z');
    expect(isValidScheduleSlot(hours, '2026-10-22', '09:45', now)).toBe(true);
    expect(isValidScheduleSlot(hours, '2026-10-22', '09:15', now)).toBe(false);
    expect(isValidScheduleSlot(hours, '2026-10-22', '02:00', now)).toBe(false);
    expect(isValidScheduleSlot(hours, '2026-10-21', '21:30', now)).toBe(false);
    expect(isValidScheduleSlot(hours, null, '09:15', now)).toBe(false);
  });

  it('tells the buyer the store is closed and when it opens', () => {
    const now = new Date('2026-10-21T16:30:00.000Z');
    expect(formatClosedScheduleMessage(hours, now)).toBe(
      'Closed now. Opens tomorrow at 9:00 AM. You can schedule for then.',
    );
    expect(formatScheduleCta(hours, now)).toBe('Schedule for 9:45 AM tomorrow');
    expect(scheduleCtaParts(hours, now)).toEqual({ timeLabel: '9:45 AM', day: 'tomorrow' });
    expect(formatClosedStoreAddWhen(hours, now)).toBe('tomorrow at 9:45 AM');
    expect(formatClosedStoreAddPopupCopy(hours, now)).toEqual({
      title: 'Added - schedule when they open',
      message: 'This store is closed. Keep adding sizes if you want, then pick a time in your cart (from tomorrow at 9:45 AM) to place the order.',
      primaryLabel: 'Pick a time in cart',
      secondaryLabel: 'Keep adding',
    });
    const morning = new Date('2026-10-22T02:30:00.000Z');
    expect(formatScheduleCta(hours, morning)).toBe('Schedule for 9:45 AM');
    expect(scheduleCtaParts(hours, morning)).toEqual({ timeLabel: '9:45 AM', day: 'today' });
    expect(formatClosedStoreAddWhen(hours, morning)).toBe('today at 9:45 AM');
  });

  it('intersects slots across two closed stores', () => {
    const now = new Date('2026-10-21T16:30:00.000Z');
    const shorter = { ...hours, availabilityEnd: '12:00' };
    const slots = intersectScheduleSlots([hours, shorter], now);
    expect(slots[0]?.time).toBe('09:45');
    expect(slots.some((slot) => slot.time === '13:00')).toBe(false);
  });

  it('uses the max prep time from cart items', () => {
    const merged = hoursFromCartItems([
      { product: { prep_time_minutes: 15, seller: { availability_start: '09:00', availability_end: '21:00' } } },
      { product: { prep_time_minutes: 30, seller: { availability_start: '09:00', availability_end: '21:00' } } },
    ]);
    expect(merged.prepMinutes).toBe(30);
  });

  it('ignores leftover lead_time_hours unless the item accepts pre-orders', () => {
    const now = new Date('2026-10-21T16:30:00.000Z');
    const leftoverLead = hoursFromCartItems([
      { product: { lead_time_hours: 24, seller: { availability_start: '09:00', availability_end: '21:00' } } },
    ]);
    expect(leftoverLead.leadMinutes).toBe(0);
    expect(earliestScheduleSlot(leftoverLead, now)?.time).toBe('09:45');

    const preorderLead = hoursFromCartItems([
      { product: { accepts_preorders: true, lead_time_hours: 24, seller: { availability_start: '09:00', availability_end: '21:00' } } },
    ]);
    expect(preorderLead.leadMinutes).toBe(1440);
  });

  it('prefers a later cart item that actually has store hours', () => {
    const merged = hoursFromCartItems([
      { product: { prep_time_minutes: 15 } },
      { product: { prep_time_minutes: 20, seller: { availability_start: '11:00', availability_end: '20:00' } } },
    ]);
    expect(merged.availabilityStart).toBe('11:00');
    expect(merged.availabilityEnd).toBe('20:00');
    expect(merged.prepMinutes).toBe(20);
  });

  it('expires closed-store orders at prep start, never after the promised slot', () => {
    const first = closedStoreAcceptDeadlineAt('11:00', '2026-10-22', '11:45', 15);
    expect(first?.toISOString()).toBe('2026-10-22T06:00:00.000Z');
    const later = closedStoreAcceptDeadlineAt('11:00', '2026-10-22', '14:00', 15);
    expect(later?.toISOString()).toBe('2026-10-22T08:15:00.000Z');
    const overnight = closedStoreAcceptDeadlineAt('22:00', '2026-10-22', '02:00', 15);
    expect(overnight?.toISOString()).toBe('2026-10-21T20:30:00.000Z');
  });

  it('keeps open-session first slots at open + prep without the accept buffer', () => {
    const now = new Date('2026-10-22T03:30:00.000Z');
    const earliest = earliestScheduleSlot(hours, now);
    expect(earliest?.time).toBe('09:15');
  });

  it('puts the accept deadline into the buyer confirm copy', () => {
    expect(formatClosedStoreBuyerConfirmCopy('Thu, 22 Oct, 11:30 am')).toMatch(/11:30 am/);
    expect(formatClosedStoreBuyerConfirmCopy('Thu, 22 Oct, 11:30 am')).toMatch(/when the store opens/);
    expect(formatClosedStoreBuyerConfirmCopy(null)).toMatch(/in time/);
  });

  it('labels a slot for the confirm dialog', () => {
    expect(formatScheduleSlotLabel('2026-10-22', '09:15')).toMatch(/9:15 AM/);
    expect(formatScheduleSlotLabel('2026-10-22', '09:15')).toMatch(/22/);
  });

  it('keeps a valid selected slot and otherwise snaps to the same day or first slot', () => {
    const slots = [
      { date: '2026-10-22', time: '09:45', at: new Date('2026-10-22T04:15:00.000Z') },
      { date: '2026-10-22', time: '10:00', at: new Date('2026-10-22T04:30:00.000Z') },
      { date: '2026-10-23', time: '09:45', at: new Date('2026-10-23T04:15:00.000Z') },
    ];
    expect(pickValidScheduleSlot(slots, '2026-10-22', '10:00')?.time).toBe('10:00');
    expect(pickValidScheduleSlot(slots, '2026-10-22', '08:00')?.time).toBe('09:45');
    expect(pickValidScheduleSlot(slots, null, null)?.time).toBe('09:45');
    expect(pickValidScheduleSlot([], '2026-10-22', '09:45')).toBeNull();
  });

  it('rejects a slot that only one of two stores can serve', () => {
    const now = new Date('2026-10-21T16:30:00.000Z');
    const shorter = { ...hours, availabilityEnd: '12:00' };
    expect(isValidIntersectedSlot([hours, shorter], '2026-10-22', '09:45', now)).toBe(true);
    expect(isValidIntersectedSlot([hours, shorter], '2026-10-22', '13:00', now)).toBe(false);
    expect(isValidIntersectedSlot([], '2026-10-22', '09:15', now)).toBe(false);
  });
});
