import { describe, expect, it, beforeEach } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import {
  mapGeoToLocationState,
  mapPushReceiveToNotificationState,
  getOrCreateInstallationId,
  __resetInstallationIdCacheForTests,
} from '@/lib/installation';

const root = resolve(__dirname, '../..');
const read = (rel: string) => readFileSync(resolve(root, rel), 'utf8');

describe('installation permission mappers', () => {
  it('maps push receive statuses independently of token presence', () => {
    expect(mapPushReceiveToNotificationState('granted')).toBe('enabled');
    expect(mapPushReceiveToNotificationState('denied')).toBe('denied');
    expect(mapPushReceiveToNotificationState('prompt')).toBe('not_requested');
    expect(mapPushReceiveToNotificationState('prompt-with-rationale')).toBe('not_requested');
    expect(mapPushReceiveToNotificationState(undefined)).toBe('unknown');
  });

  it('maps geolocation statuses including restricted', () => {
    expect(mapGeoToLocationState('granted')).toBe('enabled');
    expect(mapGeoToLocationState('denied')).toBe('denied');
    expect(mapGeoToLocationState('prompt')).toBe('not_requested');
    expect(mapGeoToLocationState('restricted')).toBe('restricted');
    expect(mapGeoToLocationState(null)).toBe('unknown');
  });
});

describe('installation_id stability', () => {
  beforeEach(() => {
    localStorage.clear();
    __resetInstallationIdCacheForTests();
  });

  it('creates a stable id and reuses it', async () => {
    const a = await getOrCreateInstallationId();
    __resetInstallationIdCacheForTests();
    const b = await getOrCreateInstallationId();
    expect(a).toBe(b);
    expect(a.length).toBeGreaterThanOrEqual(8);
  });
});

describe('phase1 installation wiring (source)', () => {
  it('keeps device_tokens as delivery SoT and adds app_installations migration', () => {
    const migration = read(
      'supabase/migrations/20260922153157_app_installations_permission_lifecycle.sql',
    );
    expect(migration).toMatch(/CREATE TABLE IF NOT EXISTS public\.app_installations/);
    expect(migration).toMatch(/claim_app_installation/);
    expect(migration).toMatch(/release_app_installation_user/);
    expect(migration).toMatch(/stamp_device_token_installation/);
    expect(migration).toMatch(/ADD COLUMN IF NOT EXISTS installation_id/);
    // Must not replace claim_device_token
    expect(migration).not.toMatch(/CREATE OR REPLACE FUNCTION public\.claim_device_token/);
  });

  it('wires claim on login and release on logout without rotating installation_id', () => {
    const provider = read('src/components/notifications/PushNotificationProvider.tsx');
    const install = read('src/lib/installation.ts');
    expect(provider).toMatch(/claimInstallationToUser/);
    expect(provider).toMatch(/releaseInstallationUser/);
    expect(provider).toMatch(/removeTokenFromDatabase/);
    expect(install).toMatch(/Never rotates on logout/);
    expect(install).toMatch(/release_app_installation_user/);
  });

  it('syncs location permission on GPS grant/deny without coupling to login', () => {
    const page = read('src/pages/LocationDiscoveryPage.tsx');
    expect(page).toMatch(/locationPermission: 'enabled'/);
    expect(page).toMatch(/locationPermission: 'denied'/);
    expect(page).toMatch(/Manual pin can still be set/);
  });
});
