import { useCallback, useMemo } from 'react';
import {
  hapticSelection,
  hapticImpact,
  hapticNotification,
  hapticVibrate,
  hapticSelectionSession,
  type HapticImpactStyle,
  type HapticNotificationType,
} from '@/lib/haptics';

/**
 * React hook wrapper around the centralized haptics engine.
 * Returns stable references — safe to use in deps arrays.
 */
export function useHaptics() {
  const impact = useCallback((style: HapticImpactStyle = 'medium') => {
    hapticImpact(style);
  }, []);

  const notification = useCallback((type: HapticNotificationType = 'success') => {
    hapticNotification(type);
  }, []);

  const vibrate = useCallback((duration: number = 300) => {
    hapticVibrate(duration);
  }, []);

  const selectionChanged = useCallback(() => {
    hapticSelection();
  }, []);

  const selectionSession = useCallback((phase: 'start' | 'changed' | 'end') => {
    hapticSelectionSession(phase);
  }, []);

  return useMemo(
    () => ({ impact, notification, vibrate, selectionChanged, selectionSession }),
    [impact, notification, vibrate, selectionChanged, selectionSession],
  );
}
