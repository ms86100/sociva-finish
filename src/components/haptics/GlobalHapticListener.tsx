import { useEffect } from 'react';
import { Capacitor } from '@capacitor/core';
import { hapticImpact, hapticSelection } from '@/lib/haptics';

/**
 * Global listener: subtle tick on meaningful interactive controls.
 * Engine throttle collapses double-fires with explicit haptic callers.
 *
 * data-haptic values:
 *   off | selection (default) | light | medium | confirm | heavy | destructive
 */
const INTERACTIVE =
  'a, button, [role="button"], [role="tab"], [role="menuitem"], [role="link"], [role="switch"], [role="checkbox"], [role="radio"], [role="option"], input[type="button"], input[type="submit"], input[type="checkbox"], input[type="radio"], select, summary, [data-haptic]:not([data-haptic="off"])';

function isDisabledControl(el: HTMLElement): boolean {
  return !!el.closest('[disabled], [aria-disabled="true"], [data-disabled], [data-haptic="off"]');
}

function fireForControl(control: HTMLElement): void {
  const raw = (
    control.getAttribute('data-haptic') ||
    control.closest('[data-haptic]')?.getAttribute('data-haptic') ||
    'selection'
  )?.toLowerCase();

  if (raw === 'off') return;
  if (raw === 'medium' || raw === 'confirm') {
    hapticImpact('medium');
    return;
  }
  if (raw === 'heavy' || raw === 'destructive') {
    hapticImpact('heavy');
    return;
  }
  // selection | light | true | empty
  hapticSelection();
}

export function GlobalHapticListener() {
  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return;

    const handleActivate = (e: Event) => {
      const target = e.target as HTMLElement | null;
      if (!target || typeof target.closest !== 'function') return;
      const control = target.closest(INTERACTIVE) as HTMLElement | null;
      if (!control || isDisabledControl(control)) return;
      fireForControl(control);
    };

    const onPointerDown = (e: PointerEvent) => {
      if (e.button !== 0) return;
      handleActivate(e);
    };

    document.addEventListener('pointerdown', onPointerDown, { capture: true, passive: true });
    document.addEventListener('click', handleActivate, { capture: true, passive: true });

    return () => {
      document.removeEventListener('pointerdown', onPointerDown, { capture: true } as EventListenerOptions);
      document.removeEventListener('click', handleActivate, { capture: true } as EventListenerOptions);
    };
  }, []);

  return null;
}
