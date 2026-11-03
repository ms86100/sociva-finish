import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const read = (rel: string) => readFileSync(resolve(process.cwd(), rel), 'utf8');

describe('Cleaner City Uber/Hopr meeting pin', () => {
  it('ride uses self-serve map meeting picker without admin dependency', () => {
    const ride = read('src/pages/cleaner-city/CleanerCityRidePage.tsx');
    const picker = read('src/components/cleaner-city/CleanerCityMeetingPointPicker.tsx');
    expect(ride).toContain('CleanerCityMeetingPointPicker');
    expect(picker).toContain('No admin list required');
    expect(picker).toContain('Use my GPS');
    expect(picker).toContain('Confirm meeting pin');
    expect(picker).toContain('CleanerCityPinPicker');
    expect(picker).not.toContain('No society meetup points yet');
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
