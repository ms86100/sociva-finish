/**
 * Play the Sociva order bell (public/sounds/gate_bell.mp3).
 * On Android Capacitor, prefer the native OrderAlertRinger (Ringtone /
 * USAGE_NOTIFICATION_RINGTONE) so Chromium does not publish a MediaSession
 * that shows system media playback controls.
 * Web / iOS keep HTMLAudioElement with MediaSession cleared as a safety net.
 */
import { Capacitor } from '@capacitor/core';
import { startNativeOrderAlert } from '@/plugins/order-alert-ringer';

const recent = new Map<string, number>();
const DEDUPE_MS = 12_000;

function clearWebMediaSession(): void {
  try {
    const ms = (navigator as Navigator & {
      mediaSession?: {
        metadata: unknown;
        playbackState: string;
        setActionHandler?: (action: string, handler: null) => void;
      };
    }).mediaSession;
    if (!ms) return;
    ms.metadata = null;
    ms.playbackState = 'none';
    const actions = [
      'play', 'pause', 'stop', 'seekbackward', 'seekforward',
      'seekto', 'previoustrack', 'nexttrack',
    ];
    for (const action of actions) {
      try {
        ms.setActionHandler?.(action, null);
      } catch {
        /* unsupported action */
      }
    }
  } catch {
    /* MediaSession may be unavailable */
  }
}

export function playGateBell(orderId?: string): void {
  if (typeof window === 'undefined') return;
  const now = Date.now();
  if (now - (recent.get('bell') || 0) < DEDUPE_MS) return;
  if (orderId && now - (recent.get(orderId) || 0) < DEDUPE_MS) return;
  recent.set('bell', now);
  if (orderId) recent.set(orderId, now);

  // Android native: Ringtone path - never HTML audio (avoids media player UI).
  if (Capacitor.isNativePlatform() && Capacitor.getPlatform() === 'android') {
    if (orderId) {
      void startNativeOrderAlert(orderId);
    }
    clearWebMediaSession();
    return;
  }

  let audio: HTMLAudioElement;
  try {
    audio = new Audio('/sounds/gate_bell.mp3');
    audio.preload = 'auto';
    audio.volume = 1;
  } catch {
    return;
  }

  clearWebMediaSession();
  const pending = audio.play();
  if (!pending || typeof pending.catch !== 'function') return;
  pending
    .then(() => {
      clearWebMediaSession();
    })
    .catch(() => {
      const unlock = () => {
        window.removeEventListener('pointerdown', unlock);
        void audio.play().then(() => clearWebMediaSession()).catch(() => {});
      };
      window.addEventListener('pointerdown', unlock, { once: true });
      window.setTimeout(() => window.removeEventListener('pointerdown', unlock), 20000);
    });
}
