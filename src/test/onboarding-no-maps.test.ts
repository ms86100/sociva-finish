import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

function read(rel: string) {
  return readFileSync(resolve(__dirname, '..', rel), 'utf8');
}

describe('society join does not use Google Maps', () => {
  it('AuthPage search is approved-registry only', () => {
    const page = read('pages/AuthPage.tsx');
    expect(page).not.toMatch(/Loading Google Maps/);
    expect(page).not.toMatch(/handleSelectGooglePlace/);
    expect(page).not.toMatch(/showGoogleResults/);
    expect(page).not.toMatch(/potentialMatches/);
    expect(page).toMatch(/approved Sociva society/);
    expect(page).toMatch(/Google Maps cannot create or join a society/);
  });

  it('join hook no longer loads Places or map-confirm', () => {
    const hook = read('hooks/useAuthPage.ts');
    expect(hook).not.toMatch(/useAutocomplete|useGoogleMaps|handleSelectGooglePlace/);
    expect(hook).toMatch(/fetchApprovedSocieties/);
    expect(hook).toMatch(/requestSocietyMembership/);
  });

  it('first-time address form does not auto-open the map', () => {
    const form = read('components/profile/AddressForm.tsx');
    const profile = read('pages/ProfileEditPage.tsx');
    expect(form).toMatch(/autoOpenMap = false/);
    expect(profile).toMatch(/autoOpenMap=\{false\}/);
    expect(profile).toMatch(/deliveryOnly/);
    expect(profile).toMatch(/preferSociety: true/);
  });
});
