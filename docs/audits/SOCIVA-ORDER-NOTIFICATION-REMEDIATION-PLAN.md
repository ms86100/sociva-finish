# Sociva seller order alerts: remediation plan

Date: 2026-10-10
Status: proposal for review. Not implemented. Production is unchanged.
Audit: [SOCIVA-ORDER-NOTIFICATION-RELIABILITY-AUDIT.md](SOCIVA-ORDER-NOTIFICATION-RELIABILITY-AUDIT.md)

## Requirement

Every new seller order must ring the seller's phone without Sociva staying open. The closed-app path is a server alert delivered by Android or iOS. JavaScript in the seller app may add an on-screen alert while the app is open. It is not the path that runs when the app is gone.

This plan does not promise delivery the operating system can block: notification permission denied, a muted channel, Do Not Disturb or Focus, the silent switch, volume at zero, or an Android force-stop until the user opens the app again. Those limits will be documented, not hidden.

## What stays

- `notification_queue` remains the durable obligation.
- `process-notification-queue` remains the sender. It already builds an FCM and APNs **alert** (not a silent data push) with priority 10.
- `useNewOrderAlert` stays as the open-app bell only. It must not be required for a closed phone.
- Seller identity stays `seller_profiles.user_id` for `orders.seller_id`.
- Custom sound name stays `gate_bell` on Android and `gate_bell.mp3` on iOS, channel `orders_incoming_v2`.

## Phase 1: stop silent success (P0)

These are code defects. No new product behavior beyond "a failed alert stays failed and visible."

1. **Enqueue must not vanish.**
   In `enqueue_seller_new_order_notification` (`supabase/migrations/20260822150000_fix_new_order_notification_trigger.sql`), `EXCEPTION WHEN OTHERS THEN RAISE WARNING` lets the order commit with no queue row.
   Change: write the queue row in the same transaction as the order. If the insert fails, record a durable `notification_failures` row (order id, seller user id, error) in that same transaction, then re-raise only if even that failure row cannot be written. A committed order then always has either a queue row or a visible failure row.
   Also enqueue when the order is inserted already in `placed` or `preparing`, not only on `payment_pending` to those statuses and not only when the first item is inserted after status has left `payment_pending`. Today an item inserted while status is still `payment_pending` returns without a queue row and depends on a later status update.

2. **No token is not "processed".**
   `deliverPushToUser` returns `{ successCount: 0, failCount: 0 }` when `device_tokens` is empty. The worker then sets `status = processed` and `push_skip_reason = no_tokens`.
   Change: set `status = blocked`, `push_skip_reason = no_tokens`, and `next_retry_at` a few minutes ahead. Do not set `processed_at`. A later worker pass sends once a token exists. After a documented window (proposed: 30 minutes), move to dead letter and escalation, still not to `processed`.

3. **Missing credentials are not "processed".**
   The `no_credentials` branch today marks the row processed. Change: `status = failed` (or `blocked`), `push_skip_reason = no_credentials`, dead letter, and an operator log. Retry only after credentials are present. Do not tell the system the seller was notified.

4. **Every new seller order is urgent, including `preparing`.**
   Add `preparing` to `SELLER_HIGH_PRIORITY_STATUSES` in `process-notification-queue`. Auto-accepted orders must request `gate_bell` and must not be dropped by quiet hours or the non-urgent rate limit.

5. **Retries.**
   Replace the fixed 15 second delay with bounded exponential backoff and jitter (proposed: 15s, 30s, 2m, 5m, 15m, cap 30m). Keep the attempt cap. Invalid token (`INVALID_TOKEN`, APNs 410) is permanent for that token: mark the token invalid and keep trying other tokens. If no token remains, use the blocked state from item 2, not a fake success.
   Transient provider errors stay pending until the cap, then dead letter.

## Phase 2: closed-app sound (P0/P1)

6. **Package `gate_bell.mp3` in the binaries sellers install.**
   The workspace has no `gate_bell.mp3`. Codemagic copies `ios-config/gate_bell.mp3` only if the file exists, into the iOS app bundle and `android/app/src/main/res/raw/gate_bell.mp3`.
   Change: add the file to the repo (or a required CI secret path that fails the build when absent). The Android and iOS build scripts must fail, not skip, when the file is missing. Android resource name is `gate_bell` with no extension in the payload. iOS payload stays `gate_bell.mp3`.

7. **Android channel.**
   Channel settings are immutable. `orders_incoming_v2` is created only after the app process runs `createChannel`.
   Change: create `orders_incoming_v2` from native Android startup (Application or a small Capacitor plugin init), not only from the React effect, so the first push after install can use it once the process has started at least once. Document that a push before the app has ever been opened after install may use the default channel. If a previous install created `orders_incoming_v2` without the sound file, ship a new channel id (`orders_incoming_v3`) with the file present. Do not reuse a silent channel id.

