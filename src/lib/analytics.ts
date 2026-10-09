/**
 * Thin Sociva analytics facade for the Amplitude Unified SDK (Browser + Session Replay).
 * The SDK itself loads on demand so it is not part of the first-paint download.
 * No-ops when VITE_AMPLITUDE_API_KEY is missing.
 */

import {
  type AnalyticsEventName,
  type AnalyticsProps,
  isAnalyticsEventName,
} from '@/lib/analytics-events';
import { sanitizeAnalyticsProps } from '@/lib/analytics-privacy';
import { persistAnalyticsFact } from '@/lib/analytics-facts';
import { identifyTraitsForAmplitude } from '@/lib/marketplace-intelligence';
import type * as AnalyticsSdkTypes from '@/lib/analytics-sdk';

const REPLAY_OPT_IN_KEY = 'sociva_analytics_replay_opt_in';
/** How long push / campaign attribution sticks on subsequent events (30 min). */
const ATTRIBUTION_TTL_MS = 30 * 60 * 1000;

type AmplitudeSdk = typeof AnalyticsSdkTypes;

type AttributionBag = Record<string, string | number | boolean | null | undefined> & {
  _expires_at?: number;
};

type PendingCall =
  | { kind: 'track'; name: string; props: Record<string, unknown> }
  | { kind: 'identify'; userId: string; traits: Record<string, unknown>; replayOptIn: boolean }
  | { kind: 'setUserProperties'; traits: Record<string, unknown> }
  | { kind: 'setReplayOptIn'; enabled: boolean }
  | { kind: 'reset' };

let sdk: AmplitudeSdk | null = null;
let ready = false;
let disabled = false;
let starting: Promise<void> | null = null;
const pending: PendingCall[] = [];

let attributionBag: AttributionBag = {};

/**
 * Short-lived campaign / push attribution merged into subsequent track() props.
 * Cleared on logout via resetAnalytics().
 */
export function setAttribution(
  props: Record<string, string | number | boolean | null | undefined>,
  ttlMs: number = ATTRIBUTION_TTL_MS,
): void {
  const next: AttributionBag = { ...attributionBag };
  for (const [k, v] of Object.entries(props)) {
    if (v === undefined) continue;
    next[k] = v;
  }
  next._expires_at = Date.now() + ttlMs;
  attributionBag = next;
}

export function getAttribution(): AnalyticsProps {
  const exp = attributionBag._expires_at;
  if (typeof exp === 'number' && Date.now() > exp) {
    attributionBag = {};
    return {};
  }
  const { _expires_at: _, ...rest } = attributionBag;
  return rest;
}

export function clearAttribution(): void {
  attributionBag = {};
}

function apiKey(): string {
  return String(import.meta.env.VITE_AMPLITUDE_API_KEY || '')
    .replace(/^["']|["']$/g, '')
    .trim();
}

export function isAnalyticsEnabled(): boolean {
  return ready && Boolean(apiKey());
}

export function getReplayOptIn(): boolean {
  try {
    return localStorage.getItem(REPLAY_OPT_IN_KEY) === '1';
  } catch {
    return false;
  }
}

function sanitizedTraits(
  traits: Record<string, string | number | boolean | null | undefined>,
): Record<string, unknown> {
  return sanitizeAnalyticsProps(
    identifyTraitsForAmplitude(traits) as Record<string, unknown>,
  );
}

function applyCall(call: PendingCall): void {
  if (!sdk) return;
  try {
    switch (call.kind) {
      case 'track':
        sdk.sdkTrack(call.name, call.props);
        break;
      case 'identify':
        sdk.sdkIdentify(call.userId, call.traits, call.replayOptIn);
        break;
      case 'setUserProperties':
        sdk.sdkSetUserProperties(call.traits);
        break;
      case 'setReplayOptIn':
        sdk.sdkSetReplayOptIn(call.enabled);
        break;
      case 'reset':
        sdk.sdkReset();
        break;
      default:
        break;
    }
  } catch (err) {
    console.warn('[Analytics] call failed', err);
  }
}

function flushPending(): void {
  while (pending.length) {
    const call = pending.shift();
    if (call) applyCall(call);
  }
}

function enqueue(call: PendingCall): void {
  if (disabled) return;
  if (ready) {
    applyCall(call);
    return;
  }
  pending.push(call);
}

export function setReplayOptIn(enabled: boolean): void {
  try {
    localStorage.setItem(REPLAY_OPT_IN_KEY, enabled ? '1' : '0');
  } catch {
    // ignore
  }
  enqueue({ kind: 'setReplayOptIn', enabled });
}

export function initAnalytics(): boolean {
  const key = apiKey();
  if (!key) {
    console.warn('Amplitude API key missing - analytics disabled');
    disabled = true;
    pending.length = 0;
    return false;
  }
  if (ready) return true;
  if (!starting) {
    starting = import('@/lib/analytics-sdk')
      .then((mod) => {
        mod.startAmplitude(key);
        sdk = mod;
        flushPending();
        ready = true;
        flushPending();
      })
      .catch((err) => {
        console.warn('[Analytics] init failed', err);
        starting = null;
      });
  }
  return true;
}

export function track(event: AnalyticsEventName | string, props?: AnalyticsProps): void {
  const name = String(event || '').trim();
  if (!name) return;
  if (!isAnalyticsEventName(name) && import.meta.env.DEV) {
    console.warn('[Analytics] Unknown event name (still sent):', name);
  }
  const merged: AnalyticsProps = { ...getAttribution(), ...props };
  const safe = sanitizeAnalyticsProps(merged as Record<string, unknown>);
  void persistAnalyticsFact(name, safe);
  enqueue({ kind: 'track', name, props: safe });
}

export function identify(
  userId: string,
  traits?: Record<string, string | number | boolean | null | undefined>,
): void {
  if (!userId) return;
  enqueue({
    kind: 'identify',
    userId,
    traits: sanitizedTraits(traits || {}),
    replayOptIn: getReplayOptIn(),
  });
}

export function setUserProperties(
  traits: Record<string, string | number | boolean | null | undefined>,
): void {
  enqueue({ kind: 'setUserProperties', traits: sanitizedTraits(traits) });
}

export function resetAnalytics(): void {
  clearAttribution();
  enqueue({ kind: 'reset' });
}

/** Convenience namespace matching the plan's analytics.track style */
export const analytics = {
  init: initAnalytics,
  track,
  identify,
  reset: resetAnalytics,
  setUserProperties,
  isEnabled: isAnalyticsEnabled,
  getReplayOptIn,
  setReplayOptIn,
  setAttribution,
  getAttribution,
  clearAttribution,
};
