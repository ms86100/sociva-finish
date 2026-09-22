/**
 * Open OS location / app settings when the user has permanently denied GPS.
 */
import { Capacitor } from '@capacitor/core';

export async function openLocationSettings(): Promise<{ opened: boolean; mode: string }> {
  if (!Capacitor.isNativePlatform()) {
    return { opened: false, mode: 'web_noop' };
  }

  const platform = Capacitor.getPlatform();

  if (platform === 'ios') {
    try {
      const { Browser } = await import('@capacitor/browser');
      await Browser.open({ url: 'app-settings:' });
      return { opened: true, mode: 'ios_app_settings' };
    } catch {
      try {
        const { NativeSettings, IOSSettings, AndroidSettings } = await import('capacitor-native-settings');
        await NativeSettings.open({
          optionIOS: IOSSettings.App,
          optionAndroid: AndroidSettings.ApplicationDetails,
        });
        return { opened: true, mode: 'ios_native_settings' };
      } catch {
        return { opened: false, mode: 'ios_failed' };
      }
    }
  }

  try {
    const { NativeSettings, AndroidSettings, IOSSettings } = await import('capacitor-native-settings');
    await NativeSettings.open({
      optionIOS: IOSSettings.App,
      optionAndroid: AndroidSettings.ApplicationDetails,
    });
    return { opened: true, mode: 'android_app_details' };
  } catch {
    try {
      const { Browser } = await import('@capacitor/browser');
      await Browser.open({ url: 'app-settings:' });
      return { opened: true, mode: 'android_app_settings_fallback' };
    } catch {
      return { opened: false, mode: 'android_failed' };
    }
  }
}
