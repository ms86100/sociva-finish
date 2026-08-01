// @ts-nocheck
import { createContext, useContext } from 'react';

export interface PushNotificationContextValue {
  token: string | null;
  permissionStatus: 'granted' | 'denied' | 'prompt';
  registerPushNotifications: () => Promise<void>;
  requestFullPermission: () => Promise<void>;
  removeTokenFromDatabase: () => Promise<void>;
}

export const PushNotificationContext = createContext<PushNotificationContextValue | null>(null);

export function usePushNotifications(): PushNotificationContextValue {
  const ctx = useContext(PushNotificationContext);
  if (!ctx) {
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
