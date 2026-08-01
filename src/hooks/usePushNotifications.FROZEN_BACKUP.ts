// @ts-nocheck
import { useEffect, useState, useCallback, useContext, useRef } from 'react';
import { Capacitor } from '@capacitor/core';
import { supabase } from '@/integrations/supabase/client';
import { IdentityContext } from '@/contexts/auth/contexts';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { hapticNotification } from '@/lib/haptics';
import { getPushStage, setPushStage, getLastBuildId, setLastBuildId } from '@/lib/pushPermissionStage';
import { pushLog, setLogUser, flushPushLogs } from '@/lib/pushLogger';

/**
 * BUILD FINGERPRINT — if the device logs this, the bundle is current.
 * If not, the device is running stale JS.
 */
export const PUSH_BUILD_ID = '2026-03-04-TIMEOUT-ALL-NATIVE';

/**
 * NEW APPROACH: Uses @capacitor/push-notifications for permissions + registration
 * on BOTH platforms, then @capacitor-community/fcm to get the FCM token on iOS.
 * 
 * Flow:
 *   PushNotifications.requestPermissions() → PushNotifications.register()
 *   Android: 'registration' event gives FCM token directly
 *   iOS: 'registration' event gives APNs token → FCM.getToken() converts to FCM token
 * 
 * This avoids the Firebase method-swizzling issue that prevented the OS prompt.
 */

type RegistrationState = 'idle' | 'registering' | 'registered' | 'failed';

const MAX_RETRIES = 3;
const WATCHDOG_TIMEOUT_MS = 20000;
const RECONCILE_GETTOKEN_TIMEOUT_MS = 3000;
const LOGIN_RECONCILE_TIMEOUT_MS = 5000;
const PLUGIN_IMPORT_TIMEOUT_MS = 5000;
const FCM_GETTOKEN_TIMEOUT_MS = 5000;
const LISTENER_GATE_TIMEOUT_MS = 5000;
const CHECK_PERMISSIONS_TIMEOUT_MS = 5000;
const REQUEST_PERMISSIONS_TIMEOUT_MS = 7000;
const REGISTER_TIMEOUT_MS = 7000;
const RPC_TIMEOUT_MS = 8000;

async function withTimeout<T>(promise: Promise<T>, ms: number, timeoutMessage: string): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) => {
      setTimeout(() => reject(new Error(timeoutMessage)), ms);
    }),
  ]);
}

/**
 * Reject 64-char hex strings on iOS — these are raw APNs tokens, not FCM.
 */
function isValidFcmToken(token: string, platform: string): boolean {
  if (platform === 'ios' && /^[A-Fa-f0-9]{64}$/.test(token)) {
    return false;
  }
  return token.length > 20;
}

async function getPushNotificationsPlugin() {
  try {
    const { PushNotifications } = await withTimeout(
      import('@capacitor/push-notifications'),
      PLUGIN_IMPORT_TIMEOUT_MS,
      'getPushNotificationsPlugin import timed out'
    );
    return PushNotifications;
  } catch (e) {
    console.warn('[Push] @capacitor/push-notifications not available:', e);
    return null;
  }
}

async function getFcmPlugin() {
  try {
    const { FCM } = await withTimeout(
      import('@capacitor-community/fcm'),
      PLUGIN_IMPORT_TIMEOUT_MS,
      'getFcmPlugin import timed out'
    );
    return FCM;
  } catch (e) {
    console.warn('[Push] @capacitor-community/fcm not available:', e);
    return null;
  }
}

// Module-level singleton guard
let activeInstanceId = 0;

/**
 * INTERNAL: Full hook with all side effects. Only called by PushNotificationProvider.
 */
