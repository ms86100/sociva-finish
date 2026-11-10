import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  locationFreshnessLabel,
  locationFreshnessTone,
  rideLifecycleEventLabel,
} from '@/lib/cleaner-city/rideMissionCopy';

const read = (rel: string) => readFileSync(resolve(process.cwd(), rel), 'utf8');

describe('Cleaner City trust hardening', () => {
  const migration = read(
    'supabase/migrations/20261103090000_cleaner_city_trust_hardening.sql',
  );
  const ride = read('src/pages/cleaner-city/CleanerCityRidePage.tsx');
  const hooks = read('src/hooks/queries/useCleanerCity.ts');
  const admin = read('src/components/admin/AdminCleanerCityTab.tsx');
  const find = read('src/pages/cleaner-city/CleanerCityFindPage.tsx');
  const hub = read('src/pages/cleaner-city/CleanerCityHomePage.tsx');
  const share = read('src/pages/cleaner-city/CleanerCitySharePage.tsx');

  it('shortens share TTL to 2h and exposes revoke RPC', () => {
    expect(migration).toContain("now() + interval '2 hours'");
    expect(migration).toContain('cleaner_city_revoke_share_token');
    expect(migration).toContain('share_token_revoked');
    expect(hooks).toContain('useRevokeShareToken');
    expect(ride).toContain('cleaner-city-trip-share-revoke');
  });

  it('adds ride lifecycle evidence timeline without chat bodies', () => {
    expect(migration).toContain('ride_lifecycle_events');
    expect(migration).toContain('cleaner_city_list_ride_events');
    expect(migration).not.toContain('message_body');
    expect(ride).toContain('cleaner-city-ride-timeline');
    expect(ride).toContain('Chat stays private');
  });

  it('expands society-scoped pilot KPIs', () => {
    expect(migration).toContain('completion_rate_7d');
    expect(migration).toContain('share_links_active');
    expect(migration).toContain('meeting_pin_set_today');
    expect(admin).toContain('admin-cleaner-city-pilot-kpis');
    expect(admin).toContain('p_society_id');
  });

  it('polishes discovery empty states on Find and Hub', () => {
    expect(find).toContain('cleaner-city-find-empty');
    expect(find).toContain('No hosts on this leg yet');
    expect(find).toContain('/cleaner-city/route');
    expect(hub).toContain('cleaner-city-hub-discovery-empty');
  });

  it('is honest about SOS SMS, relay call, fuel, and iOS foreground tracking', () => {
    expect(migration).toContain('cleaner_city_runtime_capabilities');
    expect(hooks).toContain('useCleanerCityCapabilities');
    expect(ride).toContain('cleaner-city-call-honesty');
    expect(ride).toContain('cleaner-city-background-location-note');
    expect(ride).toContain('Online fuel checkout is not configured yet');
  });

  it('share page shows freshness and expiry', () => {
    expect(share).toContain('cleaner-city-share-freshness');
    expect(share).toContain('cleaner-city-share-expiry');
    expect(share).toContain('Invalid or expired share link');
  });

  it('formats location freshness labels', () => {
    const now = new Date().toISOString();
    expect(locationFreshnessTone(now)).toBe('live');
    expect(locationFreshnessLabel(now)).toContain('just now');
    expect(rideLifecycleEventLabel('meeting_pin_set')).toBe('Meet spot set');
    expect(rideLifecycleEventLabel('share_token_revoked')).toBe('Trip share link revoked');
  });

  it('never introduces em dash or en dash in hardening UI copy', () => {
    for (const src of [ride, admin, find, hub, share, migration]) {
      expect(src).not.toMatch(/[\u2013\u2014]/);
    }
  });
});
