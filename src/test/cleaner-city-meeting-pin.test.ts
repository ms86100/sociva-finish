import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const read = (rel: string) => readFileSync(resolve(process.cwd(), rel), 'utf8');

describe('Cleaner City meeting pin on host road', () => {
  it('ride uses smart meet-spot picker without Uber/Hopr meme copy', () => {
    const ride = read('src/pages/cleaner-city/CleanerCityRidePage.tsx');
    const picker = read('src/components/cleaner-city/CleanerCityMeetingPointPicker.tsx');
    expect(ride).toContain('CleanerCityMeetingPointPicker');
    expect(ride).not.toContain('RideStatusStepper');
    expect(picker).toContain('Where guest walks to you');
    expect(picker).toContain('Confirm - guest walks here');
    expect(picker).toContain('Guest walks to this spot on your road');
    expect(picker).toContain('smartSuggest');
    expect(picker).toContain('CleanerCityPinPicker');
    expect(picker).not.toContain('Like Uber and Hopr');
    expect(picker).not.toContain('No admin list required');
    expect(picker).not.toContain('Drop the pin where you will wait');
  });

  it('active ride hero shows company tick, society flat, and quick Call/Chat/Share/SOS', () => {
    const hero = read('src/components/cleaner-city/ride/RideMissionHero.tsx');
    const ride = read('src/pages/cleaner-city/CleanerCityRidePage.tsx');
    const quick = read('src/components/cleaner-city/ride/RideQuickActions.tsx');
    expect(hero).toContain('partner_society');
    expect(hero).toContain('BadgeCheck');
    expect(hero).toContain('cleaner-city-ride-stepper');
    expect(quick).toContain('cleaner-city-ride-action-call');
    expect(quick).toContain('cleaner-city-ride-action-chat');
    expect(quick).toContain('cleaner-city-ride-action-share');
    expect(quick).toContain('cleaner-city-ride-action-sos');
    expect(ride).toContain('RideQuickActions');
    expect(ride).toContain('RideFindEachOther');
    expect(ride).toContain('shareLivePin');
    expect(ride).toContain("status === 'started') return ['trip', 'safety']");
    const find = read('src/components/cleaner-city/ride/RideFindEachOther.tsx');
    expect(find).toContain('Share my live pin');
    expect(find).toContain('cleaner-city-find-each-other');
    expect(hero).not.toContain("ride.status === 'pickup_pending' || ride.status === 'confirmed'");
  });

  it('setup includes Google route step for both directions', () => {
    const setup = read('src/pages/cleaner-city/CleanerCitySetupPage.tsx');
    const panel = read('src/components/cleaner-city/CleanerCityRouteSetupPanel.tsx');
    expect(setup).toContain('CleanerCityRouteSetupPanel');
    expect(setup).toContain('cleaner-city-setup-route-step');
    expect(panel).toContain('to_office');
    expect(panel).toContain('to_home');
    expect(panel).toContain('cleaner-city-route-accept-approx');
  });
});
