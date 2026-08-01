// @ts-nocheck
import type { DiagnosticResult } from './pushDiagnostics';

export type ActionType = 'none' | 'openSettings' | 'retry';

export interface UserFriendlyStatus {
  label: string;
  ok: boolean;
  actionType: ActionType;
  /** Message shown to the user */
  message: string;
  /** Optional technical detail surfaced under the message when not ok */
  detail?: string;
}

/**
 * Converts the technical DiagnosticResult[] into 4 simple user-facing status items.
 * No technical jargon — just plain language.
 */
export function summariseDiagnostics(results: DiagnosticResult[]): UserFriendlyStatus[] {
  const find = (prefix: string) => results.find((r) => r.step.startsWith(prefix));

  // Special case: running on web (non-native). Push notifications are only
  // supported inside the installed mobile app, so showing 4 red items
  // (including a misleading "Could not send test — please try again later")
  // is confusing. Surface a single, accurate status instead.
  const platformResult = find('1. Platform');
  const isWeb = platformResult && !platformResult.ok && /web/i.test(platformResult.detail ?? '');
  if (isWeb) {
    return [
      {
        label: 'Platform',
        ok: true, // not an error — just not applicable here
        actionType: 'none',
        message: 'Push notifications work in the mobile app. Web preview is not supported.',
      },
    ];
  }

  // 1. Permission
  const permResult = find('3. Permission');
  const permOk = permResult?.ok ?? false;

  // 2. Device setup (plugin loaded + platform is native)
  const pluginResult = find('2. PushNotifications');
  const setupOk = (platformResult?.ok ?? false) && (pluginResult?.ok ?? false);

  // 3. Token registered in DB
  const dbResult = find('6. device_tokens');
  const registeredOk = dbResult?.ok ?? false;

  // 4. Delivery health (test notification queued)
  const queueResult = find('7. Queued test');
  const deliveryOk = queueResult?.ok ?? false;

  // If the queue test was skipped because earlier steps failed, say so
  // explicitly rather than the misleading "please try again later".
  const deliverySkipped =
    !deliveryOk && /skip/i.test(queueResult?.detail ?? '');

  return [
    {
      label: 'Permission',
      ok: permOk,
      actionType: permOk ? 'none' : 'openSettings',
      message: permOk
        ? 'Notification permission is enabled'
        : 'Notifications are turned off',
      detail: !permOk ? permResult?.detail : undefined,
    },
    {
      label: 'Device Setup',
      ok: setupOk,
      actionType: setupOk ? 'none' : 'retry',
      message: setupOk
        ? 'Your device is set up for notifications'
        : 'Setup incomplete — tap to retry',
      detail: !setupOk ? (pluginResult?.detail ?? platformResult?.detail) : undefined,
    },
    {
      label: 'Registration',
      ok: registeredOk,
      actionType: registeredOk ? 'none' : 'retry',
      message: registeredOk
        ? 'Your device is registered'
        : 'Registration pending — tap to retry',
      detail: !registeredOk ? dbResult?.detail : undefined,
    },
    {
      label: 'Delivery',
      ok: deliveryOk,
      actionType: deliveryOk ? 'none' : 'retry',
      message: deliveryOk
        ? 'Everything is working correctly'
        : deliverySkipped
          ? 'Test skipped — fix the steps above first'
          : 'Test notification could not be queued',
      detail: !deliveryOk ? queueResult?.detail : undefined,
    },
  ];
}
