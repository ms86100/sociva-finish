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

  it('surfaces sociva Ride from Home carousel, not Account/Book cards', () => {
    expect(read('src/pages/HomePage.tsx')).not.toContain('CleanerCityEntryCard');
    expect(read('src/pages/CommerceModePage.tsx')).not.toContain('CleanerCityEntryCard');
    expect(read('src/pages/ProfilePage.tsx')).not.toContain('CleanerCityEntryCard');
    expect(read('src/pages/ProfilePage.tsx')).not.toContain('HelpHubTeaser');
    expect(read('src/pages/ProfilePage.tsx')).not.toContain('account-cleaner-city-entry');
    expect(read('src/components/home/MarketplaceSection.tsx')).toContain('HomeDiscoveryCarousel');
    expect(read('src/components/home/MarketplaceSection.tsx')).not.toContain('HelpHubTeaser');
    const carousel = read('src/components/home/HomeDiscoveryCarousel.tsx');
    expect(carousel).toContain("href: '/cleaner-city'");
    expect(carousel).toContain('Find a ride');
    expect(carousel).toContain('cleaner_city');
    const card = read('src/components/cleaner-city/CleanerCityEntryCard.tsx');
    expect(card).toContain('to="/cleaner-city"');
    expect(card).toContain('to="/cleaner-city/offer"');
    expect(card).toContain('sociva Ride');
  });

  it('Home is greeting-first with Find/Offer CTAs and real nearby matches', () => {
    const home = read('src/pages/cleaner-city/CleanerCityHomePage.tsx');
    expect(home).toContain('cleaner-city-home-find-seat');
    expect(home).toContain('cleaner-city-home-offer-seat');
    expect(home).toContain('CleanerCityActiveMissionCard');
    expect(home).toContain('cleaner-city-hub-welcome');
    expect(home).toContain('cleaner-city-offer-link');
    expect(home).toContain('cleaner-city-home-empty-live');
    expect(home).toContain('Waiting on live neighbour offers');
    expect(home).toContain('useRequestRide');
    expect(home).toContain('requestSeat');
    expect(home).not.toContain('HOME_DEMO_RIDES');
    expect(home).not.toContain('buildHomeDemoGuests');
    expect(read('src/pages/cleaner-city/CleanerCityPage.tsx')).toContain(
      "export { default } from './CleanerCityHomePage'",
    );
    expect(read('src/components/cleaner-city/CleanerCityChrome.tsx')).toContain(
      'cleaner-city-back-to-sociva',
    );
    expect(read('src/components/cleaner-city/CleanerCityChrome.tsx')).toContain('Back to Sociva');
  });

  it('Offer publish hands off to Home hosting inbox', () => {
    const offer = read('src/pages/cleaner-city/CleanerCityOfferPage.tsx');
    expect(offer).toContain("navigate('/cleaner-city'");
    expect(offer).toContain('openHosting: true');
    const home = read('src/pages/cleaner-city/CleanerCityHomePage.tsx');
    expect(home).toContain('openHosting');
    expect(home).toContain('cleaner-city-sticky-hosting');
  });

  it('Home sticky Accept for incoming passenger requests', () => {
    const home = read('src/pages/cleaner-city/CleanerCityHomePage.tsx');
    expect(home).toContain('cleaner-city-sticky-hosting');
    expect(home).toContain('CleanerCityGuestMatchCard');
    expect(home).toContain('rideRequestToGuestCard');
    expect(home).toContain('useRespondRideRequest');
  });

  it('bottom nav is Home · Find · My rides · Profile with live Find route', () => {
    const nav = read('src/components/cleaner-city/CleanerCityBottomNav.tsx');
    expect(nav).toContain("label: 'Home'");
    expect(nav).toContain("label: 'Find'");
    expect(nav).toContain("label: 'My rides'");
    expect(nav).toContain("label: 'Profile'");
    expect(nav).not.toContain("label: 'Trips'");
    expect(nav).not.toContain("label: 'Route'");
    expect(nav).toContain('grid-cols-4');
    expect(read('src/pages/cleaner-city/CleanerCityFindRedirect.tsx')).toContain(
      "export { default } from './CleanerCityFindPage'",
    );
    expect(read('src/App.tsx')).toContain('CleanerCityFindRedirect');
    const find = read('src/pages/cleaner-city/CleanerCityFindPage.tsx');
    expect(find).toContain('useRequestRide');
    expect(find).toContain('Request seat');
    expect(find).toContain('cleaner-city-offer-link');
  });
});
