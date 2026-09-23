/**
 * Thin Sociva analytics facade → Amplitude Unified SDK (Browser + Session Replay).
 * No-ops when VITE_AMPLITUDE_API_KEY is missing.
 */

import * as amplitude from '@amplitude/unified';
import {
  type AnalyticsEventName,
  type AnalyticsProps,
  isAnalyticsEventName,
} from '@/lib/analytics-events';
import { sanitizeAnalyticsProps } from '@/lib/analytics-privacy';

const REPLAY_OPT_IN_KEY = 'sociva_analytics_replay_opt_in';
/** How long push / campaign attribution sticks on subsequent events (30 min). */
const ATTRIBUTION_TTL_MS = 30 * 60 * 1000;

let initialized = false;

type AttributionBag = Record<string, string | number | boolean | null | undefined> & {
  _expires_at?: number;
};

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
  return initialized && Boolean(apiKey());
}

export function getReplayOptIn(): boolean {
  try {
    return localStorage.getItem(REPLAY_OPT_IN_KEY) === '1';
  } catch {
    return false;
  }
}

export function setReplayOptIn(enabled: boolean): void {
  try {
    localStorage.setItem(REPLAY_OPT_IN_KEY, enabled ? '1' : '0');
  } catch {
    // ignore
  }
  if (!initialized) return;
  try {
    const id = new amplitude.Identify();
    id.set('replay_opt_in', enabled);
    amplitude.identify(id);
  } catch {
    // ignore
  }
}

export function initAnalytics(): boolean {
  const key = apiKey();
  if (!key) {
    console.warn('Amplitude API key missing — analytics disabled');
    return false;
  }
  if (initialized) return true;

  try {
    // Unified Browser Analytics + Session Replay — init once for the app lifecycle.
    void amplitude.initAll(key, {
      analytics: { autocapture: true },
      sessionReplay: { sampleRate: 1 },
    });
    initialized = true;

    // Wizard first event (load-time). Safe to remove prompt_version after Setup confirms.
    amplitude.track('Viewed Home Page', { prompt_version: 'BA400.4' }); // helps improve this setup flow — safe to remove once you've verified the event lands
    return true;
  } catch (err) {
    console.warn('[Analytics] init failed', err);
    initialized = false;
    return false;
  }
}

export function track(event: AnalyticsEventName | string, props?: AnalyticsProps): void {
  if (!initialized) return;
  const name = String(event || '').trim();
  if (!name) return;
  if (!isAnalyticsEventName(name) && import.meta.env.DEV) {
    console.warn('[Analytics] Unknown event name (still sent):', name);
  }
  try {
    const merged: AnalyticsProps = { ...getAttribution(), ...props };
    amplitude.track(name, sanitizeAnalyticsProps(merged as Record<string, unknown>));
  } catch (err) {
    console.warn('[Analytics] track failed', err);
  }
}

export function identify(
  userId: string,
  traits?: Record<string, string | number | boolean | null | undefined>,
): void {
  if (!initialized || !userId) return;
  try {
    const id = new amplitude.Identify();
    const safe = sanitizeAnalyticsProps(traits as Record<string, unknown>);
    for (const [k, v] of Object.entries(safe)) {
      if (v === null) id.unset(k);
      else id.set(k, v as string | number | boolean);
    }
    id.set('replay_opt_in', getReplayOptIn());
    amplitude.setUserId(userId);
    amplitude.identify(id);
  } catch (err) {
    console.warn('[Analytics] identify failed', err);
  }
}

export function setUserProperties(
  traits: Record<string, string | number | boolean | null | undefined>,
): void {
  if (!initialized) return;
  try {
    const id = new amplitude.Identify();
    const safe = sanitizeAnalyticsProps(traits as Record<string, unknown>);
    for (const [k, v] of Object.entries(safe)) {
      if (v === null) id.unset(k);
      else id.set(k, v as string | number | boolean);
    }
    amplitude.identify(id);
  } catch (err) {
    console.warn('[Analytics] setUserProperties failed', err);
  }
}

export function resetAnalytics(): void {
  clearAttribution();
  if (!initialized) return;
  try {
    amplitude.reset();
  } catch (err) {
    console.warn('[Analytics] reset failed', err);
  }
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
