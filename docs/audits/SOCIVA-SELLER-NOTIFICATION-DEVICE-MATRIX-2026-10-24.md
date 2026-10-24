# Seller notification device matrix

Date: 2026-10-24
Project: kkzkuyhgdvyecmxtmkpy
Rule: FCM or APNs HTTP 200 is provider acceptance, not shade display or audible bell.
Orders: no real customer orders. Designated test seller/buyer only.

## Backend freeze (verified)

- `process-notification-queue` v97, `verify_jwt=false`, `emergency: false`. Seller `sent:0` is blocked/retried, not processed.
- `send-push-notification` v67, `verify_jwt=true`. `skip_reason=no_tokens`. Token-string dedupe, cap 8. Unstamped Android stays on `orders_incoming_v2`. Buyer cannot inherit seller `gate_bell`.
- Stamp RPC returns jsonb `{updated}` and can write `order_alert_native_v1` onto valid Android tokens. Live fleet: 0/138 tokens stamped, 68 valid Android rows. Data-only v3 is therefore still unused.
- Item trigger skips booking / service_booking. Reschedule seller copy is live (`Appointment rescheduled`).
- Event B cron `send_scheduled_order_reminders_every_5m` is `*/5 * * * *` and active.

## How to record a physical case

For each case below record: OS version, app `versionCode` / `CFBundleVersion`, store hours, order type, payment method, queue id, SPN `push_priority` log, FCM/APNs status (no raw tokens), shade vs sound, Android channel id in system settings.

Pass = provider log + device display + (for high-priority) audible bell when OS settings allow. Provider 200 alone is fail for bell cases.

## Cases

| # | Case | Expect | Status 2026-10-24 |
| --- | --- | --- | --- |
| 1 | Android, app killed, screen off, instant COD, store open | Tray notification, `gate_bell` on v2 (current prod) or v3 if stamped. Fail if only in-app after open. | BLOCKED. No designated Android test device in this run. Backend still sends v2 notification+data because 0 tokens are stamped. |
| 2 | Same, store closed, scheduled slot | Event A immediately with title `Scheduled order for ...`. Fail if silent until next open. | BLOCKED physical. Backend Event A enqueue at placement was confirmed in the audit; not re-fired on a customer order. |
| 3 | Wait until `preparation_start_at` | Event B `Start preparing now`, or document cron miss | BLOCKED physical. Cron is now every 5 minutes (was hourly). Window-miss risk is reduced, not ear-verified. |
| 4 | iOS killed + locked, Silent off, Focus off | Banner + `gate_bell.caf`. Repeat Silent on (no sound). Repeat Focus without Time Sensitive (suppressed sound). | BLOCKED. No designated iOS test device. Backend still requests `gate_bell.caf` and time-sensitive for placed/enquired/requested/confirmed seller events. |
| 5 | Android DND with and without override DND for the channel | Sound only when the channel may bypass DND | BLOCKED. App still does not call `setBypassDnd`. |
| 6 | Notification permission denied | No tray. Queue must not sit in processed-success forever | BACKEND PASS / DEVICE BLOCKED. Worker v97 treats seller `sent:0` as `blocked` then `failed` after 30 minutes, writes `push_success_count=0`. Not exercised on a device. |
| 7 | Booking create | Exactly one seller high-priority push, dest `/orders/{id}`. Reschedule: seller push | BACKEND PASS / DEVICE BLOCKED. Item trigger skips booking. `New Booking Confirmed` kept. Reschedule `notify_seller=true`. No test booking placed. |
| 8 | Multi-vendor | Each seller one push | BLOCKED. No test checkout. Enqueue-per-seller path unchanged. |
| 9 | Two Android devices, same seller | Both ring | BACKEND PASS / DEVICE BLOCKED. SPN v67 dedupes by token, cap 8, not one-per-platform. Needs two signed-in devices. |
| 10 | Foreground | At most one OS sound plus optional in-app loop | BLOCKED. JS `presentationOptions` still include alert; not retested on a device. |

## Not run on purpose

- No customer orders.
- No store-binary unpack of Play/App Store `gate_bell` assets in this run.
- No claim that FCM/APNs 200 reached a speaker.

## Unblock

Ship the client with `PUSH_BUILD_ID=2026-10-24-SELLER-ALERT-STAMP-RETRY` so Android tokens stamp. Then run cases 1-10 on named test devices and fill OS version, versionCode, queue id, and heard/not-heard.
