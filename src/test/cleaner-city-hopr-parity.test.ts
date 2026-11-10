import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { formatMatchReason, matchReasonChips } from '@/lib/cleaner-city/matchCopy';
import {
  canShowRideSos,
  canShowTripShare,
  rideNextHint,
} from '@/lib/cleaner-city/rideMissionCopy';

function read(rel: string) {
  return fs.readFileSync(path.resolve(process.cwd(), rel), 'utf8');
}

const hoprMig = read(
  'supabase/migrations/20261104120000_cleaner_city_hopr_parity_match_stops.sql',
);
const offerPage = read('src/pages/cleaner-city/CleanerCityOfferPage.tsx');
const findPage = read('src/pages/cleaner-city/CleanerCityFindPage.tsx');
const hubPage = read('src/pages/cleaner-city/CleanerCityHomePage.tsx');
const ridePage = read('src/pages/cleaner-city/CleanerCityRidePage.tsx');
const rideActions = read('src/components/cleaner-city/ride/RidePrimaryActions.tsx');
const matchCard = read('src/components/cleaner-city/CleanerCityMatchCard.tsx');

describe('Cleaner City Hopr/QuickRide parity', () => {
  it('hub is state-driven with mission CTA and dual-intent welcome', () => {
    expect(hubPage).toContain('cleaner-city-hub-mission-cta');
    expect(hubPage).toContain('cleaner-city-hub-welcome');
    expect(hubPage).toContain('cleaner-city-hub-next-step');
    expect(hubPage).toContain('cleaner-city-hub-intent-find');
    expect(hubPage).toContain('cleaner-city-hub-intent-offer');
    expect(hubPage).toContain('I need a seat');
    expect(hubPage).toContain('I have empty seats');
    expect(hubPage).not.toContain('Finish setup, then find or offer a seat.');
  });

  it('Find removes OTP/start/complete duplicates and deep-links to Ride', () => {
    expect(findPage).not.toContain('useGenerateRideOtp');
    expect(findPage).not.toContain('useStartRide');
    expect(findPage).not.toContain('useCompleteRide');
    expect(findPage).toContain('Open ride for pickup code');
    expect(findPage).toContain('Open ride');
  });

  it('Offer publishes on one tap of a route alternative card', () => {
    expect(offerPage).toContain('tap to publish');
    expect(offerPage).toContain('void publishRide(alt)');
    expect(offerPage).toContain('cleaner-city-offer-route-alt');
  });

  it('match payload includes on_route_drop, reason_labels, mid-route stop insert', () => {
    expect(hoprMig).toContain('on_route_drop');
    expect(hoprMig).toContain('drop_mid_route');
    expect(hoprMig).toContain('reason_labels');
    expect(hoprMig).toContain('guest_mid_route_drop');
    expect(hoprMig).toContain('commute_publication_stops');
    expect(formatMatchReason('drop_mid_route')).toBe('Drop mid-route');
    expect(formatMatchReason('pickup_on_route_corridor')).toBe('Pickup on route');
    expect(matchReasonChips(['pickup_on_route_corridor', 'drop_mid_route', 'detour_within_limit'])).toEqual(
      ['Pickup on route', 'Drop mid-route', 'Small detour'],
    );
  });

  it('MatchCard exposes Why this ride and mid-route chip', () => {
    expect(matchCard).toContain('cleaner-city-match-why');
    expect(matchCard).toContain('Why this ride');
    expect(matchCard).toContain('cleaner-city-on-route-drop');
  });

  it('passenger OTP display + host start + complete confirm + rate prompt', () => {
    expect(rideActions).toContain('cleaner-city-passenger-otp-display');
    expect(rideActions).toContain('cleaner-city-host-otp-input');
    expect(rideActions).toContain('cleaner-city-complete-confirm');
    expect(rideActions).toContain('cleaner-city-rate-prompt');
    expect(rideActions).toContain('cleaner-city-inline-meeting');
    expect(ridePage).toContain('cleaner-city-rate-section');
    expect(rideNextHint('pickup_pending', true)).toContain("guest's 6-digit code");
    expect(rideNextHint('pickup_pending', false)).toContain('Show your code');
  });

  it('SOS from confirmed with confirm sheet; Message when VoIP not live', () => {
    expect(canShowRideSos('confirmed')).toBe(true);
    expect(canShowRideSos('requested')).toBe(false);
    expect(canShowTripShare('confirmed')).toBe(true);
    expect(ridePage).toContain('cleaner-city-sos-confirm');
    expect(ridePage).toContain('Send SOS to contacts?');
    expect(ridePage).toContain('cleaner-city-message-instead-of-call');
    expect(ridePage).not.toContain('PSTN relay not available');
  });

  it('emergency contact soft-gates publish and request', () => {
    expect(offerPage).toContain('hasVerifiedEmergency');
    expect(offerPage).toContain('cleaner-city-offer-emergency-gate');
    expect(offerPage).toContain('emergency contact');
    expect(offerPage).toContain('for SOS');
    expect(findPage).toContain('hasVerifiedEmergency');
    expect(findPage).toContain('Tip: add an emergency contact anytime in You → Safety');
    expect(findPage).not.toContain('Add a verified emergency contact before requesting');
  });
});
