/**
 * Amplitude Unified SDK (Browser + Session Replay).
 * Loaded only after first paint so it stays off the startup download.
 */

import * as amplitude from '@amplitude/unified';

export function startAmplitude(key: string): void {
  // Unified Browser Analytics + Session Replay - init once for the app lifecycle.
  void amplitude.initAll(key, {
    analytics: { autocapture: true },
    sessionReplay: { sampleRate: 1 },
  });

  // Wizard first event (load-time). Safe to remove prompt_version after Setup confirms.
  amplitude.track('Viewed Home Page', { prompt_version: 'BA400.4' });
}

export function sdkTrack(name: string, props: Record<string, unknown>): void {
  amplitude.track(name, props);
}

export function sdkIdentify(
  userId: string,
  traits: Record<string, unknown>,
  replayOptIn: boolean,
): void {
  const id = new amplitude.Identify();
  for (const [k, v] of Object.entries(traits)) {
    if (v === null) id.unset(k);
    else if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') id.set(k, v);
  }
  id.set('replay_opt_in', replayOptIn);
  amplitude.setUserId(userId);
  amplitude.identify(id);
}

export function sdkSetUserProperties(traits: Record<string, unknown>): void {
  const id = new amplitude.Identify();
  for (const [k, v] of Object.entries(traits)) {
    if (v === null) id.unset(k);
    else if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') id.set(k, v);
  }
  amplitude.identify(id);
}

export function sdkSetReplayOptIn(enabled: boolean): void {
  const id = new amplitude.Identify();
  id.set('replay_opt_in', enabled);
  amplitude.identify(id);
}

export function sdkReset(): void {
  amplitude.reset();
}
