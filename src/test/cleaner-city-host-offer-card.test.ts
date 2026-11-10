import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const read = (rel: string) => readFileSync(resolve(process.cwd(), rel), 'utf8');

describe('Host offer ride board', () => {
  it('Offer published-seats board uses host cards with route/seats/guest details', () => {
    const offer = read('src/pages/cleaner-city/CleanerCityOfferPage.tsx');
    expect(offer).toContain('HostOfferRideCard');
    expect(offer).toContain('hostGuestsByPublication');
    expect(offer).toContain('cleaner-city-offer-rides-board');
    expect(offer).toContain('Your published seats');

    const card = read('src/components/cleaner-city/HostOfferRideCard.tsx');
    expect(card).toContain('Route');
    expect(card).toContain('Seats');
    expect(card).toContain('Guests');
    expect(card).toContain('Seats open');
    expect(card).toContain('Cancelled');
    expect(card).toContain('cleaner-city-host-offer-rider');
    expect(card).toContain('guest_flat');
    expect(card).toContain('guest_dest_latitude');
    expect(card).toContain('meeting_point_label');
    expect(card).toContain('Find Guests on Home');
    expect(card).toContain('openFindGuests');
    expect(card).not.toContain('Go to Home for requests');
  });
});
