import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  buildHomeDemoGuests,
  rideRequestToGuestCard,
} from '@/lib/cleaner-city/homeDemoGuests';

const read = (rel: string) => readFileSync(resolve(process.cwd(), rel), 'utf8');

describe('Find Guests on Home', () => {
  it('seeds multiple corridor guests tailored to host pins', () => {
    const guests = buildHomeDemoGuests({
      homeLabel: 'Shriram Greenfield Phase-2, Tower H',
      officeLabel: 'Swiggy Instamart',
      direction: 'to_office',
      leaveTime: '08:30',
    });
    expect(guests.length).toBeGreaterThanOrEqual(3);
    expect(guests[0].guestName).toBeTruthy();
    expect(guests[0].pickupHint).toMatch(/Greenfield|Tower|Home/i);
    expect(guests[0].dropHint).toMatch(/Swiggy|Instamart|Office/i);
    expect(guests[0].fuelOfferRs).toBeGreaterThan(0);
  });

  it('guest match card uses Offer Ride layout', () => {
    const card = read('src/components/cleaner-city/CleanerCityGuestMatchCard.tsx');
    expect(card).toContain('Offer Ride');
    expect(card).toContain('Leaves at');
    expect(card).toContain('cleaner-city-guest-leave-time');
    expect(card).toContain('Arrive by');
    expect(card).toContain('cleaner-city-offer-ride');
    expect(card).toContain('walkPickupMeters');
    expect(card).toContain('companyName');
    expect(card).toContain('BadgeCheck');
    expect(card).toContain('cleaner-city-guest-company-verified');
    expect(card).toContain('onDecline');
    expect(card).toContain('cleaner-city-sticky-accept');
  });

  it('maps live ride requests into rich guest cards with company and km', () => {
    const guest = rideRequestToGuestCard(
      {
        id: 'ride-1',
        guest_name: 'Geetu Jaisi',
        guest_flat: '113',
        guest_society: 'Shriram Greenfield Phase-2, Tower H',
        guest_company: 'Infosys',
        depart_time: '08:30',
        origin_label: 'Shriram Greenfield Phase-2, Tower H',
        destination_label: 'Swiggy Instamart',
        estimated_fuel_paise: 3870,
        guest_pickup_latitude: 13.07195,
        guest_pickup_longitude: 77.75105,
        guest_dest_latitude: 12.9879245,
        guest_dest_longitude: 77.7278517,
      },
      {
        hostOrigin: { lat: 13.07242869, lng: 77.75148633 },
        hostDest: { lat: 12.9879245, lng: 77.7278517 },
      },
    );
    expect(guest.companyName).toBe('Infosys');
    expect(guest.societyOrCompany).toContain('Flat 113');
    expect(guest.societyOrCompany).toMatch(/Greenfield|Tower H/i);
    expect(guest.fuelOfferRs).toBe(39);
    expect(guest.driveMeters).toBeGreaterThan(5000);
    expect(guest.tags.some((t) => /km shared/.test(t))).toBe(true);
    expect(guest.pickupHint).toMatch(/Greenfield|Tower|Pickup/i);
  });

  it('Home sticky requests use rich guest cards', () => {
    const home = read('src/pages/cleaner-city/CleanerCityHomePage.tsx');
    expect(home).toContain('rideRequestToGuestCard');
    expect(home).toContain('cleaner-city-sticky-hosting');
    expect(home).toContain('CleanerCityGuestMatchCard');
    expect(home).not.toContain('buildHomeDemoGuests');
  });
});
