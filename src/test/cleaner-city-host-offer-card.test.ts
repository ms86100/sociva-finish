import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const read = (rel: string) => readFileSync(resolve(process.cwd(), rel), 'utf8');

describe('Host offer ride board', () => {
  it('Offer My rides uses rich host cards with who/when/where/rider details', () => {
    const offer = read('src/pages/cleaner-city/CleanerCityOfferPage.tsx');
    expect(offer).toContain('HostOfferRideCard');
    expect(offer).toContain('hostGuestsByPublication');
    expect(offer).toContain('cleaner-city-offer-rides-board');

    const card = read('src/components/cleaner-city/HostOfferRideCard.tsx');
    expect(card).toContain('When');
    expect(card).toContain('Where');
    expect(card).toContain('What');
    expect(card).toContain('Who');
    expect(card).toContain('cleaner-city-host-offer-rider');
    expect(card).toContain('guest_flat');
    expect(card).toContain('guest_dest_latitude');
    expect(card).toContain('meeting_point_label');
  });
});