export function usePushNotificationsInternal() {
  const [token, setToken] = useState<string | null>(null);
  const [permissionStatus, setPermissionStatus] = useState<'granted' | 'denied' | 'prompt'>('prompt');
  const identity = useContext(IdentityContext);
  const user = identity?.user ?? null;
  const navigate = useNavigate();
  const navigateRef = useRef(navigate);
  navigateRef.current = navigate;

  // ── BUILD FINGERPRINT LOG (fires on every render — proves bundle version) ──
  console.log(`[Push][BUILD] BUILD_ID=${PUSH_BUILD_ID} | platform=${Capacitor.getPlatform()} | isNative=${Capacitor.isNativePlatform()} | userId=${user?.id ?? 'null'} | href=${window.location.href} | readyState=${document.readyState} | lastModified=${document.lastModified} | ts=${new Date().toISOString()}`);

  const userRef = useRef(user);
  // ── LIFECYCLE AUDIT: track user object identity across renders ──
  const prevUserObjRef = useRef<typeof user>(undefined);
  const renderCountRef = useRef(0);
  renderCountRef.current += 1;
  const renderNum = renderCountRef.current;
  const userChanged = user !== prevUserObjRef.current;
  const userIdChanged = user?.id !== prevUserObjRef.current?.id;
  pushLog('info', 'HOOK_RENDER', {
    renderNum,
    userId: user?.id ?? null,
    userObjChanged: userChanged,
    userIdChanged,
    prevUserId: prevUserObjRef.current?.id ?? null,
    ts: Date.now(),
  });
  prevUserObjRef.current = user;
  userRef.current = user;

  const registrationStateRef = useRef<RegistrationState>('idle');
  const retryCountRef = useRef(0);
  const watchdogTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastErrorRef = useRef<unknown>(null);
  const tokenRef = useRef<string | null>(null);

  // ── Listener gate: Promise that resolves when all 4 listeners are attached ──
  const listenersReadyResolveRef = useRef<(() => void) | null>(null);
  const listenersReadyRef = useRef<Promise<void>>(
    new Promise<void>((resolve) => {
      listenersReadyResolveRef.current = resolve;
    })
  );

  useEffect(() => {
    tokenRef.current = token;
  }, [token]);

  // ── Helpers ──
  const clearWatchdog = useCallback(() => {
    if (watchdogTimerRef.current !== null) {
      clearTimeout(watchdogTimerRef.current);
      watchdogTimerRef.current = null;
    }
  }, []);

  const permissionStatusRef = useRef(permissionStatus);
  permissionStatusRef.current = permissionStatus;

  const emitDiagnostic = useCallback(() => {
    console.error('[Push][DIAG] Registration failed after retries', {
      userId: userRef.current?.id ?? 'unknown',
      platform: Capacitor.getPlatform(),
      permissionStatus: permissionStatusRef.current,
      retriesAttempted: retryCountRef.current,
      lastError: lastErrorRef.current,
      timestamp: new Date().toISOString(),
    });
  }, []);

  const markFailed = useCallback((reason: string = 'unknown_failure', extra: Record<string, unknown> = {}) => {
    registrationStateRef.current = 'failed';
    clearWatchdog();
    pushLog('error', 'PIPELINE_FAILED', {
      reason,
      platform: Capacitor.getPlatform(),
      permissionStatus: permissionStatusRef.current,
      retries: retryCountRef.current,
      lastError: String(lastErrorRef.current),
      ...extra,
    });
    emitDiagnostic();
    flushPushLogs().catch(() => {});
  }, [clearWatchdog, emitDiagnostic]);

  // Store captured APNs token for direct delivery
  const apnsTokenRef = useRef<string | null>(null);
  const finalizationPromiseRef = useRef<Promise<boolean> | null>(null);

  const waitForListenersReady = useCallback(async (source: string) => {
    pushLog('info', 'LISTENER_GATE_WAIT_START', { source, ts: Date.now() });
    try {
      await withTimeout(listenersReadyRef.current, LISTENER_GATE_TIMEOUT_MS, `${source}: listeners gate timed out`);
      pushLog('info', 'LISTENER_GATE_READY', { source, ts: Date.now() });
      return true;
    } catch (e) {
      pushLog('error', 'LISTENER_GATE_TIMEOUT', { source, error: String(e), ts: Date.now() });
      return false;
    }
  }, []);

  const waitForApnsToken = useCallback(async (source: string) => {
    const platform = Capacitor.getPlatform();
    if (platform !== 'ios') return true;

    if (/^[A-Fa-f0-9]{64}$/.test(apnsTokenRef.current ?? '')) {
      return true;
    }

    pushLog('warn', 'APNS_MISSING_AT_FINALIZE', { source, ts: Date.now() });

    for (let i = 1; i <= 5; i++) {
      await new Promise((r) => setTimeout(r, 400));
      if (/^[A-Fa-f0-9]{64}$/.test(apnsTokenRef.current ?? '')) {
        pushLog('info', 'APNS_TOKEN_BECAME_AVAILABLE', {
          source,
          attempt: i,
          apnsPrefix: apnsTokenRef.current?.substring(0, 16),
          ts: Date.now(),
        });
        return true;
      }
    }

    return false;
  }, []);

  // ── Token persistence ──
  const saveTokenToDatabase = useCallback(async (pushToken: string) => {
    const currentUser = userRef.current;
    console.log('[Push] saveTokenToDatabase called, user:', currentUser?.id ?? 'null', 'token:', pushToken.substring(0, 20) + '…');

    if (!currentUser) {
      console.warn('[Push] No user at token-save time — will retry when user is ready');
      return false;
    }

    const platform = Capacitor.getPlatform() as 'ios' | 'android' | 'web';
    const apnsToken = platform === 'ios' ? apnsTokenRef.current : null;

    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        pushLog('info', 'CLAIM_DEVICE_TOKEN_RPC', {
          attempt,
          userId: currentUser.id,
          fcmPrefix: pushToken.substring(0, 20),
          apnsPrefix: apnsToken?.substring(0, 16) ?? 'null',
          platform,
        });

        const { error } = await withTimeout(
          (async () => {
            const result = await supabase.rpc('claim_device_token', {
              p_user_id: currentUser.id,
              p_token: pushToken,
              p_platform: platform,
              p_apns_token: apnsToken,
            });
            return result;
          })(),
          RPC_TIMEOUT_MS,
          `claim_device_token timed out (attempt ${attempt})`
        );

        if (!error) {
          pushLog('info', 'CLAIM_DEVICE_TOKEN_RPC_SUCCESS', {
            attempt,
            userId: currentUser.id,
            fcmPrefix: pushToken.substring(0, 20),
            apnsPrefix: apnsToken?.substring(0, 16) ?? 'null',
            platform,
          });
          console.log('[Push] ✓ Token claimed via RPC' + (apnsToken ? ` (APNs: ${apnsToken.substring(0, 16)}…)` : ''));
          return true;
        }

        pushLog('error', 'CLAIM_DEVICE_TOKEN_FAILED', {
          attempt,
          error: error.message,
          code: error.code,
        });
      } catch (err) {
        pushLog('error', 'CLAIM_DEVICE_TOKEN_FAILED', {
          attempt,
          error: String(err),
          timedOut: String(err).includes('timed out'),
        });
      }

      if (attempt < 3) {
        await new Promise((r) => setTimeout(r, attempt * 400));
      }
    }

    return false;
  }, []);

  const userIdForCleanupRef = useRef<string | null>(null);
  useEffect(() => {
    if (user?.id) userIdForCleanupRef.current = user.id;
  }, [user?.id]);

  const removeTokenFromDatabase = useCallback(async () => {
    const uid = userIdForCleanupRef.current;
    const currentToken = tokenRef.current;
    if (!uid) return;

    // Important: never wipe all tokens for a user on a single-device logout.
    // Only remove the token of this app instance when available.
    if (!currentToken) {
      console.warn('[Push] Logout cleanup skipped: no local token in memory');
      return;
    }

    try {
      const { error } = await supabase
        .from('device_tokens')
        .delete()
        .eq('user_id', uid)
        .eq('token', currentToken);

      if (error) {
        console.error('[Push] Error removing push token:', error);
      } else {
        console.log('[Push] Token removed for user/device:', uid, currentToken.substring(0, 20) + '…');
      }
    } catch (err) {
      console.error('[Push] Failed to remove push token:', err);
    }
  }, []);

  // ── Handle a valid token (single deterministic finalization path) ──
  const handleValidToken = useCallback(async (tokenValue: string, source: string = 'unknown_source') => {
    if (finalizationPromiseRef.current) {
      pushLog('info', 'FINALIZATION_JOIN_EXISTING', { source, ts: Date.now() });
      return finalizationPromiseRef.current;
    }

    const run = (async () => {
      clearWatchdog();

      const platform = Capacitor.getPlatform();
      if (!isValidFcmToken(tokenValue, platform)) {
        lastErrorRef.current = new Error('invalid_fcm_token');
        markFailed('invalid_fcm_token', { source, tokenLength: tokenValue?.length ?? 0 });
        return false;
      }

      const hasValidApns = await waitForApnsToken(source);
      if (!hasValidApns) {
        lastErrorRef.current = new Error('apns_missing');
        markFailed('apns_missing', { source });
        return false;
      }

      // Compare with existing DB token to detect stale/mismatched tokens
      const currentUser = userRef.current;
      let isNewToken = true;
      if (currentUser) {
        try {
          const { data } = await supabase
            .from('device_tokens')
            .select('token')
            .eq('user_id', currentUser.id)
            .limit(5);
          const existingTokens = data?.map(r => r.token) ?? [];
          isNewToken = !existingTokens.includes(tokenValue);
          pushLog('info', 'TOKEN_COMPARISON', {
            source,
            isNew: isNewToken,
            runtimePrefix: tokenValue.substring(0, 20),
            dbTokenCount: existingTokens.length,
            dbPrefixes: existingTokens.map(t => t.substring(0, 12)),
            ts: Date.now(),
          });
        } catch (e) {
          pushLog('warn', 'TOKEN_COMPARISON_FAILED', { source, error: String(e) });
        }
      }

      setToken(tokenValue);
      tokenRef.current = tokenValue;

      const saved = await saveTokenToDatabase(tokenValue);
      if (!saved) {
        lastErrorRef.current = new Error('rpc_persist_failed');
        markFailed('rpc_persist_failed', { source });
        return false;
      }

      registrationStateRef.current = 'registered';
      retryCountRef.current = 0;
      pushLog('info', `✓ Valid token obtained: ${tokenValue.substring(0, 20)}…`, {
        source,
        length: tokenValue.length,
        isNewToken,
      });
      pushLog('info', 'PIPELINE_SUCCESS', {
        source,
        platform,
        fcmPrefix: tokenValue.substring(0, 20),
        apnsPrefix: apnsTokenRef.current?.substring(0, 16) ?? 'none',
        ts: Date.now(),
      });
      flushPushLogs().catch(() => {});
      return true;
    })().finally(() => {
      finalizationPromiseRef.current = null;
    });

    finalizationPromiseRef.current = run;
    return run;
  }, [clearWatchdog, saveTokenToDatabase, markFailed, waitForApnsToken]);

  const reconcileRuntimeToken = useCallback(async (reason: string): Promise<boolean> => {
    const platform = Capacitor.getPlatform();
    const currentUser = userRef.current;

    if (!Capacitor.isNativePlatform() || !currentUser) {
      return false;
    }

    if (platform !== 'ios') {
      return false;
    }

    pushLog('info', 'RECONCILE_GET_FCM_PLUGIN_CALLING', { reason, platform, ts: Date.now() });
    const fcm = await getFcmPlugin();
    pushLog('info', 'RECONCILE_GET_FCM_PLUGIN_RESULT', {
      reason,
      platform,
      hasPlugin: Boolean(fcm),
      ts: Date.now(),
    });

    if (!fcm) {
      pushLog('warn', 'reconcileRuntimeToken skipped — FCM plugin missing', { reason, platform });
      return false;
    }

    let candidate: string | null = null;
    let lastError: unknown = null;

    // iOS bridge can be transient right after resume/login; retry a few times.
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        pushLog('info', 'RECONCILE_GETTOKEN_CALLING', { reason, platform, attempt, ts: Date.now() });
        const result = await withTimeout(
          fcm.getToken(),
          RECONCILE_GETTOKEN_TIMEOUT_MS,
          'reconcileRuntimeToken getToken timed out'
        );
        const tokenValue = result.token;

        pushLog('info', 'RECONCILE_GETTOKEN_RESULT', {
          reason,
          platform,
          attempt,
          tokenPrefix: tokenValue?.substring(0, 20) ?? null,
          length: tokenValue?.length ?? 0,
          valid: tokenValue ? isValidFcmToken(tokenValue, platform) : false,
          ts: Date.now(),
        });

        if (tokenValue && isValidFcmToken(tokenValue, platform)) {
          candidate = tokenValue;
          break;
        }

        pushLog('warn', 'reconcileRuntimeToken returned invalid token', {
          reason,
          platform,
          attempt,
          tokenPrefix: tokenValue?.substring(0, 20) ?? null,
        });
      } catch (err) {
        lastError = err;
        pushLog('warn', 'reconcileRuntimeToken attempt failed', {
          reason,
          platform,
          attempt,
          error: String(err),
          timedOut: String(err).includes('timed out'),
          ts: Date.now(),
        });
      }

      if (attempt < 3) {
        await new Promise((resolve) => setTimeout(resolve, attempt * 800));
      }
    }

    if (!candidate) {
      pushLog('error', 'reconcileRuntimeToken failed after retries', {
        reason,
        platform,
        error: String(lastError),
      });
      return false;
    }

    const changed = tokenRef.current !== candidate;

    const finalized = await handleValidToken(candidate, `reconcile_runtime_token:${reason}`);
    if (!finalized) {
      pushLog('error', 'reconcileRuntimeToken failed to finalize token', {
        reason,
        platform,
        tokenPrefix: candidate.substring(0, 20),
      });
      return false;
    }

    pushLog('info', 'reconcileRuntimeToken success', {
      reason,
      platform,
      tokenPrefix: candidate.substring(0, 20),
      changed,
    });

    return true;
  }, [handleValidToken]);

  // ── Unified registration (both platforms use PushNotifications) ──
  const attemptRegistration = useCallback(async () => {
    const state = registrationStateRef.current;

    if (state === 'registered') {
      console.log('[Push] attemptRegistration skipped — already registered');
      return;
    }
    if (state === 'registering') {
      console.log('[Push] attemptRegistration skipped — already in progress');
      return;
    }

    registrationStateRef.current = 'registering';
    const attempt = retryCountRef.current + 1;
    const platform = Capacitor.getPlatform();
    pushLog('info', `attemptRegistration — attempt ${attempt}/${MAX_RETRIES}`, { platform });

    if (!Capacitor.isNativePlatform()) {
      console.log('[Push] Skipping — not a native platform');
      registrationStateRef.current = 'idle';
      return;
    }

    const PN = await getPushNotificationsPlugin();
    if (!PN) { markFailed(); return; }
    pushLog('info', 'AR_PLUGIN_LOADED', { ts: Date.now() });

    try {
      // Step 1: Check permissions — NEVER request here (would consume the one-time iOS prompt).
      // Permission requests must ONLY happen via requestFullPermission (user taps "Turn On").
      pushLog('info', 'AR_CHECK_PERMISSIONS_CALLING', { ts: Date.now() });
      const permStatus = await withTimeout(
        PN.checkPermissions(),
        CHECK_PERMISSIONS_TIMEOUT_MS,
        'AR checkPermissions timed out'
      );
      pushLog('info', 'AR_CHECK_PERMISSIONS_RESULT', { receive: permStatus.receive, ts: Date.now() });

      if (permStatus.receive !== 'granted') {
        const isDenied = permStatus.receive === 'denied';
        setPermissionStatus(isDenied ? 'denied' : 'prompt');
        lastErrorRef.current = new Error(`permission_not_granted:${permStatus.receive}`);
        markFailed('permission_not_granted', { receive: permStatus.receive, source: 'attempt_registration' });
        return;
      }

      setPermissionStatus('granted');
      clearWatchdog();

      // Call PN.register() — fires 'registration' event with APNs token on iOS
      pushLog('info', 'AR_REGISTER_CALLING', { ts: Date.now() });
      await waitForListenersReady('attempt_registration');
      await withTimeout(
        PN.register(),
        REGISTER_TIMEOUT_MS,
        'AR register() timed out'
      );
      pushLog('info', 'AR_REGISTER_RETURNED', { ts: Date.now() });

      // Step 4: Platform-specific token retrieval
      if (platform === 'ios') {
        // Small delay to let the registration event fire and capture APNs token
        await new Promise((r) => setTimeout(r, 500));

        // Now get FCM token
        pushLog('info', 'AR_IOS_DIRECT_FCM_CALLING', { ts: Date.now() });
        const fcm = await getFcmPlugin();
        if (!fcm) {
          pushLog('error', 'AR_IOS_FCM_PLUGIN_MISSING');
          markFailed('fcm_plugin_missing', { source: 'attempt_registration_ios' });
          return;
        }
        pushLog('info', 'AR_IOS_FCM_PLUGIN_LOADED', { ts: Date.now() });

        // Retry loop with backoff — iOS bridge can be slow after register()
        let fcmToken: string | null = null;
        for (let i = 1; i <= 3; i++) {
          try {
            pushLog('info', `AR_IOS_FCM_GETTOKEN_ATTEMPT_${i}`, { ts: Date.now() });
            const result = await withTimeout(fcm.getToken(), FCM_GETTOKEN_TIMEOUT_MS, `AR iOS fcm.getToken attempt ${i} timed out`);
            const candidate = result.token;
            pushLog('info', `AR_IOS_FCM_GETTOKEN_RESULT_${i}`, {
              tokenPrefix: candidate?.substring(0, 20) ?? null,
              length: candidate?.length ?? 0,
              valid: candidate ? isValidFcmToken(candidate, 'ios') : false,
              ts: Date.now(),
            });

            if (candidate && isValidFcmToken(candidate, 'ios')) {
              fcmToken = candidate;
              break;
            }
          } catch (err) {
            pushLog('warn', `AR_IOS_FCM_GETTOKEN_ERROR_${i}`, { error: String(err), ts: Date.now() });
          }
          if (i < 3) {
            await new Promise((r) => setTimeout(r, i * 1000));
          }
        }

        if (!fcmToken) {
          pushLog('error', 'AR_IOS_FCM_ALL_ATTEMPTS_FAILED');
          retryCountRef.current += 1;
          if (retryCountRef.current >= MAX_RETRIES) {
            markFailed('ios_fcm_gettoken_failed', { source: 'attempt_registration_ios' });
          } else {
            registrationStateRef.current = 'idle';
            setTimeout(() => attemptRegistration(), 2000);
          }
          return;
        }

        pushLog('info', 'AR_IOS_TOKEN_OBTAINED', {
          fcmPrefix: fcmToken.substring(0, 20),
          apnsPrefix: apnsTokenRef.current?.substring(0, 16) ?? 'none',
          ts: Date.now(),
        });

        await handleValidToken(fcmToken, 'attemptRegistration_ios');
      } else {
        // ── Android: token arrives via 'registration' event listener ──
        // Set up watchdog in case the event never fires
        pushLog('info', 'AR_ANDROID_WAITING_FOR_EVENT', { ts: Date.now() });
        watchdogTimerRef.current = setTimeout(async () => {
          watchdogTimerRef.current = null;
          if (registrationStateRef.current === 'registered') return;

          retryCountRef.current += 1;
          pushLog('warn', `Android watchdog expired — attempt ${retryCountRef.current}/${MAX_RETRIES}`);

          if (retryCountRef.current >= MAX_RETRIES) {
            markFailed('android_watchdog_expired', { source: 'attempt_registration_android' });
          } else {
            registrationStateRef.current = 'idle';
            attemptRegistration();
          }
        }, WATCHDOG_TIMEOUT_MS);
      }
    } catch (err) {
      pushLog('error', 'AR_EXCEPTION', { error: String(err), stack: (err as Error)?.stack?.substring(0, 300), ts: Date.now() });
      lastErrorRef.current = err;
      markFailed('attempt_registration_exception', { source: 'attempt_registration' });
    }
  }, [clearWatchdog, markFailed, handleValidToken, waitForListenersReady]);

  // ── Foreground notification handler (shared logic) ──
  const handleForegroundNotification = useCallback((title: string, body: string, data?: Record<string, string>) => {
    console.log('[Push] Foreground notification:', title, body);
    hapticNotification('warning');

    // Play sound
    try {
      const ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
      for (let i = 0; i < 3; i++) {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.frequency.value = i % 2 === 0 ? 880 : 660;
        osc.type = 'square';
        const start = ctx.currentTime + i * 0.2;
        gain.gain.setValueAtTime(0.25, start);
        gain.gain.exponentialRampToValueAtTime(0.01, start + 0.18);
        osc.start(start);
        osc.stop(start + 0.2);
      }
      setTimeout(() => ctx.close().catch(() => {}), 1000);
    } catch (e) {
      console.warn('[Push] Sound failed:', e);
    }

    toast(title || 'New Notification', {
      description: body || '',
      duration: 10000,
      action: data?.orderId
        ? { label: 'View', onClick: () => navigateRef.current(`/orders/${data.orderId}`) }
        : undefined,
    });
  }, []);

  // ── Handle notification tap (shared logic) ──
  const handleNotificationAction = useCallback((data?: Record<string, string>) => {
    // Priority 1: explicit path or reference_path
    if (data?.path) {
      navigateRef.current(data.path);
      return;
    }
    if (data?.reference_path) {
      navigateRef.current(data.reference_path);
      return;
    }

    // Priority 2: orderId → order detail
    if (data?.orderId) {
      navigateRef.current(`/orders/${data.orderId}`);
      return;
    }

    // Priority 3: type-specific routing
    const type = data?.type;
    if (type === 'chat' && data?.orderId) {
      navigateRef.current(`/orders/${data.orderId}`);
    } else if (type === 'order') {
      navigateRef.current('/orders');
    } else if (type === 'visitor') {
      navigateRef.current('/visitors');
    } else if (type === 'dispute') {
      navigateRef.current('/disputes');
    } else if (type === 'maintenance') {
      navigateRef.current('/maintenance');
    } else if (type === 'bulletin' || type === 'notice') {
      navigateRef.current('/bulletin');
    } else {
      navigateRef.current('/notifications');
    }
  }, []);

  // ── Stable refs for all callbacks used inside the main effect ──
  // This ensures the effect depends ONLY on user?.id, not on callback identity.
  const attemptRegistrationRef = useRef(attemptRegistration);
  attemptRegistrationRef.current = attemptRegistration;
  const handleValidTokenRef = useRef(handleValidToken);
  handleValidTokenRef.current = handleValidToken;
  const handleForegroundNotificationRef = useRef(handleForegroundNotification);
  handleForegroundNotificationRef.current = handleForegroundNotification;
  const handleNotificationActionRef = useRef(handleNotificationAction);
  handleNotificationActionRef.current = handleNotificationAction;
  const clearWatchdogRef = useRef(clearWatchdog);
  clearWatchdogRef.current = clearWatchdog;
  const markFailedRef = useRef(markFailed);
  markFailedRef.current = markFailed;
  const reconcileRuntimeTokenRef = useRef(reconcileRuntimeToken);
  reconcileRuntimeTokenRef.current = reconcileRuntimeToken;

  // ── Listeners + lifecycle ──
  // LIFECYCLE FIX: Depend ONLY on user?.id to prevent effect remounts
  // when the user object reference changes but the identity hasn't.
  // All callbacks are accessed via stable refs above.
  const userId = user?.id ?? null;
  useEffect(() => {
    const myId = ++activeInstanceId;
    let tornDown = false;
    pushLog('info', 'EFFECT_MOUNTED', {
      myId,
      userId,
      renderNum: renderCountRef.current,
      ts: Date.now(),
    });
    pushLog('info', 'EFFECT_DEPS_SNAPSHOT', {
      myId,
      userId,
      depsCount: 1,
      depName: 'userId',
      ts: Date.now(),
    });
    if (myId !== activeInstanceId) {
      console.warn('[Push] Duplicate instance detected — skipping effects');
      return;
    }
    console.log('[Push] Effect owner instance:', myId);

    if (!Capacitor.isNativePlatform()) return;

    const platform = Capacitor.getPlatform();
    const cleanups: (() => void)[] = [];

    (async () => {
      const PN = await getPushNotificationsPlugin();
      if (!PN) return;

      // ── Registration event ──
      // Android: gives FCM token directly
      // iOS: gives APNs token → we convert via FCM.getToken()
      const registrationListener = PN.addListener('registration', async (registrationToken) => {
        try {
          pushLog('info', 'REGISTRATION_EVENT_THREAD_CHECK', { isNative: Capacitor.isNativePlatform?.(), hasPlugin: !!(window as any).Capacitor?.Plugins?.PushNotifications, ts: Date.now() });
          const rawToken = registrationToken?.value;
          pushLog('info', 'REGISTRATION_EVENT_RECEIVED', { tokenPrefix: rawToken?.substring(0, 20), ts: Date.now() });
          if (!rawToken || typeof rawToken !== 'string' || rawToken.length === 0) {
            console.error(`[Push][${platform}] registration event — invalid token:`, registrationToken);
            return;
          }

          console.log(`[Push][${platform}] registration event — raw token:`, rawToken.substring(0, 20) + '…', 'length:', rawToken.length);

          if (platform === 'ios') {
            // ── BUG #1 FIX: Capture APNs token IMMEDIATELY in the main listener ──
            // Previously this ref was only set in duplicate listeners (race condition).
            if (/^[A-Fa-f0-9]{64}$/.test(rawToken)) {
              apnsTokenRef.current = rawToken;
              pushLog('info', 'APNS_TOKEN_CAPTURED_MAIN_LISTENER', { prefix: rawToken.substring(0, 16), ts: Date.now() });
              console.log(`[Push][iOS] ✓ APNs token captured in main listener: ${rawToken.substring(0, 16)}…`);
            }
            // Now convert to FCM token for cross-platform addressing.
            console.log('[Push][iOS] Converting APNs → FCM token via FCM.getToken()…');
            const fcm = await getFcmPlugin();
            if (!fcm) {
              console.error('[Push][iOS] @capacitor-community/fcm not available — cannot convert token');
              markFailedRef.current();
              return;
            }

            // ── iOS FCM.getToken() RETRY LOOP (up to 3 attempts with backoff) ──
            let fcmToken: string | null = null;
            for (let fcmAttempt = 1; fcmAttempt <= 3; fcmAttempt++) {
              try {
                console.log(`[Push][iOS] FCM.getToken() attempt ${fcmAttempt}/3…`);
                const fcmResult = await withTimeout(fcm.getToken(), FCM_GETTOKEN_TIMEOUT_MS, `listener iOS fcm.getToken attempt ${fcmAttempt} timed out`);
                const candidate = fcmResult.token;
                if (candidate && isValidFcmToken(candidate, 'ios')) {
                  fcmToken = candidate;
                  console.log(`[Push][iOS] ✓ FCM token (attempt ${fcmAttempt}):`, fcmToken.substring(0, 20) + '…', 'length:', fcmToken.length);
                  break;
                }
                console.warn(`[Push][iOS] FCM.getToken() attempt ${fcmAttempt} — invalid token:`, candidate?.substring(0, 20));
              } catch (fcmErr) {
                console.warn(`[Push][iOS] FCM.getToken() attempt ${fcmAttempt}/3 exception:`, fcmErr);
              }
              if (fcmAttempt < 3) {
                await new Promise((r) => setTimeout(r, fcmAttempt * 1000));
              }
            }

            if (!fcmToken) {
              console.error('[Push][iOS] FCM token conversion failed after 3 attempts');
              markFailedRef.current();
              return;
            }

            await handleValidTokenRef.current(fcmToken, 'registration_listener_ios');
          } else {
            // Android: registration event already provides FCM token
            if (!isValidFcmToken(rawToken, 'android')) {
              console.warn('[Push][Android] Token failed validation — ignoring');
              return;
            }
            await handleValidTokenRef.current(rawToken, 'registration_listener_android');
          }
        } catch (err) {
          console.error(`[Push][${platform}] registration listener exception:`, err);
        }
      });
      cleanups.push(() => { registrationListener.then(l => l.remove()).catch(() => {}); });

      // ── Registration error ──
      const registrationErrorListener = PN.addListener('registrationError', (error) => {
        try {
          pushLog('error', 'REGISTRATION_ERROR_EVENT', { error: JSON.stringify(error), ts: Date.now() });
          console.error(`[Push][${platform}] registrationError:`, JSON.stringify(error));
          pushLog('error', 'registrationError event', {
            platform,
            error,
            appState: document.visibilityState,
            at: new Date().toISOString(),
          });
          lastErrorRef.current = error;
          markFailedRef.current();
        } catch (err) {
          console.error(`[Push][${platform}] registrationError listener exception:`, err);
        }
      });
      cleanups.push(() => { registrationErrorListener.then(l => l.remove()).catch(() => {}); });

      // ── Foreground notification ──
      const fgListener = PN.addListener('pushNotificationReceived', (notification) => {
        try {
          console.log(`[Push][${platform}] Foreground notification received:`, JSON.stringify(notification));
          const data = notification.data as Record<string, string> | undefined;
          pushLog('info', 'pushNotificationReceived event', {
            platform,
            title: notification.title,
            body: notification.body,
            data,
            appState: document.visibilityState,
            at: new Date().toISOString(),
          });
          handleForegroundNotificationRef.current(notification.title || '', notification.body || '', data);
        } catch (err) {
          console.error(`[Push][${platform}] pushNotificationReceived listener exception:`, err);
        }
      });
      cleanups.push(() => { fgListener.then(l => l.remove()).catch(() => {}); });

      // ── Action performed (notification tap) ──
      const actionListener = PN.addListener('pushNotificationActionPerformed', (notification) => {
        try {
          console.log(`[Push][${platform}] Action performed:`, JSON.stringify(notification));
          const data = notification.notification.data as Record<string, string> | undefined;
          pushLog('info', 'pushNotificationActionPerformed event', {
            platform,
            actionId: notification.actionId,
            data,
            appState: document.visibilityState,
            at: new Date().toISOString(),
          });
          handleNotificationActionRef.current(data);
        } catch (err) {
          console.error(`[Push][${platform}] pushNotificationActionPerformed listener exception:`, err);
        }
      });
      cleanups.push(() => { actionListener.then(l => l.remove()).catch(() => {}); });

      // ── Resolve the listener gate ──
      console.log(`[Push][${platform}] All 4 listeners attached — resolving listener gate`);
      if (listenersReadyResolveRef.current) {
        listenersReadyResolveRef.current();
        listenersReadyResolveRef.current = null;
      }
    })();

    // ── iOS: also listen for FCM token refresh ──
    if (platform === 'ios') {
      (async () => {
        try {
          const fcm = await getFcmPlugin();
          if (fcm && typeof (fcm as any).addListener === 'function') {
            // @capacitor-community/fcm doesn't have a built-in token refresh listener,
            // but Firebase will re-deliver via the registration event path.
            console.log('[Push][iOS] FCM plugin ready for token conversion');
          }
        } catch (err) {
          console.warn('[Push][iOS] FCM plugin setup note:', err);
        }
      })();
    }

    // ── App resume: re-check permission and retry if now granted ──
    let appListenerCleanup: (() => void) | undefined;

    (async () => {
      try {
        const { App } = await import('@capacitor/app');
        const listener = await App.addListener('appStateChange', async ({ isActive }) => {
          try {
            if (!isActive) return;

            let state = registrationStateRef.current;
            let hasRuntimeToken = Boolean(tokenRef.current);

            // Attempt an early runtime reconciliation before logging, to avoid stale "hasToken:false" snapshots.
            if (!hasRuntimeToken && userRef.current) {
              try {
                const reconciledEarly = await withTimeout(reconcileRuntimeTokenRef.current('app_resume_prelog'), LOGIN_RECONCILE_TIMEOUT_MS, 'app_resume_prelog reconcile timed out');
                hasRuntimeToken = Boolean(tokenRef.current);
                if (reconciledEarly) {
                  state = registrationStateRef.current;
                }
              } catch (err) {
                pushLog('error', 'Resume prelog reconcile crashed', {
                  platform,
                  error: String(err),
                  userId: userRef.current?.id ?? null,
                  at: new Date().toISOString(),
                });
              }
            }

            console.log(`[Push] App resumed — regState: ${state}, token: ${hasRuntimeToken ? 'yes' : 'null'}, user: ${userRef.current?.id ?? 'null'}`);
            pushLog('info', 'appStateChange active', {
              buildId: PUSH_BUILD_ID,
              platform,
              regState: state,
              hasToken: hasRuntimeToken,
              userId: userRef.current?.id ?? null,
              href: window.location.href,
              readyState: document.readyState,
              lastModified: document.lastModified,
              at: new Date().toISOString(),
            });
            // Force-flush immediately so BUILD_ID proof is never lost to buffer
            flushPushLogs().catch(() => {});

            if (state === 'registered' && userRef.current) {
              withTimeout(
                reconcileRuntimeTokenRef.current('resume_check'),
                LOGIN_RECONCILE_TIMEOUT_MS,
                'resume_check reconcile timed out'
              ).catch(() => {});
              return;
            }
            if (state === 'registered') return;

            // Unified permission check via PushNotifications (both platforms)
            const PN = await getPushNotificationsPlugin();
            let resumePermission = 'prompt';
            if (PN) {
              const p = await withTimeout(
                PN.checkPermissions(),
                CHECK_PERMISSIONS_TIMEOUT_MS,
                'resume checkPermissions timed out'
              );
              resumePermission = p.receive;
            }
            console.log(`[Push] Resume permission check: ${resumePermission}`);
            pushLog('info', 'resume permission check', {
              platform,
              permission: resumePermission,
              at: new Date().toISOString(),
            });

            if (userRef.current) {
              // CRITICAL FIX: Always try reconcileRuntimeToken on resume when
              // user is logged in, regardless of permission status. On iOS,
              // checkPermissions() is unreliable and can return 'prompt' even
              // when notifications are enabled.
              if (!tokenRef.current) {
                const reconciled = await withTimeout(reconcileRuntimeTokenRef.current('app_resume_missing_runtime_token'), LOGIN_RECONCILE_TIMEOUT_MS, 'app_resume_missing_token reconcile timed out');
                if (reconciled) {
                  console.log('[Push] Runtime token reconciled on resume');
                  setPermissionStatus('granted');
                  return;
                }
              }

              if (resumePermission === 'granted') {
                setPermissionStatus('granted');
                registrationStateRef.current = 'idle';
                retryCountRef.current = 0;
                console.log('[Push] Permission granted on resume — attempting registration');
                attemptRegistrationRef.current();
              } else if (resumePermission === 'denied') {
                setPermissionStatus('denied');
              } else {
                // 'prompt' but stage might be 'full' — try register anyway
                pushLog('warn', 'Resume: permission=prompt, trying register() as fallback');
                registrationStateRef.current = 'idle';
                retryCountRef.current = 0;
                attemptRegistrationRef.current();
              }

              // SAFETY NET: If still no token after all attempts above,
              // schedule a delayed retry. The iOS FCM bridge often needs
              // several seconds after app resume before it can return a token.
              if (!tokenRef.current && registrationStateRef.current !== 'registered') {
                setTimeout(async () => {
                  if (tokenRef.current || registrationStateRef.current === 'registered') return;
                  pushLog('info', 'Resume safety-net: delayed reconcile attempt (5s)');
                  const delayedOk = await withTimeout(reconcileRuntimeTokenRef.current('app_resume_delayed_safety_net'), LOGIN_RECONCILE_TIMEOUT_MS, 'resume safety-net reconcile timed out');
                  if (delayedOk) {
                    setPermissionStatus('granted');
                    pushLog('info', 'Resume safety-net: delayed reconcile SUCCEEDED');
                  } else {
                    pushLog('warn', 'Resume safety-net: delayed reconcile also failed');
                  }
                }, 5000);
              }
            }

            // HARD RECOVERY: never stay in idle+no-token after resume.
            if (userRef.current && !tokenRef.current && registrationStateRef.current === 'idle') {
              pushLog('warn', 'Resume hard-recovery: forcing attemptRegistration from idle+no-token', {
                platform,
                userId: userRef.current.id,
                at: new Date().toISOString(),
              });
              retryCountRef.current = 0;
              attemptRegistrationRef.current();
            }
          } catch (err) {
            console.error('[Push] appStateChange listener exception:', err);
            pushLog('error', 'appStateChange handler exception', {
              platform,
              error: String(err),
              regState: registrationStateRef.current,
              hasToken: Boolean(tokenRef.current),
              userId: userRef.current?.id ?? null,
              at: new Date().toISOString(),
            });

            if (userRef.current && !tokenRef.current && registrationStateRef.current === 'idle') {
              pushLog('warn', 'appStateChange exception recovery: forcing attemptRegistration', {
                platform,
                userId: userRef.current.id,
                at: new Date().toISOString(),
              });
              retryCountRef.current = 0;
              attemptRegistrationRef.current();
            }
          }
        });
        appListenerCleanup = () => listener.remove();
      } catch (err) {
        console.error('[Push] Failed to register appStateChange listener:', err);
      }
    })();

    // ── Auto-prompt on first login; silent re-register if already granted ──
    if (userId) {
      pushLog('info', 'USER_BLOCK_ENTERED', { userId, ts: Date.now() });
      setLogUser(userId);
      pushLog('info', `BUILD_FINGERPRINT on login`, { buildId: PUSH_BUILD_ID, platform, href: window.location.href, readyState: document.readyState, lastModified: document.lastModified });
      setTimeout(async () => {
        pushLog('info', 'LOGIN_SETTIMEOUT_FIRED', { userId, tornDown, ts: Date.now() });
        if (tornDown) {
          pushLog('warn', 'EFFECT_TORN_DOWN_BEFORE_REGISTRATION', { myId, ts: Date.now() });
          return;
        }
        try {
          // ── SIMPLIFIED LOGIN FLOW: always register, regardless of stage ──
          // Previous builds had complex stage/build-change checks that could
          // block registration. Now we always ensure registration happens.

          pushLog('info', 'GET_PUSH_STAGE_CALLING', { ts: Date.now() });
          let stage: string = 'none';
          try {
            stage = await getPushStage();
          } catch (stageErr) {
            pushLog('warn', 'getPushStage threw — defaulting to none', { error: String(stageErr) });
          }
          pushLog('info', 'PUSH_STAGE_RESULT', { stage, ts: Date.now() });

          // ── CRITICAL: Skip ALL Preferences calls before registration ──
          // On iOS, calling Preferences.get() twice in rapid succession causes
          // a native bridge deadlock where the second Promise never settles.
          // getPushStage() already called Preferences.get() above — calling
          // getLastBuildId() here would hang the entire registration flow.
          // Build-change detection is deferred to a fire-and-forget background task.

          // Ensure stage is set to 'full' for future sessions (fire-and-forget)
          if (stage !== 'full') {
            setPushStage('full').catch(() => {});
          }

          // Force-flush before registration
          pushLog('info', 'LOGIN_ALWAYS_REGISTER', { stage, ts: Date.now() });
          flushPushLogs().catch(() => {});

          // ── ALWAYS attempt registration on login ──
          registrationStateRef.current = 'idle';
          retryCountRef.current = 0;

          // First try reconcileRuntimeToken (fast path for iOS)
          pushLog('info', 'RECONCILE_STARTING', { ts: Date.now() });
          try {
            const reconciled = await withTimeout(
              reconcileRuntimeTokenRef.current('login_always'),
              LOGIN_RECONCILE_TIMEOUT_MS,
              'login reconcile timed out'
            );
            pushLog('info', 'RECONCILE_RESULT', { reconciled, ts: Date.now() });
            if (reconciled) {
              pushLog('info', 'Token reconciled on login');
              setPermissionStatus('granted');
            } else {
              // Fall back to full registration flow
              pushLog('info', 'Reconcile failed — calling attemptRegistration');
              await attemptRegistrationRef.current();
            }
          } catch (reconErr) {
            pushLog('error', 'RECONCILE_CRASHED_OR_TIMEOUT', { error: String(reconErr), ts: Date.now() });
            pushLog('warn', 'Reconcile blocked login flow — forcing attemptRegistration fallback', { ts: Date.now() });
            await attemptRegistrationRef.current();
          }

          flushPushLogs().catch(() => {});

          // ── Deferred: build-change detection (non-blocking background) ──
          setTimeout(async () => {
            try {
              const lastBuild = await getLastBuildId();
              const buildChanged = lastBuild !== null && lastBuild !== PUSH_BUILD_ID;
              pushLog('info', 'BUILD_CHANGE_CHECK_DEFERRED', { lastBuild, currentBuild: PUSH_BUILD_ID, changed: buildChanged });
              await setLastBuildId(PUSH_BUILD_ID);
            } catch (e) {
              pushLog('warn', 'BUILD_CHANGE_CHECK_DEFERRED_FAILED', { error: String(e) });
            }
          }, 5000);

          // Safety net: delayed reconcile if still no token
          if (!tokenRef.current && (registrationStateRef.current as string) !== 'registered') {
            setTimeout(async () => {
              try {
                if (tokenRef.current || registrationStateRef.current === 'registered') return;
                pushLog('info', 'Login safety-net: delayed reconcile (5s)');
                const ok = await withTimeout(reconcileRuntimeTokenRef.current('login_5s_safety'), LOGIN_RECONCILE_TIMEOUT_MS, 'login 5s safety reconcile timed out');
                if (ok) {
                  setPermissionStatus('granted');
                  pushLog('info', 'Login safety-net SUCCEEDED');
                } else {
                  pushLog('warn', 'Login safety-net failed — trying 10s');
                  setTimeout(async () => {
                    try {
                      if (tokenRef.current || registrationStateRef.current === 'registered') return;
                      const last = await withTimeout(reconcileRuntimeTokenRef.current('login_10s_last'), LOGIN_RECONCILE_TIMEOUT_MS, 'login 10s safety reconcile timed out');
                      if (last) { setPermissionStatus('granted'); }
                      else { pushLog('error', 'All login reconcile attempts failed'); }
                    } catch (e) { pushLog('error', '10s safety crashed', { error: String(e) }); }
                    flushPushLogs().catch(() => {});
                  }, 5000);
                }
              } catch (e) { pushLog('error', '5s safety crashed', { error: String(e) }); }
              flushPushLogs().catch(() => {});
            }, 5000);
          }
        } catch (err) {
          pushLog('error', 'Login registration setTimeout CRASHED', {
            error: String(err),
            stack: (err as Error)?.stack?.substring(0, 500) ?? 'no stack',
            platform,
          });
        }
        // Always force-flush at the end
        flushPushLogs().catch(() => {});
      }, 500);
    }

    // Periodic token health check — every 15 minutes
    const periodicInterval = setInterval(() => {
      if (!userRef.current || !Capacitor.isNativePlatform()) return;
      withTimeout(reconcileRuntimeTokenRef.current('periodic_check'), LOGIN_RECONCILE_TIMEOUT_MS, 'periodic reconcile timed out').catch((e) => {
        pushLog('warn', 'Periodic reconcile failed', { error: String(e) });
      });
    }, 15 * 60 * 1000);

    return () => {
      tornDown = true;
      clearInterval(periodicInterval);
      pushLog('info', 'EFFECT_CLEANUP', { myId, regState: registrationStateRef.current, hasToken: !!tokenRef.current, ts: Date.now() });
      flushPushLogs().catch(() => {});
      clearWatchdogRef.current();
      cleanups.forEach(fn => fn());
      appListenerCleanup?.();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId]);

  // ── Retry token save when user becomes available ──
  useEffect(() => {
    if (user && token) {
      console.log('[Push] User now available — retrying token save');
      saveTokenToDatabase(token);
    }
  }, [user, token, saveTokenToDatabase]);

  // ── Diagnostic ──
  useEffect(() => {
    if (!user) return;
    (async () => {
      try {
        const { data, error } = await supabase
          .from('device_tokens')
          .select('id, token, platform, updated_at')
          .eq('user_id', user.id);
        if (error) {
          console.error('[Push][Diag] Error querying device_tokens:', error.message);
        } else {
          console.log(`[Push][Diag] User ${user.id} has ${data?.length || 0} registered token(s)`, data);
        }
      } catch (e) {
        console.error('[Push][Diag] Exception:', e);
      }
    })();
  }, [user]);

  /**
   * Explicitly request full notification permission.
   * Called from NotificationsPage CTA or after first order.
   * Uses PushNotifications for the OS prompt (both platforms).
   */
  const requestFullPermission = useCallback(async () => {
    console.log('[Push] ▶▶▶ requestFullPermission called — upgrading to full stage');

    if (!Capacitor.isNativePlatform()) {
      console.log('[Push] Not native — skipping');
      return;
    }

    const platform = Capacitor.getPlatform();

    try {
      const PN = await getPushNotificationsPlugin();
      if (!PN) {
        console.error('[Push] ✗ PushNotifications plugin not available');
        setPermissionStatus('denied');
        lastErrorRef.current = new Error('push_plugin_missing');
        markFailed('push_plugin_missing', { source: 'request_full_permission' });
        return;
      }

      // Check current permission — if already granted (banner called requestPermissions
      // directly), skip the prompt and go straight to registration + reconciliation.
      let permStatus = await withTimeout(
        PN.checkPermissions(),
        CHECK_PERMISSIONS_TIMEOUT_MS,
        'requestFullPermission checkPermissions timed out'
      );
      console.log(`[Push] requestFullPermission (${platform}) checkPermissions:`, permStatus.receive);

      if (permStatus.receive === 'prompt') {
        // Only request if still prompt — this path is a fallback;
        // the banner/settings page should have already called requestPermissions() directly.
        console.log(`[Push] requestFullPermission (${platform}) ▶ Calling requestPermissions()`);
        permStatus = await withTimeout(
          PN.requestPermissions(),
          REQUEST_PERMISSIONS_TIMEOUT_MS,
          'requestFullPermission requestPermissions timed out'
        );
        console.log(`[Push] requestFullPermission (${platform}) AFTER requestPermissions:`, permStatus.receive);
      }

      const recheck = await withTimeout(
        PN.checkPermissions(),
        CHECK_PERMISSIONS_TIMEOUT_MS,
        'requestFullPermission recheck timed out'
      );
      const finalStatus = recheck.receive;

      if (finalStatus !== 'granted') {
        const isDenied = finalStatus === 'denied';
        setPermissionStatus(isDenied ? 'denied' : 'prompt');
        console.log(`[Push] ✗ Permission not granted. Final: ${finalStatus}`);
        if (!isDenied) {
          console.error('[Push] ✗✗✗ CRITICAL: Permission still "prompt" after requestPermissions() — OS prompt likely suppressed');
        }
        lastErrorRef.current = new Error(`permission_not_granted:${finalStatus}`);
        markFailed('permission_not_granted', { source: 'request_full_permission', receive: finalStatus });
        return;
      }

      setPermissionStatus('granted');
      await setPushStage('full');

      if (platform === 'ios') {
        try {
          console.log('[Push] iOS permission granted — calling PN.register() to trigger APNs registration event');
          await waitForListenersReady('request_full_permission');
          await withTimeout(
            PN.register(),
            REGISTER_TIMEOUT_MS,
            'requestFullPermission register timed out'
          );
        } catch (e) {
          console.warn('[Push] PN.register() failed in requestFullPermission:', e);
          lastErrorRef.current = e;
          markFailed('request_full_permission_register_failed', { source: 'request_full_permission' });
          return;
        }

        // Give the registration event a moment to fire and capture APNs token.
        await new Promise((r) => setTimeout(r, 800));
        console.log(`[Push] APNs token after register(): ${apnsTokenRef.current?.substring(0, 16) ?? 'null'}`);
      }

      console.log(`[Push] ✓ Permission granted — reconciling runtime token`);
      const reconciled = await withTimeout(reconcileRuntimeToken('request_full_permission'), LOGIN_RECONCILE_TIMEOUT_MS, 'requestFullPermission reconcile timed out');
      if (reconciled) {
        console.log('[Push] Runtime token reconciled after permission grant');
        return;
      }

      // Fallback: trigger registration — token will arrive via the 'registration' listener
      registrationStateRef.current = 'idle';
      retryCountRef.current = 0;
      await withTimeout(
        attemptRegistration(),
        REGISTER_TIMEOUT_MS + FCM_GETTOKEN_TIMEOUT_MS,
        'requestFullPermission fallback attemptRegistration timed out'
      );
    } catch (err) {
      console.error('[Push] requestFullPermission error:', err);
      registrationStateRef.current = 'idle';
      lastErrorRef.current = err;
      markFailed('request_full_permission_exception', { source: 'request_full_permission' });
    }
  }, [attemptRegistration, reconcileRuntimeToken, markFailed, waitForListenersReady]);

  return {
    token,
    permissionStatus,
    registerPushNotifications: attemptRegistration,
    requestFullPermission,
    removeTokenFromDatabase,
  };
}
