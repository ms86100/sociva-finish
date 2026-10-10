// @ts-nocheck
import { useEffect, useRef } from 'react';
import { registerBackInterceptor, type BackInterceptorOptions } from '@/lib/navigation-stack';

/**
 * Consume Back while this UI is active.
 * `overlay` wins over dialogs (chat, map confirm, booking review).
 * `page` runs after dialogs (onboarding and form steps).
 */
export function useBackInterceptor(
  enabled: boolean,
  handler: () => void,
  kind: 'overlay' | 'page' = 'page',
  options?: BackInterceptorOptions,
) {
  const handlerRef = useRef(handler);
  handlerRef.current = handler;
  const systemOnly = options?.systemOnly === true;

  useEffect(() => {
    if (!enabled) return undefined;
    return registerBackInterceptor(kind, () => {
      handlerRef.current();
      return true;
    }, { systemOnly });
  }, [enabled, kind, systemOnly]);
}
