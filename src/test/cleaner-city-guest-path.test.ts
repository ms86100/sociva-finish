import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

function read(rel: string) {
  return fs.readFileSync(path.resolve(process.cwd(), rel), 'utf8');
}

describe('Cleaner City guest path', () => {
  it('hub I-need-a-seat opens setup with guest intent', () => {
    const hub = read('src/pages/cleaner-city/CleanerCityPage.tsx');
    expect(hub).toContain("intent: 'guest'");
    expect(hub).toContain("setCleanerCityIntent('guest')");
    expect(hub).toContain('cleaner-city-hub-intent-find');
  });

  it('setup page has guest-only modules and no vehicle as primary done step', () => {
    const setup = read('src/pages/cleaner-city/CleanerCitySetupPage.tsx');
    expect(setup).toContain('data-intent={intent}');
    expect(setup).toContain('cleaner-city-setup-guest-banner');
    expect(setup).toContain('Set up as a guest');
    expect(setup).toContain('pinsOnly={isGuestPath}');
    expect(setup).toContain('cleaner-city-setup-guest-find-cta');
    expect(setup).toContain('cleaner-city-setup-guest-schedule');
    expect(setup).toContain('cleaner-city-setup-guest-safety');
    expect(setup).toContain('Open Find a seat');
    expect(setup).toContain('No vehicle or driving roads');
  });

  it('route panel can hide driving roads for guests', () => {
    const panel = read('src/components/cleaner-city/CleanerCityRouteSetupPanel.tsx');
    expect(panel).toContain('pinsOnly');
    expect(panel).toContain('cleaner-city-guest-pins-hint');
    expect(panel).toContain("wizardStep === 'roads' && !pinsOnly");
  });

  it('route panel walks home then office then roads', () => {
    const panel = read('src/components/cleaner-city/CleanerCityRouteSetupPanel.tsx');
    expect(panel).toContain("type WizardStep = 'home' | 'office' | 'roads'");
    expect(panel).toContain('cleaner-city-route-step-home');
    expect(panel).toContain('cleaner-city-route-step-office');
    expect(panel).toContain('cleaner-city-route-choice');
    expect(panel).toContain('fetchDrivingRouteAlternativesDetailed');
    expect(panel).toContain('cleaner-city-route-retry');
  });
});
