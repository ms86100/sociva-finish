import { useEffect, useState, useCallback, useContext, useRef } from 'react';
import { Capacitor } from '@capacitor/core';
import { supabase } from '@/integrations/supabase/client';
import { IdentityContext } from '@/contexts/auth/contexts';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { hapticNotification } from '@/lib/haptics';
import { pushLog, setLogUser, flushPushLogs } from '@/lib/pushLogger';
import { LiveActivityManager } from '@/services/LiveActivityManager';
import { getTerminalStatuses } from '@/services/statusFlowCache';
import { resolveNotificationRoute } from '@/lib/notification-routes';
import { setPendingDeepLink } from '@/hooks/useDeepLinks';

/**
 * BUILD FINGERPRINT — bump on every push-related update.
 */
export const PUSH_BUILD_ID = '2026-03-07-DUAL-PLUGIN-V2-LISTENER-GATE';

type RegistrationState = 'idle' | 'registering' | 'registered' | 'failed';

// Module-level singleton guard
let activeInstanceId = 0;

/**
 * INTERNAL: Full hook with all side effects. Only called by PushNotificationProvider.
 *
 * Uses the PROVEN dual-plugin architecture:
 * - @capacitor/push-notifications → permissions, registration, raw APNs token on iOS
 * - @capacitor-community/fcm → FCM token on iOS (Android gets FCM token from registration event)
 */
