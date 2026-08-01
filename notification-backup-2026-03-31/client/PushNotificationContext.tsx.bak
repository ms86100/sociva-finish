import { createContext, useContext } from 'react';

export interface PushNotificationContextValue {
  token: string | null;
  permissionStatus: 'granted' | 'denied' | 'prompt';
  registerPushNotifications: () => Promise<void>;
  requestFullPermission: () => Promise<void>;
  removeTokenFromDatabase: () => Promise<void>;
}

export const PushNotificationContext = createContext<PushNotificationContextValue | null>(null);

/**
 * Lightweight consumer hook — does NOT create any side effects.
 * All registration logic lives exclusively in PushNotificationProvider.
 */
export function usePushNotifications(): PushNotificationContextValue {
  const ctx = useContext(PushNotificationContext);
  if (!ctx) {
    // Fallback for non-native / outside provider — safe no-ops
    return {
      token: null,
      permissionStatus: 'prompt',
      registerPushNotifications: async () => {},
      requestFullPermission: async () => {},
      removeTokenFromDatabase: async () => {},
    };
  }
  return ctx;
}
