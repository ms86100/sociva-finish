/**
 * Helpers that mirror App.tsx MotionConfig reducedMotion="user"
 * and CSS prefers-reduced-motion blocks in index.css.
 */

export function prefersReducedMotion(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
    return false;
  }
  try {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch {
    return false;
  }
}

/** Instant transition when user prefers reduced motion; otherwise use provided ms/s. */
export function motionDuration(seconds: number): number {
  return prefersReducedMotion() ? 0 : seconds;
}

/** Skip infinite loops (shimmer, pulse) when reduced motion is on. */
export function allowLoopingMotion(): boolean {
  return !prefersReducedMotion();
}
