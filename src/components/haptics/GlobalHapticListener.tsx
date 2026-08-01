// @ts-nocheck
import { useEffect } from 'react';
import { Capacitor } from '@capacitor/core';
import { hapticSelection } from '@/lib/haptics';

/**
 * Global click listener that triggers a subtle haptic "tick" on every
 * interactive element tap (links, buttons, inputs, etc.) — mimicking
 * the tactile feedback found in apps like Blinkit.
 *
 * The haptics module is pre-loaded at app startup (lib/haptics.ts),
 * so calls here are instant — no dynamic import latency.
 */
export function GlobalHapticListener() {
  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return;

    const INTERACTIVE = 'a, button, [role="button"], [role="tab"], [role="menuitem"], [role="link"], input, select, textarea, [data-haptic]';

    const handleClick = (e: Event) => {
      const target = e.target as HTMLElement;
      if (!target) return;
      if (target.closest(INTERACTIVE)) {
        hapticSelection();
      }
    };

    document.addEventListener('click', handleClick, { capture: true, passive: true });
    return () => {
      document.removeEventListener('click', handleClick, { capture: true } as EventListenerOptions);
    };
  }, []);

  return null;
}
