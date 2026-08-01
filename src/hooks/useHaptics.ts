// @ts-nocheck
import { useCallback, useMemo } from 'react';
import { hapticSelection, hapticImpact, hapticNotification, hapticVibrate } from '@/lib/haptics';

type ImpactStyle = 'light' | 'medium' | 'heavy';
type NotificationType = 'success' | 'warning' | 'error';

/**
 * React hook wrapper around the centralized haptics engine.
 * Returns stable references — safe to use in deps arrays.
 * 
 * All heavy lifting (plugin loading, platform checks) is handled
 * by lib/haptics.ts at app startup. This hook is pure wiring.
 */
export function useHaptics() {
  const impact = useCallback((style: ImpactStyle = 'medium') => {
    hapticImpact(style);
  }, []);

  const notification = useCallback((type: NotificationType = 'success') => {
    hapticNotification(type);
  }, []);

  const vibrate = useCallback((duration: number = 300) => {
    hapticVibrate(duration);
  }, []);

  const selectionChanged = useCallback(() => {
    hapticSelection();
  }, []);

  return useMemo(() => ({ impact, notification, vibrate, selectionChanged }), [impact, notification, vibrate, selectionChanged]);
}
