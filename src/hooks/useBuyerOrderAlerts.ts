// @ts-nocheck
import { useEffect, useContext } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { IdentityContext } from '@/contexts/auth/contexts';
import { hapticNotification } from '@/lib/haptics';
import { useQueryClient } from '@tanstack/react-query';

/**
 * Real-time listener for buyer order status updates.
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

    const channel = supabase
      .channel(`buyer-order-updates-${user.id}`)
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'orders',
          filter: `buyer_id=eq.${user.id}`,
        },
        (payload) => {
          const newStatus = (payload.new as any)?.status;
          const oldStatus = (payload.old as any)?.status;
          const newPayment = (payload.new as any)?.payment_status;
          const oldPayment = (payload.old as any)?.payment_status;
          const statusChanged = newStatus && newStatus !== 'pending' && newStatus !== oldStatus;
          const paymentChanged = newPayment && newPayment !== oldPayment;
          // Only react to actual status or payment_status changes
          if (!statusChanged && !paymentChanged) return;
          // Suppress phantom alerts for payment_pending orders (auto-cancelled, no user-facing notification)
          if (oldStatus === 'payment_pending') return;

          // Native haptic feedback
          const hapticType = statusChanged ? (HAPTIC_MAP[newStatus] ?? 'success') : 'success';
          hapticNotification(hapticType);

          // Keep all queries fresh
          queryClient.invalidateQueries({ queryKey: ['orders'] });
          queryClient.invalidateQueries({ queryKey: ['unread-notifications'] });
          queryClient.invalidateQueries({ queryKey: ['notifications'] });
          queryClient.invalidateQueries({ queryKey: ['active-orders-strip'] });
          queryClient.invalidateQueries({ queryKey: ['latest-action-notification'] });
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [user?.id, queryClient]);
}
