/**
 * In-app WhatsApp opt-in helper.
 *
 * Opening wa.me + the user sending the prefilled message starts Meta's ~24h
 * customer service window so Sociva can send free-form status updates.
 * A business-side "hello register me" TEMPLATE is NOT required for this
 * user-initiated opt-in. Once custom `sociva_*` templates are APPROVED,
 * status messages can be sent even without a recent "hi".
 */
import { Capacitor } from '@capacitor/core';
import { supabase } from '@/integrations/supabase/client';

/** Digits only for wa.me (business +91 99029 20804) */
export const SOCIVA_WHATSAPP_DIGITS = '919902920804';

export const WHATSAPP_OPTIN_MESSAGE =
  'Hi Sociva, register me for order and delivery updates.';

export const WHATSAPP_OPTIN_DISMISS_KEY = 'wa_updates_cta_dismissed';

export function buildWhatsAppOptInUrl(message: string = WHATSAPP_OPTIN_MESSAGE): string {
  return `https://wa.me/${SOCIVA_WHATSAPP_DIGITS}?text=${encodeURIComponent(message)}`;
}

/** Open native WhatsApp (preferred) or browser fallback. */
export async function openWhatsAppChat(message: string = WHATSAPP_OPTIN_MESSAGE): Promise<void> {
  const url = buildWhatsAppOptInUrl(message);

  try {
    if (Capacitor.isNativePlatform()) {
      try {
        const { App } = await import('@capacitor/app');
        if (typeof (App as any).openUrl === 'function') {
          await (App as any).openUrl({ url });
          return;
        }
      } catch {
        /* fall through */
      }
      // https wa.me hands off to WhatsApp better via location than in-app Browser
      window.location.href = url;
      return;
    }
  } catch {
    /* web */
  }

  const opened = window.open(url, '_blank', 'noopener,noreferrer');
  if (!opened) window.location.href = url;
}

/** Best-effort: mark WhatsApp channel enabled + consent timestamp. */
export async function markWhatsAppOptedIn(userId: string): Promise<void> {
  if (!userId) return;
  const now = new Date().toISOString();
  const { error } = await (supabase.from('notification_preferences') as any).upsert(
    {
      user_id: userId,
      whatsapp: true,
      whatsapp_opted_in_at: now,
      updated_at: now,
    },
    { onConflict: 'user_id' },
  );
  if (error) {
    console.warn('[WhatsApp opt-in] Failed to save preference:', error);
  }
}

export async function openWhatsAppOptIn(userId: string | undefined | null): Promise<void> {
  if (userId) {
    // Fire-and-forget prefs update so the deep link is not delayed
    void markWhatsAppOptedIn(userId);
  }
  await openWhatsAppChat();
}
