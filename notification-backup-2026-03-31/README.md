# 🔔 Notification System — Stable Backup (2026-03-31)

## Status: WORKING & VERIFIED IN PRODUCTION

### Architecture Summary

```text
Order event (INSERT or UPDATE)
  → DB trigger: INSERT into notification_queue
  → notification_queue INSERT trigger: net.http_post → process-notification-queue
  → process-notification-queue: claims batch via claim_notification_queue (FOR UPDATE SKIP LOCKED)
  → DIRECT APNs / FCM delivery (inlined, no function-to-function hop)
  → Cron sweep every 60s picks up any missed items
```

### Key Design Decisions

1. **Inline Push Delivery**: APNs and FCM sending logic is directly inside `process-notification-queue/index.ts`. The old `send-push-notification` function is NOT called from the queue processor (eliminated the double-hop failure point).

2. **Credential Caching**: Firebase service account + APNs keys loaded ONCE per batch invocation, not per notification.

3. **Safe Token Handling**: Invalid tokens (APNs 410, FCM UNREGISTERED) are marked `invalid=true` with `invalid_count` incremented — never deleted on first failure.

4. **Queue-Level Retries**: Failed pushes re-queued as `pending` with 15s delay. Max 9 total attempts before dead-lettering.

5. **Partial Failure**: Each device token processed independently in try/catch. One failure never blocks others.

6. **Dual-Plugin iOS**: `@capacitor/push-notifications` for permissions + raw APNs token, `@capacitor-community/fcm` for FCM token on iOS.

7. **Listener Gate**: Listeners are set up before `register()` is called to prevent race conditions.

8. **Deduplication**: Same (user_id, type, reference_path) within 60s → skip. `queue_item_id` unique constraint prevents duplicate in-app notifications on retry.

9. **Guards**: Staleness (>5 min), terminal state, state-mismatch checks. Initial order alerts (placed/enquired/requested) are exempt.

10. **Sound**: iOS uses `gate_bell.mp3` in APNs payload. Android uses `gate_bell` sound + `orders_alert` channel.

### File Mapping (Backup → Original Location)

| Backup File | Original Location |
|-------------|-------------------|
| `edge-functions/process-notification-queue.ts.bak` | `supabase/functions/process-notification-queue/index.ts` |
| `edge-functions/send-push-notification.ts.bak` | `supabase/functions/send-push-notification/index.ts` |
| `edge-functions/credentials.ts.bak` | `supabase/functions/_shared/credentials.ts` |
| `client/usePushNotifications.ts.bak` | `src/hooks/usePushNotifications.ts` |
| `client/PushNotificationContext.tsx.bak` | `src/contexts/PushNotificationContext.tsx` |
| `client/PushNotificationProvider.tsx.bak` | `src/components/notifications/PushNotificationProvider.tsx` |
| `client/EnableNotificationsBanner.tsx.bak` | `src/components/notifications/EnableNotificationsBanner.tsx` |
| `client/useUnreadNotificationCount.ts.bak` | `src/hooks/useUnreadNotificationCount.ts` |
| `client/pushLogger.ts.bak` | `src/lib/pushLogger.ts` |
| `client/notification-routes.ts.bak` | `src/lib/notification-routes.ts` |
| `client/capacitor.ts.bak` | `src/lib/capacitor.ts` |
| `client/NotificationDiagnostics.tsx.bak` | `src/components/admin/NotificationDiagnostics.tsx` |

### Database Schema (Relevant Tables)

- `device_tokens`: user_id, token, platform, apns_token, invalid (bool), invalid_count (int)
- `notification_queue`: user_id, title, body, type, reference_path, payload, status, retry_count, last_error
- `user_notifications`: user_id, title, body, type, reference_path, queue_item_id (unique), is_read
- `notification_preferences`: user_id, orders, chat, promotions, sounds
- `push_logs`: user_id, level, message, metadata

### DB Functions

- `claim_notification_queue(batch_size)`: Atomically claims pending items using FOR UPDATE SKIP LOCKED
- `claim_device_token(p_user_id, p_token, p_platform, p_apns_token)`: Atomic token registration with auto-purge of old entries

### Triggers

- `trg_enqueue_order_placed_notification`: Fires on INSERT to orders → enqueues seller notification
- `trg_enqueue_order_status_notification`: Fires on UPDATE to orders.status → enqueues buyer/seller notification based on category_status_flows
- `notification_queue INSERT trigger`: Fires net.http_post to invoke process-notification-queue

### Build ID
`2026-03-07-DUAL-PLUGIN-V2-LISTENER-GATE`

### Verified Behaviors
- ✅ COD order → seller receives push within 3 seconds
- ✅ Razorpay order → seller receives push within 3 seconds
- ✅ Multi-store seller → receives pushes for ALL stores
- ✅ Invalid token → marked invalid, NOT deleted
- ✅ Failed delivery → item re-queued with 15s delay
- ✅ Same event twice → only one push delivered (idempotency)
- ✅ APNs direct delivery confirmed (HTTP 200, apns-id received)
- ✅ FCM delivery confirmed
- ✅ End-to-end push on physical iOS device
