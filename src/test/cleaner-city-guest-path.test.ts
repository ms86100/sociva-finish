import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

function read(rel: string) {
  return fs.readFileSync(path.resolve(process.cwd(), rel), 'utf8');
}

describe('Cleaner City guest path', () => {
  it('incomplete Home setup opens choice screen without forcing guest', () => {
    const hub = read('src/pages/cleaner-city/CleanerCityHomePage.tsx');
    const find = read('src/pages/cleaner-city/CleanerCityFindPage.tsx');
    expect(hub).toContain("navigate('/cleaner-city/setup'");
    expect(hub).not.toContain("intent: 'guest'");
    expect(find).toContain("setCleanerCityIntent('guest')");
    expect(hub).toContain('cleaner-city-hub-intent-find');
    expect(read('src/components/cleaner-city/CleanerCityPlaySwitch.tsx')).toContain(
      "setCleanerCityIntent(next === 'offer' ? 'host' : 'guest')",
    );
    expect(read('src/components/cleaner-city/CleanerCityPlaySwitch.tsx')).toContain(
      'bg-card text-foreground',
    );
  });

  it('setup shows guest and host start choices with short copy', () => {
    const setup = read('src/pages/cleaner-city/CleanerCitySetupPage.tsx');
    expect(setup).toContain('data-intent={intent}');
    expect(setup).toContain('cleaner-city-setup-path-choice');
    expect(setup).toContain('I need a seat');
    expect(setup).toContain('I can offer seats');
    expect(setup).toContain('cleaner-city-setup-host-choice');
    expect(setup).toContain('pinsOnly={isGuestPath}');
    expect(setup).toContain('cleaner-city-setup-guest-find-cta');
    expect(setup).toContain('cleaner-city-setup-guest-schedule');
    expect(setup).toContain('cleaner-city-setup-guest-safety');
    expect(setup).toContain('cleaner-city-setup-host-offer-cta');
    expect(setup).toContain('Find a seat');
    expect(setup).toContain('Offer seats');
    expect(setup).not.toContain('Four guest steps');
    expect(setup).not.toContain('Guest path');
    expect(setup).not.toContain('Back to A Cleaner City');
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
