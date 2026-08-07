/**
 * Notification preference fetch/mapping helpers.
 * Settings UI must never block forever on a hung Supabase round-trip.
 */

export interface NotificationPreferences {
  orders: boolean;
  chat: boolean;
  promotions: boolean;
  sounds: boolean;
  quiet_hours_enabled: boolean;
  quiet_hours_start: number;
  quiet_hours_end: number;
}

export const DEFAULT_NOTIFICATION_PREFERENCES: NotificationPreferences = {
  orders: true,
  chat: true,
  promotions: true,
  sounds: true,
  quiet_hours_enabled: false,
  quiet_hours_start: 22,
  quiet_hours_end: 7,
};

export const NOTIFICATION_PREFS_FETCH_TIMEOUT_MS = 8_000;

export function mapNotificationPreferencesRow(
  data: Partial<NotificationPreferences> | null | undefined,
): NotificationPreferences {
  if (!data) return { ...DEFAULT_NOTIFICATION_PREFERENCES };
  return {
    orders: data.orders ?? true,
    chat: data.chat ?? true,
    promotions: data.promotions ?? true,
    sounds: data.sounds ?? true,
    quiet_hours_enabled: !!data.quiet_hours_enabled,
    quiet_hours_start: data.quiet_hours_start ?? 22,
    quiet_hours_end: data.quiet_hours_end ?? 7,
  };
}

/** Reject if `promise` does not settle within `ms`. */
export function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`${label} timed out after ${ms}ms`));
    }, ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (err) => {
        clearTimeout(timer);
        reject(err);
      },
    );
  });
}

type PrefsClient = {
  from: (table: string) => {
    select: (columns: string) => {
      eq: (column: string, value: string) => {
        maybeSingle: () => Promise<{ data: Partial<NotificationPreferences> | null; error: { message?: string } | null }>;
      };
    };
  };
};

/**
 * Load channel toggles for settings.
 * Throws on transport/timeout errors so React Query can expose retry UI;
 * callers should supply placeholderData so the screen still renders.
 */
export async function fetchNotificationPreferences(
  client: PrefsClient,
  userId: string,
  timeoutMs: number = NOTIFICATION_PREFS_FETCH_TIMEOUT_MS,
): Promise<NotificationPreferences> {
  if (!userId) return { ...DEFAULT_NOTIFICATION_PREFERENCES };

  const result = await withTimeout(
    client
      .from('notification_preferences')
      .select('orders, chat, promotions, sounds, quiet_hours_enabled, quiet_hours_start, quiet_hours_end')
      .eq('user_id', userId)
      .maybeSingle(),
    timeoutMs,
    'notification_preferences',
  );

  if (result.error) {
    console.warn('[Notifications] Failed to fetch preferences:', result.error);
    throw new Error(result.error.message || 'Failed to fetch notification preferences');
  }

  return mapNotificationPreferencesRow(result.data);
}
