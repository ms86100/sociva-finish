// @ts-nocheck
import { Capacitor } from '@capacitor/core';
import { SplashScreen } from '@capacitor/splash-screen';
import { StatusBar, Style } from '@capacitor/status-bar';
import { preloadHaptics } from '@/lib/haptics';
import { migrateLocalStorageToPreferences } from '@/lib/capacitor-storage';
import { restoreAppPreferences } from '@/lib/persistent-kv';

/** Always publish status-bar height — Android env(safe-area-inset-*) is unreliable. */
function readCssEnvInset(side: 'top' | 'right' | 'bottom' | 'left'): number {
  const probe = document.createElement('div');
  probe.setAttribute('aria-hidden', 'true');
  probe.style.cssText = `position:fixed;pointer-events:none;visibility:hidden;padding-${side}:env(safe-area-inset-${side}, 0px);`;
  document.documentElement.appendChild(probe);
  const value = parseFloat(getComputedStyle(probe).getPropertyValue(`padding-${side}`)) || 0;
  probe.remove();
  return value;
}

/**
 * Android WebView often reports 0 bottom inset on cold launch until the first
 * WindowInsets pass. Prefer the larger of env() vs previously known good value,
 * and fall back to a conservative nav-bar height on Android when still 0.
 */
function resolveBottomInset(previousPx = 0): number {
  const envBottom = readCssEnvInset('bottom');
  if (envBottom > 0) return envBottom;
  if (previousPx > 0) return previousPx;
  // Gesture / 3-button nav typically 16–48dp; 24px is a safe minimum that
  // avoids flush CTA collision without looking oversized on tablets.
  if (Capacitor.getPlatform() === 'android') return 24;
  return 0;
}

let lastKnownBottomInset = 0;

async function syncSafeAreaCssVars() {
  const applyTop = (px: number) => {
    const value = `${Math.max(px, 24)}px`;
    // Set both: --app-safe-top must be a concrete length (nested var()+max() is
    // dropped by some Android WebViews, which zeroed header padding).
    document.documentElement.style.setProperty('--safe-area-inset-top', value);
    document.documentElement.style.setProperty('--app-safe-top', value);
  };
  const applySide = (name: 'right' | 'bottom' | 'left', px: number) => {
    const value = `${Math.max(0, px)}px`;
    document.documentElement.style.setProperty(`--safe-area-inset-${name}`, value);
    document.documentElement.style.setProperty(`--app-safe-${name}`, value);
  };
  // Paint with a safe default immediately, then refine from StatusBar.getInfo().
  applyTop(Math.max(28, readCssEnvInset('top')));
  const bottom = resolveBottomInset(lastKnownBottomInset);
  if (bottom > 0) lastKnownBottomInset = bottom;
  applySide('bottom', bottom);
  applySide('left', readCssEnvInset('left'));
  applySide('right', readCssEnvInset('right'));
  try {
    const info = await StatusBar.getInfo();
    const top = Math.max(0, Number(info.height) || 0, readCssEnvInset('top'));
    if (top > 0) applyTop(top);
    const bottomAfter = resolveBottomInset(lastKnownBottomInset);
    if (bottomAfter > 0) lastKnownBottomInset = bottomAfter;
    applySide('bottom', bottomAfter);
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
  window.addEventListener('resize', () => {
    // Debounce lightly — keyboard/nav-bar changes fire resize bursts.
    clearTimeout((watchSafeAreaResync as any)._resizeTimer);
    (watchSafeAreaResync as any)._resizeTimer = setTimeout(resync, 120);
  });
  // After first paint(s) — WebView often lies until layout settles
  requestAnimationFrame(() => requestAnimationFrame(resync));
  setTimeout(resync, 500);
  setTimeout(resync, 2000);
  setTimeout(resync, 4000);
}

export async function initializeCapacitorPlugins() {
  if (!Capacitor.isNativePlatform()) {
    return;
  }

  // Warm haptic generators before first paint interactions (no-op if plugin missing)
  await preloadHaptics();

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
