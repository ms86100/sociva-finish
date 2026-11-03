import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { resolveCleanerCityRideCall, resolveOrderCall } from '@/lib/calling/resolveCallContext';

const read = (rel: string) => readFileSync(resolve(process.cwd(), rel), 'utf8');

describe('Sociva universal VoIP platform', () => {
  const migration = read('supabase/migrations/20261103160000_sociva_universal_voip.sql');
  const edge = read('supabase/functions/voip-call/index.ts');
  const livekit = read('supabase/functions/_shared/livekit.ts');
  const apnsVoip = read('supabase/functions/voip-call/apnsVoip.ts');
  const callButton = read('src/components/calling/CallButton.tsx');
  const ride = read('src/pages/cleaner-city/CleanerCityRidePage.tsx');
  const androidPlugin = read(
    'android/app/src/main/java/app/sociva/community/SocivaVoipPlugin.kt',
  );
  const iosPlugin = read('native/ios/SocivaVoipPlugin.swift');
  const mainActivity = read('android/app/src/main/java/app/sociva/community/MainActivity.java');
  const codemagic = read('codemagic.yaml');

  it('gates calling behind voip_runtime_config and never enables by default', () => {
    expect(migration).toContain('voip_runtime_config');
    expect(migration).toContain('enabled boolean NOT NULL DEFAULT false');
    expect(migration).toContain('voip_start_call');
    expect(migration).toContain('cleaner_city_ride');
  });

  it('mints LiveKit JWTs and sends PushKit VoIP APNs', () => {
    expect(livekit).toContain('LIVEKIT_API_KEY');
    expect(livekit).toContain('mintLiveKitParticipantToken');
    expect(edge).toContain('livekit_not_configured');
    expect(edge).toContain('voip_incoming');
    expect(edge).toContain('ios_pushkit');
    expect(apnsVoip).toContain('apns-push-type');
    expect(apnsVoip).toContain('voip');
    expect(apnsVoip).toContain('.voip');
  });

  it('wires CallButton on Cleaner City rides with honesty copy', () => {
    expect(ride).toContain('CallButton');
    expect(ride).toContain('resolveCleanerCityRideCall');
    expect(callButton).toContain('In-app calling not live yet');
    expect(callButton).toContain('sociva-call-honesty');
  });

  it('registers native PushKit/CallKit and Android plugin', () => {
    expect(androidPlugin).toContain('SocivaVoip');
    expect(androidPlugin).toContain('RECORD_AUDIO');
    expect(iosPlugin).toContain('PKPushRegistry');
    expect(iosPlugin).toContain('CXProvider');
    expect(iosPlugin).toContain('reportNewIncomingCall');
    expect(mainActivity).toContain('SocivaVoipPlugin');
    expect(codemagic).toContain('SocivaVoipPlugin.swift');
    expect(codemagic).toContain('string voip');
  });

  it('resolves contexts without em dash', () => {
    expect(resolveCleanerCityRideCall('abc').contextType).toBe('cleaner_city_ride');
    expect(resolveOrderCall('oid', true).contextType).toBe('seller_order');
    for (const src of [migration, edge, callButton, ride, iosPlugin, apnsVoip]) {
      expect(src).not.toMatch(/[\u2013\u2014]/);
    }
  });
});
