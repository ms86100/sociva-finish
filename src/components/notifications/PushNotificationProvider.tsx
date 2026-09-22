// @ts-nocheck
import { useEffect, useContext, useRef } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { usePushNotificationsInternal } from '@/hooks/usePushNotifications';
import { PushNotificationContext } from '@/contexts/PushNotificationContext';
import { IdentityContext } from '@/contexts/auth/contexts';
import { supabase } from '@/integrations/supabase/client';
import {
  claimInstallationToUser,
  releaseInstallationUser,
  syncOsPermissionsFromDevice,
} from '@/lib/installation';

interface PushNotificationProviderProps {
  children: React.ReactNode;
}

/**
 * Single provider that owns ALL push notification side effects.
 * Must be mounted exactly once in the component tree (App.tsx).
 *
 * Phase 1: also owns installation lifecycle boot + claim/release.
 * device_tokens remains the push delivery source of truth.
 */
export function PushNotificationProvider({ children }: PushNotificationProviderProps) {
  const identity = useContext(IdentityContext);
  const user = identity?.user ?? null;
  const queryClient = useQueryClient();

  // This is the ONLY place the full hook (with listeners + effects) runs
  const pushState = usePushNotificationsInternal();
  const { removeTokenFromDatabase } = pushState;
  const prevUserRef = useRef(user);

  // Boot: ensure installation row + sync OS permission enums (guest-safe)
  useEffect(() => {
    void syncOsPermissionsFromDevice({ claimUser: !!user?.id });
  }, []);

  // Resume: refresh permission enums if user changed them in OS Settings
  useEffect(() => {
    let remove: (() => void) | undefined;
    (async () => {
      try {
        const { App } = await import('@capacitor/app');
        const handle = await App.addListener('appStateChange', ({ isActive }) => {
          if (isActive) {
            void syncOsPermissionsFromDevice({ claimUser: !!user?.id });
          }
        });
        remove = () => handle.remove();
      } catch {
        // web / unsupported
      }
    })();
    return () => remove?.();
  }, [user?.id]);

  // Login: claim this physical install → user (installation_id never rotates)
  useEffect(() => {
    if (!user?.id) return;
    void (async () => {
      await claimInstallationToUser();
      await syncOsPermissionsFromDevice({ claimUser: true });
    })();
  }, [user?.id]);

  // Logout: remove delivery token for THIS device; release user_id on install only
  useEffect(() => {
    if (prevUserRef.current && !user) {
      removeTokenFromDatabase();
      // Keep installation_id + permission enums so User B (or A) can reclaim
      void releaseInstallationUser();
    }
    prevUserRef.current = user;
  }, [user, removeTokenFromDatabase]);

  // Realtime: invalidate on INSERT (new notif) and UPDATE (cross-device mark-read /
  // server-side terminal supersession). Bridges polling gap so bell + inbox stay fresh.
  useEffect(() => {
    if (!user?.id) return;
    const invalidateInbox = () => {
      queryClient.invalidateQueries({ queryKey: ['unread-notifications'] });
      queryClient.invalidateQueries({ queryKey: ['notifications'] });
      queryClient.invalidateQueries({ queryKey: ['latest-action-notification'] });
    };
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
        invalidateInbox,
      )
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'user_notifications',
          filter: `user_id=eq.${user.id}`,
        },
        invalidateInbox,
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
