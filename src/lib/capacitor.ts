// @ts-nocheck
import { Capacitor } from '@capacitor/core';
import { SplashScreen } from '@capacitor/splash-screen';
import { StatusBar, Style } from '@capacitor/status-bar';
import { preloadHaptics } from '@/lib/haptics';
import { migrateLocalStorageToPreferences } from '@/lib/capacitor-storage';
import { restoreAppPreferences } from '@/lib/persistent-kv';

/** Always publish status-bar height — Android env(safe-area-inset-*) is unreliable. */
async function syncSafeAreaCssVars() {
  const apply = (px: number) => {
    const value = `${Math.max(px, 24)}px`;
    // Set both: --app-safe-top must be a concrete length (nested var()+max() is
    // dropped by some Android WebViews, which zeroed header padding).
    document.documentElement.style.setProperty('--safe-area-inset-top', value);
    document.documentElement.style.setProperty('--app-safe-top', value);
  };
  // Paint with a safe default immediately, then refine from StatusBar.getInfo().
  apply(28);
  try {
    const info = await StatusBar.getInfo();
    const top = Math.max(0, Number(info.height) || 0);
    if (top > 0) apply(top);
  } catch (e) {
    console.warn('[Capacitor] syncSafeAreaCssVars failed:', e);
  }
}

function watchSafeAreaResync() {
  // Re-measure after resume / rotation — some OEMs report 0 until first frame.
  const resync = () => { syncSafeAreaCssVars().catch(() => {}); };
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') resync();
  });
  window.addEventListener('orientationchange', () => setTimeout(resync, 250));
  // Late pass — WebView sometimes lies on first getInfo()
  setTimeout(resync, 500);
  setTimeout(resync, 2000);
}

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
    // Default app theme is dark → light status-bar icons. Keep overlay true so
    // one padding model works everywhere (Android 15+ forces overlay anyway).
    // CSS reads --app-safe-top. Theme changes re-sync via syncStatusBarForTheme().
    const storedTheme = localStorage.getItem('theme');
    const isDark = storedTheme !== 'light';
    await StatusBar.setStyle({ style: isDark ? Style.Light : Style.Dark });
    await StatusBar.setOverlaysWebView({ overlay: true });
    await syncSafeAreaCssVars();
    watchSafeAreaResync();
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

/** Keep native status-bar icon contrast in sync with next-themes. */
export async function syncStatusBarForTheme(theme: string | undefined) {
  if (!Capacitor.isNativePlatform()) return;
  try {
    const isDark = theme !== 'light';
    await StatusBar.setStyle({ style: isDark ? Style.Light : Style.Dark });
  } catch (e) {
    console.warn('[Capacitor] syncStatusBarForTheme failed:', e);
  }
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
  // Also schedule an earlier native hide attempt — Capacitor plugin may be ready before React
  setTimeout(() => {
    if (!splashHidden) {
      console.warn('[Capacitor] Early splash hide at 1.5s');
      hideSplashScreen();
    }
  }, 1500);
}
