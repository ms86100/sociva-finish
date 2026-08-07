/**
 * Centralized Haptic Feedback Engine
 *
 * Stack: Capacitor `@capacitor/haptics` (iOS UIFeedbackGenerator / Android Vibrator).
 *
 * IMPORTANT — Capacitor quirk (iOS + Android + web stubs):
 *   `Haptics.selectionChanged()` is a silent no-op unless `selectionStart()`
 *   was called first. Our UI needs one-shot ticks on taps, so `hapticSelection()`
 *   maps to a light impact (and optionally a managed selection session for
 *   continuous controls via `hapticSelectionSession`).
 *
 * Intensity guide:
 *   • selection / light  → tab switches, toggles, passive taps
 *   • impact('medium')   → add-to-cart, quantity change, primary actions
 *   • impact('heavy')    → destructive confirmations
 *   • notification(*)    → success / warning / error outcomes
 *   • vibrate(ms)        → long alerts (incoming order) — prefer sparingly
 *
 * Accessibility: respects `prefers-reduced-motion: reduce`.
 * Performance: per-style throttle avoids double-fire (global listener + explicit).
 */
import { Capacitor } from '@capacitor/core';
import {
  Haptics,
  ImpactStyle,
  NotificationType,
} from '@capacitor/haptics';

export type HapticImpactStyle = 'light' | 'medium' | 'heavy';
export type HapticNotificationType = 'success' | 'warning' | 'error';

const IMPACT_MAP: Record<HapticImpactStyle, ImpactStyle> = {
  light: ImpactStyle.Light,
  medium: ImpactStyle.Medium,
  heavy: ImpactStyle.Heavy,
};

const NOTIFICATION_MAP: Record<HapticNotificationType, NotificationType> = {
  success: NotificationType.Success,
  warning: NotificationType.Warning,
  error: NotificationType.Error,
};

/** Min gap between identical haptic kinds (ms) — kills GlobalHapticListener doubles. */
const THROTTLE_MS: Record<string, number> = {
  selection: 45,
  light: 45,
  medium: 55,
  heavy: 80,
  success: 120,
  warning: 120,
  error: 120,
  vibrate: 200,
};

const lastFiredAt = new Map<string, number>();
let selectionSessionOpen = false;
let reducedMotionCached: boolean | null = null;

function isNativeRuntime(): boolean {
  try {
    return Capacitor.isNativePlatform();
  } catch {
    return false;
  }
}

function prefersReducedMotion(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
    return false;
  }
  if (reducedMotionCached === null) {
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    reducedMotionCached = mq.matches;
    const sync = () => {
      reducedMotionCached = mq.matches;
    };
    if (typeof mq.addEventListener === 'function') {
      mq.addEventListener('change', sync);
    } else if (typeof mq.addListener === 'function') {
      mq.addListener(sync);
    }
  }
  return reducedMotionCached;
}

/** selection + light share one bucket (both map to ImpactStyle.Light). */
function throttleKey(kind: string): string {
  if (kind === 'selection' || kind === 'light') return 'tick';
  return kind;
}

function shouldFire(kind: string): boolean {
  if (!isNativeRuntime()) return false;
  if (prefersReducedMotion()) return false;
  const key = throttleKey(kind);
  const now = Date.now();
  const minGap = THROTTLE_MS[kind] ?? THROTTLE_MS[key] ?? 50;
  const last = lastFiredAt.get(key) ?? 0;
  if (now - last < minGap) return false;
  lastFiredAt.set(key, now);
  return true;
}

function fire(promise: Promise<void>): void {
  promise.catch((err) => {
    if (import.meta.env?.DEV) {
      console.warn('[Haptics] native call failed:', err);
    }
  });
}

/**
 * Warm UIFeedbackGenerator / ensure plugin bridge is live.
 * Safe to call multiple times; no-op on web.
 */
export function preloadHaptics(): Promise<void> {
  if (!isNativeRuntime()) return Promise.resolve();
  // Light no-op prepare: open/close a selection session so the first real
  // selectionSession tick is instant on iOS.
  return Haptics.selectionStart()
    .then(() => Haptics.selectionEnd())
    .then(() => {
      selectionSessionOpen = false;
    })
    .catch(() => {
      /* plugin unavailable — later calls still no-op safely */
    });
}

/**
 * One-shot UI tick for navigation, tabs, buttons, toggles.
 * Uses light impact because Capacitor's selectionChanged requires an open session.
 */
export function hapticSelection(): void {
  if (!shouldFire('selection')) return;
  fire(Haptics.impact({ style: ImpactStyle.Light }));
}

/** Impact feedback at varying intensity */
export function hapticImpact(style: HapticImpactStyle = 'medium'): void {
  if (!shouldFire(style)) return;
  fire(Haptics.impact({ style: IMPACT_MAP[style] }));
}

/** Notification feedback — success / warning / error */
export function hapticNotification(type: HapticNotificationType = 'success'): void {
  if (!shouldFire(type)) return;
  fire(Haptics.notification({ type: NOTIFICATION_MAP[type] }));
}

/** Vibrate for a duration (Android-strong; iOS continuous haptic when available) */
export function hapticVibrate(duration = 300): void {
  if (!shouldFire('vibrate')) return;
  fire(Haptics.vibrate({ duration }));
}

/**
 * Continuous selection session (pickers / scrubbers).
 * Call start → changed* → end. Standalone taps should use hapticSelection().
 */
export function hapticSelectionSession(
  phase: 'start' | 'changed' | 'end',
): void {
  if (!isNativeRuntime() || prefersReducedMotion()) return;

  if (phase === 'start') {
    selectionSessionOpen = true;
    fire(Haptics.selectionStart());
    return;
  }
  if (phase === 'end') {
    selectionSessionOpen = false;
    fire(Haptics.selectionEnd());
    return;
  }
  if (!selectionSessionOpen) {
    selectionSessionOpen = true;
    fire(
      Haptics.selectionStart().then(() => Haptics.selectionChanged()),
    );
    return;
  }
  if (!shouldFire('selection')) return;
  fire(Haptics.selectionChanged());
}

/** Test / diagnostics helper */
export function hapticsDiagnostics(): {
  native: boolean;
  reducedMotion: boolean;
  platform: string;
} {
  return {
    native: isNativeRuntime(),
    reducedMotion: prefersReducedMotion(),
    platform: Capacitor.getPlatform(),
  };
}
