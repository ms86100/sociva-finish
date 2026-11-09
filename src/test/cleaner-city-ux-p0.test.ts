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

  it('surfaces Cleaner City from Home and Book', () => {
    expect(read('src/pages/HomePage.tsx')).toContain('CleanerCityEntryCard');
    expect(read('src/pages/CommerceModePage.tsx')).toContain('CleanerCityEntryCard');
    const card = read('src/components/cleaner-city/CleanerCityEntryCard.tsx');
    expect(card).toContain('to="/cleaner-city"');
    expect(card).toContain('Find a ride');
  });

  it('hub is Mission-first with Find/Offer primary and collapsed settings', () => {
    const hub = read('src/pages/cleaner-city/CleanerCityPage.tsx');
    expect(hub).toContain('CleanerCityActiveMissionCard');
    expect(hub).toContain('cleaner-city-upcoming-section');
    expect(hub).toContain('cleaner-city-find-link');
    expect(hub).toContain('cleaner-city-offer-link');
    expect(hub).toContain('cleaner-city-settings-toggle');
    expect(hub).toContain('useState(false)');
    expect(hub).toContain('cleaner-city-hub-welcome');
    expect(hub).toContain('openHosting: true');
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
