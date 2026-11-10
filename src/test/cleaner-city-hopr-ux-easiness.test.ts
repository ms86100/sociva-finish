import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const read = (rel: string) => readFileSync(resolve(process.cwd(), rel), 'utf8');

describe('HOPR UX easiness shell (no regression)', () => {
  it('Find is dedicated search with real matches and Offer empty CTA', () => {
    const find = read('src/pages/cleaner-city/CleanerCityFindPage.tsx');
    expect(find).toContain('cleaner-city-match-results');
    expect(find).toContain('Available rides');
    expect(find).toContain('useFindMatches');
    expect(find).toContain('useRequestRide');
    expect(find).toContain('cleaner-city-offer-link');
    expect(find).toContain('CleanerCityEditRideDrawer');
    expect(find).toContain('CleanerCityChangeRouteDrawer');
    expect(find).not.toContain('buildHomeDemoGuests');
    expect(find).not.toContain('Where are you headed?');
    const home = read('src/pages/cleaner-city/CleanerCityHomePage.tsx');
    expect(home).toContain('CleanerCityGuestMatchCard');
    expect(home).toContain('cleaner-city-sticky-hosting');
    expect(home).not.toContain('buildHomeDemoGuests');
  });

  it('Your rides board mirrors HOPR card anatomy', () => {
    const board = read('src/components/cleaner-city/CleanerCityYourRidesBoard.tsx');
    expect(board).toContain('useSetCommuteOverride');
    expect(board).toContain('stripInactiveMarker');
    expect(board).toContain('Edit planned rides');
    expect(board).not.toContain('clearOverride.mutateAsync');
    expect(board).toContain('Find Hosts');
    expect(board).toContain('Find Guests');
    expect(board).toContain('onFindGuests');
    expect(board).toContain('playMode');
    expect(board).toContain('useEnsureHostPublication');
    expect(board).toContain('useCancelHostPublicationsForDate');
    expect(board).not.toContain("navigate('/cleaner-city/offer'");
    expect(board).toContain('ChevronUp');
    expect(board).toContain('Going');
    expect(board).toContain('Not Going');
    expect(board).toContain('CleanerCityInactiveRideDrawer');
    expect(board).toContain('cleaner-city-your-rides');
    expect(board).toContain('+ Create new ride');
    expect(board).toContain('CleanerCityEditRideDrawer');
    expect(board).toContain('CleanerCityPlannedRidesDrawer');
    expect(board).not.toContain("to=\"/cleaner-city/schedule\"");
  });

  it('Going-driven host seats ensure on Going and cancel on inactive', () => {
    const hooks = read('src/hooks/queries/useCleanerCity.ts');
    expect(hooks).toContain('useEnsureHostPublication');
    expect(hooks).toContain('useCancelHostPublicationsForDate');
    expect(hooks).toContain('cleaner_city_publish_commute');
    expect(hooks).toContain('cleaner_city_cancel_publication');

    const board = read('src/components/cleaner-city/CleanerCityYourRidesBoard.tsx');
    expect(board).toContain('ensureHostLeg');
    expect(board).toContain('cancelHostLegs');
    expect(board).toContain('Finding guests');

    const offer = read('src/pages/cleaner-city/CleanerCityOfferPage.tsx');
    expect(offer).toContain('usePublishCommute');
    expect(offer).toContain('cleaner-city-offer-publish');

    const home = read('src/pages/cleaner-city/CleanerCityHomePage.tsx');
    expect(home).toContain('cleaner-city-home-offer-seat');
    expect(home).toContain('/cleaner-city/offer');
    const find = read('src/pages/cleaner-city/CleanerCityFindPage.tsx');
    expect(find).toContain('cleaner-city-offer-link');
  });

  it('Edit planned rides uses Confirm changes drawer like Edit this ride', () => {
    const drawer = read('src/components/cleaner-city/CleanerCityPlannedRidesDrawer.tsx');
    expect(drawer).toContain('Edit planned rides');
    expect(drawer).toContain('Confirm changes');
    expect(drawer).toContain('Leave home');
    expect(drawer).toContain('Leave office');
    expect(drawer).toContain('Office days');
    expect(drawer).toContain('sr-only');
    expect(drawer).toContain('cleaner-city-planned-depart');
    expect(drawer).toContain('${testId}-display');
    expect(drawer).toContain('${testId}-up');
    expect(drawer).not.toContain('w-[7.5rem]');
  });

  it('Going off opens inactive duration drawer with one-side and both-ways options', () => {
    const drawer = read('src/components/cleaner-city/CleanerCityInactiveRideDrawer.tsx');
    expect(drawer).toContain('How long do you want to be inactive?');
    expect(drawer).toContain('Just for this trip');
    expect(drawer).toContain('Both ways today');
    expect(drawer).toContain('For tomorrow');
    expect(drawer).toContain('For this week');
    expect(drawer).toContain('For longer');
    expect(drawer).toContain('Go inactive');

    const helpers = read('src/lib/cleaner-city/legInactive.ts');
    expect(helpers).toContain('cc_inactive:');
    expect(helpers).toContain('parseInactiveLegs');
  });

  it('Edit this ride drawer is used on Home Find and Offer', () => {
    const drawer = read('src/components/cleaner-city/CleanerCityEditRideDrawer.tsx');
    expect(drawer).toContain('Edit this ride');
    expect(drawer).toContain('Confirm changes');
    expect(drawer).toContain('Choose time');
    expect(drawer).toContain('Change your preferred route');
    expect(drawer).toContain('onRequestChangeRoute');
    expect(drawer).toContain('cleaner-city-edit-ride-route');
    expect(drawer).toContain('cleaner-city-edit-ride-time-display');
    expect(drawer).toContain('cleaner-city-edit-ride-time-up');
    expect(drawer).toContain('setOverride.mutateAsync');
    expect(drawer).toContain("override_kind: 'time_change'");
    expect(drawer).not.toContain('w-[7.25rem]');
    expect(drawer).not.toContain('to="/cleaner-city/route"');

    const find = read('src/pages/cleaner-city/CleanerCityFindPage.tsx');
    expect(find).toContain('CleanerCityEditRideDrawer');
    expect(find).toContain('CleanerCityChangeRouteDrawer');
    expect(find).toContain('onRequestChangeRoute');
    expect(find).toContain('cleaner-city-find-change-time');
    expect(find).not.toContain('showTimeTweaks');

    const offer = read('src/pages/cleaner-city/CleanerCityOfferPage.tsx');
    expect(offer).toContain('CleanerCityEditRideDrawer');
    expect(offer).toContain('CleanerCityChangeRouteDrawer');
    expect(offer).toContain('onRequestChangeRoute');
    expect(offer).toContain('cleaner-city-offer-edit-ride');

    const board = read('src/components/cleaner-city/CleanerCityYourRidesBoard.tsx');
    expect(board).toContain('CleanerCityChangeRouteDrawer');
    expect(board).toContain('onRequestChangeRoute');
  });

  it('Change route drawer confirms preferred path and updates live offer geometry', () => {
    const change = read('src/components/cleaner-city/CleanerCityChangeRouteDrawer.tsx');
    expect(change).toContain('Change route');
    expect(change).toContain('Confirm Going Route');
    expect(change).toContain('Confirm Return Route');
    expect(change).toContain('Preferred Route');
    expect(change).toContain('fetchDrivingRouteAlternativesDetailed');
    expect(change).toContain('useSetPreferredRoute');
    expect(change).toContain('useStoreRouteGeometry');
    expect(change).toContain('useEnsureHostPublication');
    expect(change).toContain('storeRoute.mutateAsync');
    expect(change).toContain('ensurePub.mutateAsync');
    expect(change).toContain('setPreferred.mutateAsync');
    expect(change).toContain('cleaner-city-change-route-drawer');
    expect(change).toContain('cleaner-city-change-route-confirm');

    const offer = read('src/pages/cleaner-city/CleanerCityOfferPage.tsx');
    expect(offer).toContain('usePublishCommute');
    expect(offer).toContain('cleaner-city-offer-publish');
  });

  it('Offer deep-links publish prefills and slims when setup is complete', () => {
    const offer = read('src/pages/cleaner-city/CleanerCityOfferPage.tsx');
    expect(offer).toContain('travelDate');
    expect(offer).toContain('setupComplete');
    expect(offer).toContain('Edit planned rides');
    expect(offer).toContain('Publish ride');
    expect(offer).toContain('CleanerCityOfferSetupDrawer');
    expect(offer).toContain('cleaner-city-offer-edit-');
    expect(offer).toContain("setSetupDrawer('vehicle')");
    expect(offer).toContain("setSetupDrawer('path')");
    expect(offer).not.toContain('CleanerCityPlaySwitch');
    expect(offer).not.toContain('Back to publish');

    const setupDrawer = read('src/components/cleaner-city/CleanerCityOfferSetupDrawer.tsx');
    expect(setupDrawer).toContain('Edit vehicle');
    expect(setupDrawer).toContain('Edit path');
    expect(setupDrawer).toContain('Edit planned rides');
  });

  it('Bottom nav uses My rides and Schedule uses Leave times', () => {
    const nav = read('src/components/cleaner-city/CleanerCityBottomNav.tsx');
    expect(nav).toContain("label: 'My rides'");
    expect(nav).toContain("label: 'Find'");
    expect(nav).not.toContain("label: 'Trips'");
    expect(nav).not.toContain("label: 'Route'");

    const rides = read('src/pages/cleaner-city/CleanerCityRidesPage.tsx');
    expect(rides).toContain('CleanerCityActiveMissionCard');
    expect(rides).toContain('Open seats you offered');
    expect(rides).toContain('No trips yet');
    expect(rides).not.toContain('No active trip');
    expect(rides).not.toContain('No live quest');

    const schedule = read('src/pages/cleaner-city/CleanerCitySchedulePage.tsx');
    expect(schedule).toContain('Leave times');
    expect(schedule).toContain('Save commute');
    expect(schedule).not.toContain('Planned rides');

    const route = read('src/pages/cleaner-city/CleanerCityRoutePage.tsx');
    expect(route).toContain('Path ready');
    expect(route).toContain('Continue to leave times');
  });

  it('booking engines remain guest-request and host-publish', () => {
    const find = read('src/pages/cleaner-city/CleanerCityFindPage.tsx');
    expect(find).toContain('useRequestRide');
    const home = read('src/pages/cleaner-city/CleanerCityHomePage.tsx');
    expect(home).toContain('useRespondRideRequest');
    expect(home).toContain('useRequestRide');
    const offer = read('src/pages/cleaner-city/CleanerCityOfferPage.tsx');
    expect(offer).toContain('usePublishCommute');
    expect(offer).toContain('cleaner-city-offer-publish');
  });
});
