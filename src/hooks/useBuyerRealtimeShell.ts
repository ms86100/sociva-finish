// @ts-nocheck
/**
 * Route-level hook that activates buyer realtime listeners.
 * Only mount this on buyer-facing pages that need live order updates
 * (Home, Orders, OrderDetail) — NOT globally in the app shell.
 */
import { useBuyerOrderAlerts } from '@/hooks/useBuyerOrderAlerts';
import { useLiveActivityOrchestrator } from '@/hooks/useLiveActivityOrchestrator';

export function useBuyerRealtimeShell() {
  useBuyerOrderAlerts();
  useLiveActivityOrchestrator();
}
