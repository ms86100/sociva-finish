import { Capacitor } from '@capacitor/core';
import { SplashScreen } from '@capacitor/splash-screen';
import { StatusBar, Style } from '@capacitor/status-bar';
import { preloadHaptics } from '@/lib/haptics';
import { migrateLocalStorageToPreferences } from '@/lib/capacitor-storage';
import { restoreAppPreferences } from '@/lib/persistent-kv';

export async function initializeCapacitorPlugins() {
  // Fire-and-forget haptics preload (no-op on web)
  preloadHaptics();

  if (!Capacitor.isNativePlatform()) {
    return;
  }

  // Non-blocking storage migration — don't await, don't block boot
  migrateLocalStorageToPreferences().catch(e =>
    console.warn('[Capacitor] Storage migration failed:', e)
  );
  restoreAppPreferences().catch(e =>
    console.warn('[Capacitor] Preferences restore failed:', e)
  );

  try {
    await StatusBar.setStyle({ style: Style.Light });
    await StatusBar.setBackgroundColor({ color: '#F97316' });
  } catch (error) {
    console.error('Error configuring status bar:', error);
  }

  try {
    const { Keyboard } = await import('@capacitor/keyboard');
    await Keyboard.setResizeMode({ mode: 'body' as any });
    await Keyboard.setScroll({ isDisabled: false });
  } catch (error) {
    console.error('Error configuring keyboard:', error);
  }

  // Schedule a hard timeout to force-hide splash if auth layer never calls hideSplashScreen()
  // This prevents permanent black screen if session restore hangs
  scheduleSplashTimeout();
}

export function isNativePlatform(): boolean {
  return Capacitor.isNativePlatform();
}

export function getPlatform(): 'ios' | 'android' | 'web' {
  return Capacitor.getPlatform() as 'ios' | 'android' | 'web';
}

/** Hide splash screen — call after auth session is restored */
let splashHidden = false;
export async function hideSplashScreen() {
  if (splashHidden || !Capacitor.isNativePlatform()) return;
  splashHidden = true;
  try {
    await SplashScreen.hide();
  } catch (e) {
    console.error('Error hiding splash screen:', e);
  }
}

/**
 * Hard timeout fail-safe: force-hide splash after 4 seconds no matter what.
 * Prevents permanent black screen if auth restore hangs on mobile.
 */
let splashTimeoutId: ReturnType<typeof setTimeout> | null = null;
function scheduleSplashTimeout() {
  if (splashTimeoutId) return;
  splashTimeoutId = setTimeout(() => {
    if (!splashHidden) {
      console.warn('[Capacitor] Splash screen timeout — force-hiding after 4s');
      hideSplashScreen();
    }
  }, 4000);
}
