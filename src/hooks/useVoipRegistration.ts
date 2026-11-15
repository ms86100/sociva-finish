import { useEffect, useRef } from 'react';
import { Capacitor } from '@capacitor/core';
import { claimVoipToken } from '@/lib/calling/CallManager';
import { SocivaVoip } from '@/plugins/voip';

/**
 * Registers PushKit / FCM VoIP tokens with claim_voip_token.
 * CallKit accept/end + LiveKit join are owned by ActiveCallOverlay.
 */
export function useVoipRegistration(userId: string | null | undefined) {
  const claimedRef = useRef<string | null>(null);

  useEffect(() => {
    if (!userId || !Capacitor.isNativePlatform()) return;

    let cancelled = false;
    const handles: Array<{ remove: () => Promise<void> }> = [];

    const claim = async (token: string, platform: 'ios_pushkit' | 'android_fcm') => {
      if (!token || claimedRef.current === token) return;
      try {
        await claimVoipToken(token, platform);
        claimedRef.current = token;
      } catch (e) {
        console.warn('[voip] claim_voip_token failed', e);
      }
    };

    (async () => {
      try {
        const tokenHandle = await SocivaVoip.addListener('voipToken', (data) => {
          const token = String(data?.token || '');
          const platform =
            data?.platform === 'android_fcm' ? 'android_fcm' : 'ios_pushkit';
          void claim(token, platform);
        });
        handles.push(tokenHandle);

        await SocivaVoip.requestCallPermissions().catch(() => {});

        if (Capacitor.getPlatform() === 'ios') {
          const reg = await SocivaVoip.registerVoipToken();
          if (reg?.ok && reg.token) {
            await claim(reg.token, 'ios_pushkit');
          }
        } else if (Capacitor.getPlatform() === 'android') {
          try {
            const { FCM } = await import('@capacitor-community/fcm');
            const { token } = await FCM.getToken();
            if (token && !cancelled) {
              await SocivaVoip.registerVoipToken({
                token,
                platform: 'android_fcm',
              });
              await claim(token, 'android_fcm');
            }
          } catch {
            // FCM plugin may be unavailable on some builds
          }
        }
      } catch (e) {
        console.warn('[voip] registration bootstrap failed', e);
      }
    })();

    return () => {
      cancelled = true;
      handles.forEach((h) => {
        void h.remove();
      });
    };
  }, [userId]);
}
