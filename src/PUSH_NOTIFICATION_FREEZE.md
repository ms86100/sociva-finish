# Push notification freeze note (historical)

The March 2026 freeze of push client files is **superseded** by the 2026-08-07
notification audit remediation (terminal sync, `orders_incoming_v1`, LocalNotifications,
Phase 2–4 PNQ hardening).

Live source of truth:
- `src/hooks/usePushNotifications.ts`
- `src/components/notifications/PushNotificationProvider.tsx`
- `supabase/functions/process-notification-queue/index.ts`

Do not restore `.FROZEN_BACKUP` copies for push — they use legacy `gate_bell` / INSERT-only realtime.
