import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = process.cwd();
const read = (rel: string) => readFileSync(resolve(root, rel), 'utf8');

describe('Cleaner City UX P0 wiring', () => {
  it('keeps Book lit on /cleaner-city routes', () => {
    const nav = read('src/components/layout/BottomNav.tsx');
    expect(nav).toContain("location.pathname.startsWith('/cleaner-city')");
    expect(nav).toContain("to === '/book'");
  });

  it('surfaces sociva cleaner city from Account, not Home/Book', () => {
    expect(read('src/pages/HomePage.tsx')).not.toContain('CleanerCityEntryCard');
    expect(read('src/pages/CommerceModePage.tsx')).not.toContain('CleanerCityEntryCard');
    expect(read('src/pages/ProfilePage.tsx')).toContain('CleanerCityEntryCard');
    expect(read('src/pages/ProfilePage.tsx')).toContain('account-cleaner-city-entry');
    const card = read('src/components/cleaner-city/CleanerCityEntryCard.tsx');
    expect(card).toContain('to="/cleaner-city"');
    expect(card).toContain('sociva cleaner city');
    expect(card).toContain('Find a ride');
  });

  it('hub is Find-first with search, Offer CTA, and active mission wiring', () => {
    const hub = read('src/pages/cleaner-city/CleanerCityPage.tsx');
    expect(hub).toContain('Where are you headed?');
    expect(hub).toContain('CleanerCityActiveMissionCard');
    expect(hub).toContain('cleaner-city-find-link');
    expect(hub).toContain('cleaner-city-offer-link');
    expect(hub).toContain('cleaner-city-hub-welcome');
    expect(hub).toContain('HOME_DEMO_RIDES');
    expect(hub).toContain('Request seat');
    expect(hub).toContain('useRequestRide');
    expect(hub).toContain('requestSeat');
    expect(hub).toContain('upsertHomeSeatRequest');
  });

  it('Offer publish hands off to Find hosting', () => {
    const offer = read('src/pages/cleaner-city/CleanerCityOfferPage.tsx');
    expect(offer).toContain("navigate('/cleaner-city/find'");
    expect(offer).toContain('openHosting: true');
  });

  it('Find keeps sticky Accept for incoming / openHosting', () => {
    const find = read('src/pages/cleaner-city/CleanerCityFindPage.tsx');
    expect(find).toContain('cleaner-city-sticky-hosting');
    expect(find).toContain('cleaner-city-sticky-accept');
    expect(find).toContain('hostingFocus');
    expect(find).toContain('openHosting');
    expect(find).toContain('Seat requests stay pinned at the top for Accept.');
  });
});
