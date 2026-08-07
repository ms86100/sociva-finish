// @ts-nocheck
import { useEffect, useContext } from 'react';
import { IdentityContext } from '@/contexts/auth/contexts';
import { hapticNotification } from '@/lib/haptics';
import { useQueryClient } from '@tanstack/react-query';
import { subscribeBuyerOrderUpdates } from '@/lib/buyer-orders-realtime-bus';

/**
 * Buyer order status alerts via the shared realtime bus.
 * Drives query invalidation + native haptics only — no toasts.
 */

const HAPTIC_MAP: Record<string, 'success' | 'warning' | 'error'> = {
  accepted: 'success',
  preparing: 'success',
  ready: 'success',
  picked_up: 'success',
  on_the_way: 'success',
  delivered: 'success',
  completed: 'success',
  cancelled: 'error',
  quoted: 'success',
  scheduled: 'success',
  failed: 'error',
};

export function useBuyerOrderAlerts() {
  const identity = useContext(IdentityContext);
  const user = identity?.user ?? null;
  const queryClient = useQueryClient();

  useEffect(() => {
    if (!user?.id) return;

    return subscribeBuyerOrderUpdates(user.id, (payload) => {
      const newStatus = payload.new?.status as string | undefined;
      const oldStatus = payload.old?.status as string | undefined;
      const newPayment = payload.new?.payment_status as string | undefined;
      const oldPayment = payload.old?.payment_status as string | undefined;
      const statusChanged = !!newStatus && newStatus !== 'pending' && newStatus !== oldStatus;
      const paymentChanged = !!newPayment && newPayment !== oldPayment;
      if (!statusChanged && !paymentChanged) return;
      if (oldStatus === 'payment_pending') return;

      const hapticType = statusChanged ? (HAPTIC_MAP[newStatus] ?? 'success') : 'success';
      hapticNotification(hapticType);

      queryClient.invalidateQueries({ queryKey: ['orders'] });
      queryClient.invalidateQueries({ queryKey: ['unread-notifications'] });
      queryClient.invalidateQueries({ queryKey: ['notifications'] });
      queryClient.invalidateQueries({ queryKey: ['active-orders-strip'] });
      queryClient.invalidateQueries({ queryKey: ['latest-action-notification'] });
    });
  }, [user?.id, queryClient]);
}
