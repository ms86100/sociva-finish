// @ts-nocheck
/**
 * Centralized Haptic Feedback Engine
 * 
 * Pre-loads the Capacitor Haptics plugin at app startup so every
 * subsequent call is instant (no dynamic import latency).
 * 
 * Intensity guide (Blinkit-style):
 *   • selectionChanged  → tab switches, page navigation, passive taps
 *   • impact('light')   → minor UI interactions
 *   • impact('medium')  → add-to-cart, quantity change
 *   • impact('heavy')   → destructive actions
 *   • notification('success') → order placed, checkout complete
 *   • notification('warning') → validation warning
 *   • notification('error')   → error feedback
 * 
 * On web this module is a complete no-op (zero overhead).
 * On native it respects system haptic settings automatically via
 * the Capacitor Haptics plugin (UIFeedbackGenerator on iOS).
 */
import { Capacitor } from '@capacitor/core';

type HapticsPlugin = typeof import('@capacitor/haptics');

// ── Module-level state ──────────────────────────────────────────────
const isNative = Capacitor.isNativePlatform();
let _mod: HapticsPlugin | null = null;
let _loading: Promise<HapticsPlugin | null> | null = null;

/**
 * Call once at app startup (capacitor.ts). On web this is a no-op.
 * After this resolves, all haptic calls are synchronous plugin invocations.
 */
export function preloadHaptics(): Promise<void> {
  if (!isNative) return Promise.resolve();
  if (_mod) return Promise.resolve();
  if (!_loading) {
    _loading = import('@capacitor/haptics')
      .then((mod) => { _mod = mod; return mod; })
      .catch((err) => { console.warn('[Haptics] Failed to load:', err); return null; });
  }
  return _loading.then(() => {});
}

// ── Public API ──────────────────────────────────────────────────────

/** Light tactile tick — for navigation, tab switches, passive taps */
export function hapticSelection(): void {
  if (!_mod) return;
  _mod.Haptics.selectionChanged().catch(() => {});
}

/** Impact feedback at varying intensity */
export function hapticImpact(style: 'light' | 'medium' | 'heavy' = 'medium'): void {
  if (!_mod) return;
  const styleMap = {
    light: _mod.ImpactStyle.Light,
    medium: _mod.ImpactStyle.Medium,
    heavy: _mod.ImpactStyle.Heavy,
  };
  _mod.Haptics.impact({ style: styleMap[style] }).catch(() => {});
}

/** Notification feedback — success / warning / error */
export function hapticNotification(type: 'success' | 'warning' | 'error' = 'success'): void {
  if (!_mod) return;
  const typeMap = {
    success: _mod.NotificationType.Success,
    warning: _mod.NotificationType.Warning,
    error: _mod.NotificationType.Error,
  };
  _mod.Haptics.notification({ type: typeMap[type] }).catch(() => {});
}

/** Vibrate for a duration (Android-style, fallback on iOS) */
export function hapticVibrate(duration = 300): void {
  if (!_mod) return;
  _mod.Haptics.vibrate({ duration }).catch(() => {});
}
