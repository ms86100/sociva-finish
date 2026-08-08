/**
 * Deep-link helpers for OS notification settings.
 * Android channel settings use Settings.ACTION_CHANNEL_NOTIFICATION_SETTINGS.
 */
import { Capacitor } from '@capacitor/core';

export const ORDERS_INCOMING_CHANNEL_ID = 'orders_incoming_v1';
export const ANDROID_PACKAGE_ID = 'app.sociva.community';

/**
 * Open Android notification channel settings for a specific channel.
 * Falls back to app notification settings, then app details.
 */
export async function openNotificationChannelSettings(
  channelId: string = ORDERS_INCOMING_CHANNEL_ID,
): Promise<{ opened: boolean; mode: string }> {
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
        await NativeSettings.open({ optionIOS: IOSSettings.App, optionAndroid: AndroidSettings.AppNotification });
        return { opened: true, mode: 'ios_native_settings' };
      } catch {
        return { opened: false, mode: 'ios_failed' };
      }
    }
  }

  // Android: prefer channel-specific settings intent
  try {
    const { App } = await import('@capacitor/app');
    const intentUrl =
      `intent:#Intent;action=android.settings.CHANNEL_NOTIFICATION_SETTINGS;` +
      `S.android.provider.extra.APP_PACKAGE=${ANDROID_PACKAGE_ID};` +
      `S.android.provider.extra.CHANNEL_ID=${encodeURIComponent(channelId)};` +
      `end`;
    await (App as unknown as { openUrl: (opts: { url: string }) => Promise<void> }).openUrl({
      url: intentUrl,
    });
    return { opened: true, mode: 'android_channel_intent' };
  } catch {
    // fall through
  }

  try {
    const { NativeSettings, AndroidSettings, IOSSettings } = await import('capacitor-native-settings');
    await NativeSettings.open({
      optionIOS: IOSSettings.App,
      optionAndroid: AndroidSettings.AppNotification,
    });
    return { opened: true, mode: 'android_app_notification' };
  } catch {
    return { opened: false, mode: 'android_failed' };
  }
}

/** Open general app notification settings (any platform). */
export async function openAppNotificationSettings(): Promise<boolean> {
  const result = await openNotificationChannelSettings(ORDERS_INCOMING_CHANNEL_ID);
  return result.opened;
}