8. **iOS payload.**
   Keep `apns-push-type: alert`, `apns-priority: 10`, and `aps.sound = gate_bell.mp3`. Do not switch new-order pushes to a silent or background push. Confirm the production APNs topic is the App Store bundle id, not a sandbox or mismatched bundle. That credential check is read-only and must happen before release.

9. **Foreground duplicates.**
   While the app is open, play the bell once. If `useNewOrderAlert` already started the local bell for that order id, the foreground `pushNotificationReceived` handler must not schedule a second local notification and must not return early in a way that cancels the one already playing.
   Keep suppression only when the seller is already on that order's screen and has the alert in front of them. Do not suppress because a haptic fired in the last 3 seconds. Do not suppress a new order because Live Activity is tracking a different order.

10. **More than one phone.**
    `deliverPushToUser` keeps a single token per platform. A seller with two Android phones only gets one.
    Change: send to every non-invalid token for that user. Dedupe by token string, not by platform. Cap at a small number (proposed: 8) so a token leak cannot fan out without bound.

## Phase 3: acknowledgment escalation (P1)

11. **Separate states.**
    Do not overload `processed`.
    - Order committed.
    - Obligation persisted (`pending`, `blocked`, or `failed`).
    - Dispatch attempted (`push_attempted`, attempt count, last error).
    - Provider accepted (`push_success_count > 0`). This is not device receipt and not a heard bell.
    - Seller acknowledged: existing order accept or reject. That is the business ack. A push HTTP 200 is not an ack.

12. **Unnoticed orders.**
    `send-seller-status-reminders` today looks for status `accepted`, not a new order waiting for a first response.
    Add a worker, on the same cron secret as the queue, for orders still in `placed`, `enquired`, `requested`, or `quoted` (and auto-accepted `preparing` if that status still needs a human) with no seller response after a threshold (proposed: 3 minutes, then 10 minutes, then stop).
    Each pass inserts one new queue row with its own idempotency key (`order id + reminder bucket`), type `seller_order_status_reminder`, high priority, same bell. It must not create another order.
    Stop when the seller accepts, rejects, or the order is cancelled. Cap at 3 audible reminders so a stuck order cannot ring all day.
    If the obligation is `blocked` for no token, the reminder still records the gap and does not pretend a push was sent.

## Phase 4: wake-up and monitoring (P1/P2)

13. **Server wake, not the buyer app.**
    Insert on `notification_queue` already calls `fn_invoke_notification_worker`. Confirm in production, read-only, that Vault `pnq_worker_secret` exists and the cron job `wakeup_notification_queue_if_pending` is scheduled. If the secret is missing, insert wake-ups are skipped. The buyer app's `process-notification-queue` call may stay as a hint, but a swallowed client error must not be the only wake.
    Tighten the safety cron from every 10 minutes to every minute for pending or blocked rows whose `next_retry_at` is due. That is a schedule change and needs approval before it is applied to production.

14. **Logs to alert on.**
    - Orders with neither a queue row nor a `notification_failures` row.
    - `push_skip_reason` of `no_tokens` or `no_credentials`.
    - Dead letters for type `order`.
    - Pending age over 2 minutes.
    - Orders still unaccepted after the last reminder.

## What this will not claim

- Android force-stop blocks FCM until the user opens the app. The obligation stays pending and sends after the next successful registration or the next allowed delivery. The app cannot override force-stop.
- Permission denied, a channel the user muted, Focus, the silent switch, and volume at zero can hide the sound. The queue can still show provider acceptance. That is not a heard bell.
- A test pass is only the cases that were run.

## Verification before any production apply

Use staging and two isolated accounts. Do not place orders against real sellers.

Record order id, queue id, commit time, dispatch time, provider status code, and whether a person heard the bell.

| Case | Pass |
| --- | --- |
| Android app open | One bell, order visible, no second overlapping bell |
| Android background and swipe away | System notification and `gate_bell` without the seller app in front |
| Android screen off | Same, unless the OS sound policy blocks it, and that block is written down |
| iPhone open, background, swiped away, locked | Alert push with `gate_bell.mp3`, not a silent push |
| Airplane mode on the seller phone during place, then online | Queue stays pending or blocked, then sends. It does not show processed during the outage |
| Seller with no token | Row is blocked, not processed |
| Two orders at once | Two obligations, two sounds, no second copy of the order |
| Seller accepts | Reminders stop |
| Seller does not accept | At most the capped reminders, no new order |

Also confirm the release APK and IPA contain the sound file (Android `res/raw`, iOS bundle), and that `orders_incoming_v3` (if a new id is required) exists on a phone that already had an older channel.

## Release criterion

No known path may mark a seller notified when no push was accepted, no token existed, or enqueue failed. P0 and P1 items above are in the build that is tested. The device table passes on at least one current Android phone and one iPhone. Remaining OS limits are listed in the release note.

## Approval needed before implementation

This document is the review copy. Applying it means a new migration, an Edge Function change, a native channel change, and a binary that contains the sound. None of that is applied to production by this plan.
