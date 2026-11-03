import { Capacitor } from '@capacitor/core';
import { type Transition } from 'framer-motion';

/** True on Capacitor Android/iOS WebViews - prefer lighter motion. */
export const isNativeMotion = (): boolean => Capacitor.isNativePlatform();

// ─── Duration Constants ──────────────────────────────────────────────────────
export const durations = {
  fast: 0.15,
  normal: 0.25,
  slow: 0.4,
  stagger: 0.06,
  /** Native grids use a tighter stagger to keep scroll FPS high */
  staggerNative: 0.04,
};

// ─── Easing Presets ──────────────────────────────────────────────────────────
export const easings = {
  /** Smooth deceleration - default for most entrances */
  easeOut: [0.16, 1, 0.3, 1] as const,
  /** Gentle spring-like overshoot */
  spring: { type: 'spring' as const, stiffness: 260, damping: 24 },
  /** Snappy spring - buttons, toggles */
  snappy: { type: 'spring' as const, stiffness: 400, damping: 17 },
  /** Soft spring - overlays, modals */
  soft: { type: 'spring' as const, stiffness: 200, damping: 20 },
  /** Bouncy - celebration moments */
  bouncy: { type: 'spring' as const, stiffness: 300, damping: 12 },
};

/** CSS custom property mirrors (index.css) for non-Framer transitions */
export const cssMotion = {
  durMicro: 'var(--dur-micro)',
  durMacro: 'var(--dur-macro)',
  easeStandard: 'var(--ease-standard)',
  easeEmphasized: 'var(--ease-emphasized)',
} as const;

/**
 * Cap Y travel on native so entrance animations stay cheap.
 * Pass a design travel in px; returns a smaller value on native.
 */
export function travelY(webPx: number, nativePx?: number): number {
  if (!isNativeMotion()) return webPx;
  return nativePx ?? Math.min(webPx, Math.round(webPx * 0.6));
}

/**
 * Stagger delay for grid/list children. Caps child count effect via delay.
 */
export function staggerDelay(): number {
  return isNativeMotion() ? durations.staggerNative : durations.stagger;
}

/** Max children that should stagger-enter before remaining appear instantly */
export const STAGGER_CHILD_CAP = 12;

export const progressSpring: Transition = {
  type: 'spring',
  stiffness: 80,
  damping: 15,
};
