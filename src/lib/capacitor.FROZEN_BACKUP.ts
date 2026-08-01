// @ts-nocheck
import { Capacitor } from '@capacitor/core';
import { SplashScreen } from '@capacitor/splash-screen';
import { StatusBar, Style } from '@capacitor/status-bar';
import { preloadHaptics } from '@/lib/haptics';
import { migrateLocalStorageToPreferences } from '@/lib/capacitor-storage';
import { restoreAppPreferences } from '@/lib/persistent-kv';

export async function initializeCapacitorPlugins() {
  preloadHaptics();
  if (!Capacitor.isNativePlatform()) return;

  migrateLocalStorageToPreferences().catch(e => console.warn('[Capacitor] Storage migration failed:', e));
  restoreAppPreferences().catch(e => console.warn('[Capacitor] Preferences restore failed:', e));

  try {
    await StatusBar.setStyle({ style: Style.Light });
    await StatusBar.setBackgroundColor({ color: '#F97316' });
  } catch (error) { console.error('Error configuring status bar:', error); }

  try {
    const { Keyboard } = await import('@capacitor/keyboard');
    await Keyboard.setResizeMode({ mode: 'body' as any });
    await Keyboard.setScroll({ isDisabled: false });
  } catch (error) { console.error('Error configuring keyboard:', error); }

  try { await SplashScreen.hide(); } catch (error) { console.error('Error hiding splash screen:', error); }
}

export function isNativePlatform(): boolean { return Capacitor.isNativePlatform(); }
export function getPlatform(): 'ios' | 'android' | 'web' { return Capacitor.getPlatform() as 'ios' | 'android' | 'web'; }