export function usePushNotificationsInternal() {
  const [token, setToken] = useState<string | null>(null);
  const [permissionStatus, setPermissionStatus] = useState<'granted' | 'denied' | 'prompt'>('prompt');
  const identity = useContext(IdentityContext);
  const user = identity?.user ?? null;
  const navigate = useNavigate();
  const navigateRef = useRef(navigate);
  navigateRef.current = navigate;

  console.log(`[Push][BUILD] BUILD_ID=${PUSH_BUILD_ID} | platform=${Capacitor.getPlatform()} | isNative=${Capacitor.isNativePlatform()} | userId=${user?.id ?? 'null'}`);

  const userRef = useRef(user);
  userRef.current = user;
  const tokenRef = useRef(token);
  tokenRef.current = token;
  const regStateRef = useRef<RegistrationState>('idle');
  const listenersReadyRef = useRef(false);
  const listenersReadyPromiseRef = useRef<Promise<void> | null>(null);
  // terminalStatusesRef removed — dynamic resolution via getTerminalStatuses() at event time
  const listenersResolveRef = useRef<(() => void) | null>(null);
  const soundsEnabledRef = useRef(true);

  // Fetch sounds preference on mount and when user changes
  useEffect(() => {
    if (!user?.id) return;
    supabase
      .from('notification_preferences')
      .select('sounds')
      .eq('user_id', user.id)
      .maybeSingle()
      .then(({ data }) => {
        soundsEnabledRef.current = data?.sounds !== false;
      });
  }, [user?.id]);

  // ── Set log user ──
  useEffect(() => {
    if (user?.id) setLogUser(user.id);
    else setLogUser(null);
  }, [user?.id]);

  // ── Save token to DB via RPC ──
  const saveTokenToDb = useCallback(async (fcmToken: string, apnsToken?: string) => {
    const currentUser = userRef.current;
    if (!currentUser?.id) {
      pushLog('warn', 'SAVE_TOKEN_NO_USER', { token: fcmToken.substring(0, 20) });
      return;
    }

    const platform = Capacitor.getPlatform();
    pushLog('info', 'SAVING_TOKEN', {
      userId: currentUser.id,
      platform,
      fcmToken: fcmToken.substring(0, 20),
      apnsToken: apnsToken?.substring(0, 16) ?? 'none',
    });

    try {
      // First try RPC for atomic claim
      const { error } = await supabase.rpc('claim_device_token', {
        p_user_id: currentUser.id,
        p_token: fcmToken,
        p_platform: platform,
        p_apns_token: apnsToken ?? null,
      });

      if (error) {
        pushLog('error', 'CLAIM_TOKEN_RPC_ERROR', { error: error.message });
        // Fallback: direct upsert
        await supabase.from('device_tokens').upsert(
          {
            user_id: currentUser.id,
            token: fcmToken,
            platform,
            apns_token: apnsToken ?? null,
            updated_at: new Date().toISOString(),
          },
          { onConflict: 'user_id,token' }
        );
        pushLog('info', 'FALLBACK_UPSERT_OK');
      } else {
        pushLog('info', 'CLAIM_TOKEN_OK');
        // If we have an APNs token, update it separately (RPC may not handle apns_token)
        if (apnsToken) {
          await supabase
            .from('device_tokens')
            .update({ apns_token: apnsToken, updated_at: new Date().toISOString() })
            .eq('user_id', currentUser.id)
            .eq('token', fcmToken);
          pushLog('info', 'APNS_TOKEN_UPDATED');
        }
      }

      await flushPushLogs();
    } catch (e) {
      pushLog('error', 'SAVE_TOKEN_EXCEPTION', { error: String(e) });
    }
  }, []);

  // ── Core registration logic ──
  const registerPush = useCallback(async () => {
    if (!Capacitor.isNativePlatform()) return;

    if (!listenersReadyRef.current && listenersReadyPromiseRef.current) {
      pushLog('warn', 'WAITING_FOR_LISTENERS');
      await Promise.race([
        listenersReadyPromiseRef.current,
        new Promise((resolve) => setTimeout(resolve, 1500)),
      ]);
    }

    if (regStateRef.current === 'registering') return;
    regStateRef.current = 'registering';

    pushLog('info', 'REGISTER_START');

    try {
      const { PushNotifications } = await import('@capacitor/push-notifications');

      // Check current permission — NEVER request here (only from user tap)
      let perm: 'granted' | 'denied' | 'prompt' = 'prompt';
      try {
        const permResult = await PushNotifications.checkPermissions();
        perm = permResult.receive as 'granted' | 'denied' | 'prompt';
      } catch (e) {
        pushLog('warn', 'CHECK_PERMISSIONS_ERROR', { error: String(e) });
        regStateRef.current = 'idle';
        return;
      }

      setPermissionStatus(perm);
      pushLog('info', 'PERMISSION_CHECK', { status: perm });

      if (perm !== 'granted') {
        pushLog('info', 'PERMISSION_NOT_GRANTED_SKIP', { status: perm });
        regStateRef.current = 'idle';
        return;
      }

      // Permission granted → register to get the APNs/FCM token
      await PushNotifications.register();
      pushLog('info', 'PN_REGISTER_CALLED');

      // The 'registration' listener (set up in the main effect) will handle token capture
      // Set a timeout to mark as failed if no token received
      setTimeout(() => {
        if (regStateRef.current === 'registering') {
          pushLog('warn', 'REGISTER_TIMEOUT', { state: regStateRef.current });
          regStateRef.current = 'idle';
        }
      }, 10000);
    } catch (e) {
      pushLog('error', 'REGISTER_EXCEPTION', { error: String(e) });
      regStateRef.current = 'failed';
    }
  }, []);

  // ── Request full permission (called from banner / settings — user tap only!) ──
  const requestFullPermission = useCallback(async () => {
    if (!Capacitor.isNativePlatform()) return;

    pushLog('info', 'REQUEST_FULL_PERMISSION');

    try {
      const { PushNotifications } = await import('@capacitor/push-notifications');
      const result = await PushNotifications.requestPermissions();
      const perm = result.receive as 'granted' | 'denied' | 'prompt';
      setPermissionStatus(perm);
      pushLog('info', 'PERMISSION_RESULT', { status: perm });

      if (perm === 'granted') {
        regStateRef.current = 'idle'; // Allow re-registration
        await registerPush();
      }
    } catch (e) {
      pushLog('error', 'REQUEST_PERMISSION_ERROR', { error: String(e) });
    }
  }, [registerPush]);

  // ── Remove token from DB (for logout) ──
  const removeTokenFromDatabase = useCallback(async () => {
    const currentToken = tokenRef.current;
    if (!currentToken) return;

    try {
      await supabase.from('device_tokens').delete().eq('token', currentToken);
      pushLog('info', 'TOKEN_REMOVED_FROM_DB');
    } catch (e) {
      pushLog('error', 'TOKEN_REMOVE_ERROR', { error: String(e) });
    }

    setToken(null);
    tokenRef.current = null;
    regStateRef.current = 'idle';
  }, []);

  // ── Main effect: setup listeners + register on login ──
  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return;

    const instanceId = ++activeInstanceId;
    pushLog('info', 'EFFECT_INIT', { instanceId, userId: user?.id ?? null });

    listenersReadyRef.current = false;
    listenersReadyPromiseRef.current = new Promise<void>((resolve) => {
      listenersResolveRef.current = resolve;
    });

    let cleanupListeners: (() => void)[] = [];

    const setup = async () => {
      // Terminal statuses now resolved dynamically at event time via getTerminalStatuses()
      // Pre-warm the cache for faster first lookup (best-effort, non-blocking)
      getTerminalStatuses().catch(() => {});

      let PushNotifications: any;
      try {
        const pnMod = await import('@capacitor/push-notifications');
        PushNotifications = pnMod.PushNotifications;
      } catch (e) {
        pushLog('error', 'PUSH_NOTIFICATIONS_PLUGIN_LOAD_FAILED', { error: String(e) });
        return;
      }

      if (instanceId !== activeInstanceId) return;

      const platform = Capacitor.getPlatform();

      // Create high-importance notification channel for order alerts (Android 8+)
      if (platform === 'android') {
        try {
          await PushNotifications.createChannel({
            id: 'orders_alert',
            name: 'Order Alerts',
            description: 'High-priority alerts for new orders',
            importance: 5,
            visibility: 1,
            sound: 'gate_bell',
            vibration: true,
            lights: true,
          });
          pushLog('info', 'ANDROID_CHANNEL_CREATED', { channelId: 'orders_alert' });
        } catch (chErr) {
          pushLog('warn', 'ANDROID_CHANNEL_CREATE_FAILED', { error: String(chErr) });
        }
      }

      // Listen for registration success — gives raw APNs token on iOS, FCM token on Android
      const regListener = await PushNotifications.addListener('registration', async (regToken: { value: string }) => {
        if (instanceId !== activeInstanceId) return;

        const rawToken = regToken.value;
        pushLog('info', 'REGISTRATION_EVENT', {
          platform,
          tokenPrefix: rawToken?.substring(0, 20),
          tokenLength: rawToken?.length,
        });

        if (platform === 'ios') {
          // On iOS: registration event gives raw APNs token (64-char hex)
          // We need to also get the FCM token via @capacitor-community/fcm
          const apnsToken = rawToken;
          pushLog('info', 'IOS_APNS_TOKEN', { apnsToken: apnsToken?.substring(0, 16) });

          try {
            const { FCM } = await import('@capacitor-community/fcm');
            const fcmResult = await FCM.getToken();
            const fcmToken = fcmResult.token;
            pushLog('info', 'IOS_FCM_TOKEN', { fcmToken: fcmToken?.substring(0, 20), length: fcmToken?.length });

            if (fcmToken && fcmToken.length > 20) {
              setToken(fcmToken);
              tokenRef.current = fcmToken;
              regStateRef.current = 'registered';
              await saveTokenToDb(fcmToken, apnsToken);
            } else {
              pushLog('error', 'IOS_FCM_TOKEN_INVALID', { fcmToken });
              regStateRef.current = 'failed';
            }
          } catch (e) {
            pushLog('error', 'IOS_FCM_GET_TOKEN_ERROR', { error: String(e) });
            // Still save with just the APNs token if FCM fails
            if (apnsToken && apnsToken.length > 20) {
              setToken(apnsToken);
              tokenRef.current = apnsToken;
              regStateRef.current = 'registered';
              await saveTokenToDb(apnsToken, apnsToken);
            } else {
              regStateRef.current = 'failed';
            }
          }
        } else {
          // On Android: registration event gives FCM token directly
          const fcmToken = rawToken;
          if (fcmToken && fcmToken.length > 20) {
            setToken(fcmToken);
            tokenRef.current = fcmToken;
            regStateRef.current = 'registered';
            await saveTokenToDb(fcmToken);
          } else {
            pushLog('error', 'ANDROID_TOKEN_INVALID', { token: fcmToken });
            regStateRef.current = 'failed';
          }
        }
      });
      cleanupListeners.push(() => regListener.remove());

      // Listen for registration errors
      const errListener = await PushNotifications.addListener('registrationError', (error: any) => {
        if (instanceId !== activeInstanceId) return;
        pushLog('error', 'REGISTRATION_ERROR', { error: JSON.stringify(error) });
        regStateRef.current = 'failed';
      });
      cleanupListeners.push(() => errListener.remove());

      // Listen for foreground notifications
      // Dedup map: orderId-status → timestamp, prevents double haptic from realtime + push
      const recentHaptics = new Map<string, number>();

      const fgListener = await PushNotifications.addListener('pushNotificationReceived', (notification: any) => {
        if (instanceId !== activeInstanceId) return;
        pushLog('info', 'FOREGROUND_NOTIFICATION', {
          title: notification?.title,
          body: notification?.body,
        });

        // Suppress duplicate alert if Live Activity is already tracking this order
        const data = notification?.data as Record<string, string> | undefined;
        const orderId = data?.orderId ?? data?.order_id ?? data?.entity_id;

        // CRITICAL: Dispatch terminal sync BEFORE suppression check
        const pushStatus = data?.status;
        const isTerminalPush = data?.is_terminal === 'true' || (data as any)?.is_terminal === true;
        let isTerminal = isTerminalPush;
        if (!isTerminal && pushStatus) {
          getTerminalStatuses().then(terminalSet => {
            if (terminalSet.has(pushStatus) && orderId) {
              pushLog('info', 'TERMINAL_PUSH_SYNC_ASYNC', { orderId, status: pushStatus });
              window.dispatchEvent(new CustomEvent('order-terminal-push', {
                detail: { orderId, status: pushStatus },
              }));
            }
          }).catch(() => {});
        }
        if (orderId && pushStatus && isTerminal) {
          pushLog('info', 'TERMINAL_PUSH_SYNC', { orderId, status: pushStatus });
          window.dispatchEvent(new CustomEvent('order-terminal-push', {
            detail: { orderId, status: pushStatus },
          }));
        }

        // Suppress if Live Activity is tracking
        if (orderId && LiveActivityManager.isTracking(orderId)) {
          pushLog('info', 'FOREGROUND_SUPPRESSED_LA_ACTIVE', { orderId });
          return;
        }

        // Suppress self-action: if buyer is viewing this order page, skip sound/toast
        // but still dispatch a refetch event so the detail page updates immediately
        const currentPath = window.location.hash || window.location.pathname;
        if (orderId && currentPath.includes(`/orders/${orderId}`)) {
          pushLog('info', 'FOREGROUND_SUPPRESSED_SELF_ACTION', { orderId });
          window.dispatchEvent(new CustomEvent('order-detail-refetch', { detail: { orderId } }));
          return;
        }

        // Deduplicate haptics: skip if realtime already triggered within 3s
        const dedupKey = orderId && pushStatus ? `${orderId}-${pushStatus}` : '';
        const now = Date.now();
        if (dedupKey) {
          const lastHaptic = recentHaptics.get(dedupKey);
          if (lastHaptic && now - lastHaptic < 3000) {
            pushLog('info', 'HAPTIC_DEDUP_SKIP', { dedupKey });
            // Still show toast but skip haptic + sound
            const toastOpts: Record<string, any> = { description: notification?.body };
            if (orderId && pushStatus) toastOpts.id = `order-${orderId}-${pushStatus}`;
            toast(notification?.title ?? 'New Notification', toastOpts);
            return;
          }
          recentHaptics.set(dedupKey, now);
          // Cleanup old entries
          if (recentHaptics.size > 20) {
            for (const [k, v] of recentHaptics) {
              if (now - v > 10000) recentHaptics.delete(k);
            }
          }
        }

        hapticNotification('success');

        // Play a short alert beep via Web Audio API (respect sounds preference)
        if (soundsEnabledRef.current) {
          try {
            const ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
            const audioNow = ctx.currentTime;
            for (let i = 0; i < 3; i++) {
              const osc = ctx.createOscillator();
              const gain = ctx.createGain();
              osc.connect(gain);
              gain.connect(ctx.destination);
              osc.frequency.value = i % 2 === 0 ? 880 : 660;
              osc.type = 'sine';
              const t = audioNow + i * 0.15;
              gain.gain.setValueAtTime(0.18, t);
              gain.gain.exponentialRampToValueAtTime(0.01, t + 0.12);
              osc.start(t);
              osc.stop(t + 0.15);
            }
            setTimeout(() => ctx.close().catch(() => {}), 600);
          } catch {}
        }

        const route = data?.route || resolveNotificationRoute(data?.type, data);
        const toastOptions: Record<string, any> = {
          description: notification?.body,
        };
        if (orderId && data?.status) {
          toastOptions.id = `order-${orderId}-${data.status}`;
        }
        if (route && route !== '/notifications') {
          const isSellerOrder = data?.type === 'order' || data?.type === 'order_created';
          const navState = isSellerOrder ? { state: { tab: 'selling' } } : undefined;
          toastOptions.action = {
            label: 'View',
            onClick: () => navigateRef.current(route, navState),
          };
        }

        toast(notification?.title ?? 'New Notification', toastOptions);
      });
      cleanupListeners.push(() => fgListener.remove());

      // Listen for notification taps
      const tapListener = await PushNotifications.addListener('pushNotificationActionPerformed', (event: any) => {
        if (instanceId !== activeInstanceId) return;
        const data = event.notification?.data as Record<string, string> | undefined;
        pushLog('info', 'NOTIFICATION_TAP', { data });

        const route = data?.route || resolveNotificationRoute(data?.type, data);
        if (route && route !== '/notifications') {
          const isSellerOrder = data?.type === 'order' || data?.type === 'order_created';
          const navState = isSellerOrder ? { state: { tab: 'selling' } } : undefined;
          // Store as pending deep link for retry after auth hydration (cold start safety)
          setPendingDeepLink(route);
          navigateRef.current(route, navState);
        }
      });
      cleanupListeners.push(() => tapListener.remove());

      listenersReadyRef.current = true;
      listenersResolveRef.current?.();
      listenersResolveRef.current = null;
      pushLog('info', 'LISTENERS_READY');

      // If user is logged in, register
      if (user?.id) {
        await registerPush();
      }
    };

    setup();

    // Re-register on app resume
    let appListener: any = null;
    (async () => {
      try {
        const { App } = await import('@capacitor/app');
        appListener = await App.addListener('appStateChange', ({ isActive }) => {
          if (isActive && instanceId === activeInstanceId && userRef.current?.id) {
            pushLog('info', 'APP_RESUME_REGISTER');
            registerPush();
          }
        });
      } catch {}
    })();

    return () => {
      pushLog('info', 'EFFECT_CLEANUP', { instanceId });
      listenersReadyRef.current = false;
      listenersResolveRef.current = null;
      cleanupListeners.forEach((fn) => fn());
      appListener?.remove?.();
    };
  }, [user?.id, registerPush, saveTokenToDb]);

  return {
    token,
    permissionStatus,
    registerPushNotifications: registerPush,
    requestFullPermission,
    removeTokenFromDatabase,
  };
}
