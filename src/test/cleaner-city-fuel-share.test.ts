import { describe, expect, it } from 'vitest';
import {
  equalRouteFuelShare,
  fuelPaisePerKm,
  segmentFuelShare,
  FUEL_DEFAULT_PETROL_PAISE_PER_LITRE,
} from '@/lib/cleaner-city/fuelShare';

describe('Cleaner City fuel-sharing engine', () => {
  it('computes ₹12/km at ₹120/L and 10 km/L', () => {
    expect(fuelPaisePerKm(12000)).toBe(1200);
  });

  it('equal split: 20 km, ₹120, host + 2 guests = ₹80 each', () => {
    const alloc = equalRouteFuelShare({
      distanceMeters: 20000,
      petrolPaisePerLitre: FUEL_DEFAULT_PETROL_PAISE_PER_LITRE,
      guestIds: ['a', 'b'],
    });
    expect(alloc.totalFuelPaise).toBe(24000);
    expect(alloc.hostSharePaise).toBe(8000);
    expect(alloc.guestShares.a).toBe(8000);
    expect(alloc.guestShares.b).toBe(8000);
    expect(
      alloc.hostSharePaise + alloc.guestShares.a + alloc.guestShares.b,
    ).toBe(alloc.totalFuelPaise);
  });

  it('segment split: Guest A 0-15, Guest B 10-20', () => {
    const alloc = segmentFuelShare({
      distanceMeters: 20000,
      petrolPaisePerLitre: 12000,
      guests: [
        { id: 'a', startMeters: 0, endMeters: 15000 },
        { id: 'b', startMeters: 10000, endMeters: 20000 },
      ],
    });
    expect(alloc.totalFuelPaise).toBe(24000);
    expect(alloc.hostSharePaise).toBe(11000);
    expect(alloc.guestShares.a).toBe(8000);
    expect(alloc.guestShares.b).toBe(5000);
    expect(
      alloc.hostSharePaise + alloc.guestShares.a + alloc.guestShares.b,
    ).toBe(24000);
  });

  it('tracks petrol price matrix for equal split', () => {
    for (const rupees of [100, 110, 120, 130]) {
      const paise = rupees * 100;
      const alloc = equalRouteFuelShare({
        distanceMeters: 20000,
        petrolPaisePerLitre: paise,
        guestIds: ['a', 'b'],
      });
      const expectedTotal = Math.round(20 * (paise / 10));
      expect(alloc.totalFuelPaise).toBe(expectedTotal);
      expect(
        alloc.hostSharePaise + alloc.guestShares.a + alloc.guestShares.b,
      ).toBe(expectedTotal);
    }
  });
});
