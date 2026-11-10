import { readFileSync } from 'fs';
import { resolve } from 'path';
import { describe, expect, it } from 'vitest';
import {
  isHostDiscoverabilityReady,
  shouldEnableDefaultAutopilot,
} from '@/lib/cleaner-city/hostDiscoverability';
import type { CommuteProfile, CommuteTemplate, OfficeLocation } from '@/hooks/queries/useCleanerCity';

function readSrc(rel: string) {
  return readFileSync(resolve(process.cwd(), rel), 'utf8');
}

function baseProfile(over: Partial<CommuteProfile> = {}): CommuteProfile {
  return {
    id: 'p1',
    user_id: 'u1',
    society_id: 's1',
    role: 'both',
    transport_preference: 'car',
    company_name: null,
    is_paused: false,
    deleted_at: null,
    autopilot_enabled: false,
    autopilot_confirm_mode: 'confirm',
    autopilot_default_applied: false,
    preferred_route_polyline: 'poly',
    preferred_route_distance_meters: 1000,
    preferred_route_duration_seconds: 600,
    preferred_route_origin_lat: 12.9,
    preferred_route_origin_lng: 77.6,
    preferred_route_dest_lat: 12.95,
    preferred_route_dest_lng: 77.65,
    ...over,
  };
}

describe('Cleaner City host + guest discoverability', () => {
  it('setup persists Host choice as role both', () => {
    const setup = readSrc('src/pages/cleaner-city/CleanerCitySetupPage.tsx');
    expect(setup).toContain('persistedRoleForIntent');
    expect(setup).toContain("intent: 'host' as const");
    expect(setup).toContain("role: 'both' as const");
    expect(setup).toContain('cleaner-city-setup-find-cta');
  });

  it('hooks expose maybe-enable default autopilot RPC', () => {
    const hooks = readSrc('src/hooks/queries/useCleanerCity.ts');
    expect(hooks).toContain('useMaybeEnableDefaultAutopilot');
    expect(hooks).toContain('cleaner_city_maybe_enable_default_autopilot');
    expect(hooks).toContain('autopilot_default_applied');
  });

  it('schedule and offer explain Auto-offer discoverability', () => {
    const schedule = readSrc('src/pages/cleaner-city/CleanerCitySchedulePage.tsx');
    expect(schedule).toContain('neighbours can find you on your usual road');
    expect(schedule).toContain('maybeEnableAutopilot');
    const offer = readSrc('src/pages/cleaner-city/CleanerCityOfferPage.tsx');
    expect(offer).toContain('Weekday seats stay findable with Auto-offer');
  });

  it('SQL migration upgrades host role and publishes both legs', () => {
    const mig = readSrc(
      'supabase/migrations/20261110200000_cleaner_city_host_guest_discoverability.sql',
    );
    expect(mig).toContain('autopilot_default_applied');
    expect(mig).toContain("SET role = 'both'");
    expect(mig).toContain('cleaner_city_maybe_enable_default_autopilot');
    expect(mig).toContain("ARRAY['to_office', 'to_home']");
    expect(mig).toContain('preferred_return_route_polyline');
  });

  it('Find still matches published seats only', () => {
    const find = readSrc('src/pages/cleaner-city/CleanerCityFindPage.tsx');
    expect(find).toContain('useFindMatches');
    const hooks = readSrc('src/hooks/queries/useCleanerCity.ts');
    expect(hooks).toContain('cleaner_city_find_matches');
  });

  it('Profile hub shows real society name, not office pin', () => {
    const profile = readSrc('src/pages/cleaner-city/CleanerCityProfileHubPage.tsx');
    expect(profile).toContain('society?.name');
    expect(profile).not.toContain('authProfile?.society_name || office?.label');
    expect(profile).toContain("label: 'Home'");
    expect(profile).toContain("label: 'Office'");
  });

  it('isHostDiscoverabilityReady requires vehicle pins road and week', () => {
    const templates: CommuteTemplate[] = [
      {
        id: 't1',
        weekday: 1,
        is_working: true,
        depart_time: '08:30',
        return_time: '19:00',
        pickup_label: 'Home',
        pickup_latitude: 12.9,
        pickup_longitude: 77.6,
      },
    ];
    const offices: OfficeLocation[] = [
      {
        id: 'o1',
        label: 'Office',
        address_text: null,
        latitude: 12.95,
        longitude: 77.65,
        is_primary: true,
      } as OfficeLocation,
    ];
    const vehicles = [{ is_active: true }];

    expect(
      isHostDiscoverabilityReady({
        profile: baseProfile(),
        templates,
        offices,
        vehicles,
      }),
    ).toBe(true);

    expect(
      isHostDiscoverabilityReady({
        profile: baseProfile({ preferred_route_polyline: null }),
        templates,
        offices,
        vehicles,
      }),
    ).toBe(false);

    expect(
      isHostDiscoverabilityReady({
        profile: baseProfile({ role: 'guest' }),
        templates,
        offices,
        vehicles,
      }),
    ).toBe(false);
  });

  it('shouldEnableDefaultAutopilot respects applied flag and current enabled', () => {
    expect(shouldEnableDefaultAutopilot(baseProfile())).toBe(true);
    expect(
      shouldEnableDefaultAutopilot(baseProfile({ autopilot_enabled: true })),
    ).toBe(false);
    expect(
      shouldEnableDefaultAutopilot(baseProfile({ autopilot_default_applied: true })),
    ).toBe(false);
  });
});
