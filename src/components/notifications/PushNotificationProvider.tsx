// @ts-nocheck
import { useEffect, useContext, useRef } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { usePushNotificationsInternal } from '@/hooks/usePushNotifications';
import { PushNotificationContext } from '@/contexts/PushNotificationContext';
import { IdentityContext } from '@/contexts/auth/contexts';
import { supabase } from '@/integrations/supabase/client';

interface PushNotificationProviderProps {
  children: React.ReactNode;
}

/**
 * Single provider that owns ALL push notification side effects.
 * Must be mounted exactly once in the component tree (App.tsx).
 */
export function PushNotificationProvider({ children }: PushNotificationProviderProps) {
  const identity = useContext(IdentityContext);
  const user = identity?.user ?? null;
  const queryClient = useQueryClient();

  // This is the ONLY place the full hook (with listeners + effects) runs
  const pushState = usePushNotificationsInternal();
  const { removeTokenFromDatabase } = pushState;
  const prevUserRef = useRef(user);

  // Remove token on explicit logout (user transitions non-null → null)
  useEffect(() => {
    if (prevUserRef.current && !user) {
      removeTokenFromDatabase();
    }
    prevUserRef.current = user;
  }, [user, removeTokenFromDatabase]);

  // Realtime: invalidate notification queries the moment a new row lands.
  // Bridges the up-to-60s polling gap so the bell + inbox react in <1s.
  useEffect(() => {
    if (!user?.id) return;
    const channel = supabase
      .channel(`user-notifications-${user.id}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'user_notifications',
          filter: `user_id=eq.${user.id}`,
        },
        () => {
          queryClient.invalidateQueries({ queryKey: ['unread-notifications'] });
          queryClient.invalidateQueries({ queryKey: ['notifications'] });
          queryClient.invalidateQueries({ queryKey: ['latest-action-notification'] });
        },
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [user?.id, queryClient]);

  return (
    <PushNotificationContext.Provider value={pushState}>
      {children}
    </PushNotificationContext.Provider>
  );
}
