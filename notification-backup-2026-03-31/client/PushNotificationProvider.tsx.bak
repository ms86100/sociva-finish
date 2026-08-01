import { useEffect, useContext, useRef } from 'react';
import { usePushNotificationsInternal } from '@/hooks/usePushNotifications';
import { PushNotificationContext } from '@/contexts/PushNotificationContext';
import { IdentityContext } from '@/contexts/auth/contexts';

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

  return (
    <PushNotificationContext.Provider value={pushState}>
      {children}
    </PushNotificationContext.Provider>
  );
}
