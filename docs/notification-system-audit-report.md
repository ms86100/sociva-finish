# Sociva Notification System — Deep Audit Report

**Date:** 2026-08-07  
**Scope:** Push (FCM/APNs), in-app inbox, realtime, cross-device sync, seller acceptance timers, Android sound/channels, WhatsApp where entangled with the same queue  
**Constraint (original):** Audit only — no application/backend behavior changes  
**Remediation:** See § Remediation status (2026-08-07) — P0/P1 client + PNQ + migration fixes shipped  
**Companion canvas:** `~/.cursor/projects/c-Users-thech-OneDrive-Desktop-Sociva-finish-sociva-v1-main-sociva-v1-main/canvases/notification-system-audit.canvas.tsx` (open beside chat in Cursor)

---

## 1. Executive summary

Sociva’s notification spine is mature at the **enqueue → queue → multi-channel deliver** layer: most events land in `notification_queue`, are claimed by `process-notification-queue` (PNQ), and fan out to **in-app** (`user_notifications`), **push** (FCM/APNs), and **WhatsApp** (best-effort). Client push registration, Android channels, and inbox UI exist and are wired.

The critical production failure mode — **sellers still seeing order-acceptance timers / ringing overlays after a buyer cancels** — is **not** caused by Postgres leaving `auto_cancel_at` set. Cancel correctly nulls the SLA timestamp. The failure is a **client state reconciliation gap**:

1. Global seller alert realtime (`useNewOrderAlert`) only **adds** alerts on actionable statuses; it never dismisses on `cancelled` / terminal.
2. Seller list SLA UI (`SellerOrderCard`) is bound to **stale React Query** (`seller-orders`); resume invalidates badge keys only, not order lists.
3. The intended fix bridge — FCM → `order-terminal-push` → invalidate `seller-orders` — usually cannot fire because PNQ **omits `order_id` / `is_terminal` from push `data`**.
4. In-app “New Order” rows are **not deleted** on cancel; they are marked read later by deferred stale cleanup (cold start +10s / inbox open).

Android “professional ringing sound” is incompletely provisioned: code references `gate_bell` / `orders_alert`, but **`public/sounds/gate_bell.mp3` is absent** from the workspace and **no `android/.../res/raw` sound asset** was found. Channel importance/vibration are correctly configured for heads-up in principle; missing assets + Android channel immutability explain poor/default sound UX.

---

## 2. Current-state map

### 2.1 Channels by audience

| Audience | Push (FCM/APNs) | In-app (`user_notifications`) | Realtime UX | WhatsApp (via PNQ) |
|----------|-----------------|-------------------------------|-------------|--------------------|
| **Buyer** | Order status, payment/OTP high-priority, delivery proximity, digests, campaigns | Inbox + home banner + badge (seller-targeted types filtered) | Order detail channel; `user_notifications` INSERT; active order strip | Eligible order/payment/review types if prefs allow |
| **Seller** | New/actionable orders (high priority + `orders_alert`), chat, store status, daily summary | Inbox (seller mode shows broader set) | `useNewOrderAlert` on `orders` INSERT/UPDATE; order detail; chat alerts | Store status / payment / marketing-gated types |
| **Admin / society / other** | Campaigns, moderation, society broadcast | Direct or dual-write paths exist | Mixed | Admin `send-whatsapp` bypasses queue |

### 2.2 Architecture spine (source of truth)

```
Event (DB trigger / edge / client insert)
  → notification_queue (pending)
  → claim_notification_queue
  → process-notification-queue
       ├─ prefs / dedup / stale-order guards
       ├─ insert user_notifications
       ├─ deliverWhatsAppForQueueItem (best-effort)
       └─ deliverPushToUser (FCM HTTP v1 / APNs HTTP/2)
  → Client:
       ├─ PushNotifications listeners (foreground toast/haptic/sound)
       ├─ Realtime INSERT on user_notifications → React Query invalidate
       └─ Separate order realtime for seller alert overlay / order detail
```

**Key files**

| Layer | Path | Symbols |
|-------|------|---------|
| Queue processor | `supabase/functions/process-notification-queue/index.ts` | `claim` loop, `deliverPushToUser`, `sendFcmDirect`, stale guards |
| WA from queue | `supabase/functions/_shared/whatsapp-notify.ts` | `deliverWhatsAppForQueueItem`, `shouldSendWhatsApp` |
| Push client | `src/hooks/usePushNotifications.ts` | channels, registration, `pushNotificationReceived`, terminal sync |
| Provider | `src/components/notifications/PushNotificationProvider.tsx` | owns hook + inbox Realtime INSERT |
| Inbox hooks | `src/hooks/queries/useNotifications.ts` | fetch, mark read, `cleanupStaleDeliveryNotifications` |
| Lifecycle | `src/hooks/useAppLifecycle.ts` | cold-start stale cleanup; `order-terminal-push` invalidation |
| Seller alert | `src/hooks/useNewOrderAlert.ts` | overlay + buzz + order realtime |
| SLA card | `src/components/seller/SellerOrderCard.tsx` | local countdown from `auto_cancel_at` |
| Detail timer | `src/components/order/UrgentOrderTimer.tsx` | detail-page countdown |
| Cancel | `src/components/order/OrderCancellation.tsx` → RPC `buyer_cancel_order` | clears DB SLA |

### 2.3 Bypass / parallel paths (important)

| Path | Behavior | Risk |
|------|----------|------|
| `src/lib/notifications.ts` → `send-push-notification` | Direct push, no queue | No WA, weaker retry/orphan |
| `src/lib/society-notifications.ts` `enqueueAndProcess` | Dual-write queue **and** `user_notifications` | Duplicate inbox risk |
| `send-campaign` | Direct FCM + silent WA queue rows | Different sound/channel model |
| `notificationService.ts` | Only WhatsApp invoke wired | **Unused** by app call sites |
| Direct `user_notifications` inserts (LicenseManager, some admin) | Inbox without PNQ | No push/retry consistency |

### 2.4 What is *not* used

- `@capacitor/local-notifications` — **no usages** in the repo. Foreground UX is Cap push handlers + Web Audio / MP3 loops, not scheduled local notifications.

---

## 3. Lifecycle documentation

### 3.1 Creation

**Primary:** Postgres triggers / SQL functions enqueue into `notification_queue`:

- `fn_enqueue_order_status_notification` / `_impl` on `orders` INSERT/UPDATE (latest evolution includes WhatsApp gap migrations such as `20260803210000_whatsapp_remaining_event_gaps.sql`)
- Chat: `trg_chat_message_notification`
- Reviews / disputes / settlements / product moderation / refunds / rules engine (`fn_enqueue_from_rule`)

**Secondary:** Edge functions insert queue rows (`manage-delivery`, `update-delivery-location`, digests, `daily-seller-summary`, `auto-cancel-orders`, gate, society reports, etc.).

**Client:** `admin-notifications.ts`, chat hooks, bookings, UPI/COD confirmations, society helpers.

### 3.2 Delivery (PNQ)

Per claimed item (`process-notification-queue/index.ts`):

1. Recover stuck `processing` (>3 min) and orphan failed rows (>1h without in-app).
2. Preference gate (`orders` / `chat` / `promotions`) — still writes in-app; may skip push.
3. 60s dedup on `(user_id, type, reference_path)`.
4. Order guards: if live order is terminal / status mismatch / stale (>5 min) under conditions → insert in-app as `is_read: true`, skip push (`push_skip_reason: stale_or_terminal`).
5. Insert `user_notifications` (unique on `queue_item_id`).
6. WhatsApp best-effort.
7. Build FCM/APNs payload; high priority → channel `orders_alert` + sound `gate_bell`.
8. Retry failed push: +15s `next_retry_at`, max **9** attempts → `failed`.
9. Self-schedule next run; INSERT trigger also invokes PNQ.

### 3.3 Display

| Surface | Mechanism |
|---------|-----------|
| OS tray | FCM/APNs with Android `tag` / APNs collapse-id = order id when present |
| Foreground toast | `pushNotificationReceived` in `usePushNotifications` |
| Seller full-screen alert | `useNewOrderAlert` + `NewOrderAlertOverlay` (local state + MP3 loop) |
| Inbox | `NotificationInboxPage` via React Query |
| Home banner | `HomeNotificationBanner` / `useLatestActionNotification` |
| Badge | `useUnreadNotificationCount` (mode-aware filters) |

### 3.4 Dismiss / update

| Action | Effect |
|--------|--------|
| Mark read / mark all | `user_notifications.is_read = true` (no delete API in inbox hooks) |
| Home banner dismiss | `is_read` + `localStorage` dismissed IDs |
| Stale cleanup | Marks order-linked unread rows read when order is terminal — deferred (cold start 10s / inbox) |
| Terminal push event | Intended to invalidate seller/buyer order queries — often broken (see §5) |
| Push tap | Deep link via `resolveNotificationRoute` / `pickNotificationRoute` |

### 3.5 Cross-device sync (as designed)

| Mechanism | Syncs what | Gaps |
|-----------|------------|------|
| Shared `user_notifications` rows | Inbox/badge across devices once fetched/realtime | Realtime only listens to **INSERT**, not UPDATE (`is_read` from another device lags until poll/resume) |
| `device_tokens` + `claim_device_token` | Push targets per device | Invalid tokens tracked; platform dedupe in PNQ |
| Order DB as truth | Detail page realtime | List/overlay/local buzz not fully subscribed to terminal updates |
| FCM collapse tag | Tray replacement by order id | Requires cancel push to deliver with same tag |

---

## 4. Findings (severity + evidence)

### P0 — Correctness / stale seller UX

| ID | Finding | Evidence |
|----|---------|----------|
| **P0-1** | Seller new-order realtime never dismisses on cancel/terminal | `useNewOrderAlert.ts` UPDATE handler only calls `handleNewOrder` when status ∈ `ACTIONABLE_STATUSES`; no `else` → `dismissById` / invalidate |
| **P0-2** | Push terminal sync cannot identify order | PNQ builds `pushData` with route/status/high_priority/target_role but **does not copy `order_id`/`orderId`/`is_terminal`** (`process-notification-queue/index.ts` ~737–745). Client requires `data.orderId\|order_id` (`usePushNotifications.ts` ~401–420) |
| **P0-3** | Seller dashboard SLA continues on stale cache | `SellerOrderCard` countdown from props `auto_cancel_at` + `status`; `useAppLifecycle` resume invalidates only badge/count keys — **not** `seller-orders`. `order-terminal-push` would invalidate lists but rarely fires (P0-2) |

### P1 — Reliability / consistency

| ID | Finding | Evidence |
|----|---------|----------|
| **P1-1** | Inbox Realtime is INSERT-only | `PushNotificationProvider.tsx` — no UPDATE subscription for cross-device read sync |
| **P1-2** | Stale in-app “New Order” rows linger until deferred cleanup | Cancel does not delete/update prior rows; `cleanupStaleDeliveryNotifications` on cold start (+10s) or inbox open |
| **P1-3** | Snooze can resurrect cancelled orders | `useNewOrderAlert.snooze` `setTimeout` re-adds same object without re-checking live status |
| **P1-4** | Dual-write / bypass paths skip unified lifecycle | `society-notifications.enqueueAndProcess`, `send-push-notification`, campaign direct FCM |
| **P1-5** | `gate_bell` asset missing from workspace | Code fetches `/sounds/gate_bell.mp3`; `public/` has no `sounds/`; no `res/raw` found — Android/iOS may fall back to default/silent |
| **P1-6** | Buyer cancel may not set `app.acting_as='buyer'` | Unlike `buyer_advance_order`; can affect cancel title/notify branch quality |

### P2 — Hygiene / ops / architecture debt

| ID | Finding | Evidence |
|----|---------|----------|
| **P2-1** | `notificationService` unused | Only WhatsApp method wired; no `src/` call sites |
| **P2-2** | Column duality (`payload`/`data`, `reference_path`/`action_url`) | Sync trigger exists; cognitive dual-write load remains |
| **P2-3** | WhatsApp pref defaults true without hard Meta opt-in gate | Soft CTA; `whatsapp_opted_in_at` not strictly required by `shouldSendWhatsApp` |
| **P2-4** | Frozen backup trees / dual PNQ copies | `FROZEN_BACKUP`, `notification-backup-2026-03-31/`, `.tmp-fn-deploy/` confuse live source of truth |
| **P2-5** | Historical hardcoded project URLs in older PNQ trigger migrations | Verify live DB trigger points at current project |
| **P2-6** | LocalNotifications unused | No offline/local schedule path for missed high-priority orders |

---

## 5. Root causes of stale notifications / timers

### 5.1 What works correctly on cancel

1. UI: `OrderCancellation.handleCancel` → RPC `buyer_cancel_order`.
2. DB: `orders.status = 'cancelled'`, **`auto_cancel_at = null`** (migration `20260409175218_...`).
3. Trigger: order status notification enqueued for seller when flow `notify_seller`.
4. Realtime: Postgres **does** emit `orders` UPDATE.
5. Order detail page: subscribed to `order-${id}` → refetch → `UrgentOrderTimer` unmounts when terminal / no `auto_cancel_at`.

### 5.2 Why the seller still sees a timer / ring

**Primary root cause (identified):**  
**Local seller UX state and list caches are not reconciled on terminal order UPDATEs**, and the push-based reconciliation bridge is incomplete.

Causal chain:

```
Buyer cancel
  → DB: status=cancelled, auto_cancel_at=null   ✅
  → orders realtime UPDATE fires                ✅
  → useNewOrderAlert UPDATE handler:
        if actionable → add alert
        else → (noop)                           ❌ overlay/buzz remain
  → seller-orders React Query still has
        status=placed + old auto_cancel_at      ❌ SLA card keeps ticking
  → Cancel push may enqueue with order_id in payload
  → PNQ pushData omits order_id / is_terminal   ❌
  → Client cannot dispatch order-terminal-push  ❌
  → useAppLifecycle never invalidates lists     ❌
  → Old user_notifications "New Order" unread
        until deferred cleanup                  ❌ inbox/banner stale
```

**Not the cause:** `manage-delivery` (post-accept delivery path). DB failing to clear `auto_cancel_at`. Missing cancel enqueue entirely (enqueue generally exists; delivery of sync metadata is the gap).

### 5.3 Required behavior (target)

On cancel / expire / accept / reject / complete, **all devices** should within ~1s:

1. Stop overlay buzz and remove order from `pendingAlerts`.
2. Invalidate/refetch `seller-orders` / stats so SLA UI disappears.
3. Collapse or replace OS tray notification for that order id.
4. Mark or supersede related in-app notifications (read or replace with cancel card).
5. Emit a single terminal sync signal (`order_id`, `status`, `is_terminal`) via push **and** realtime.

---

## 6. Android sound & channel findings (audit only)

### 6.1 Current configuration

| Item | Current | File |
|------|---------|------|
| Channel `orders_alert` | importance **5**, vibration **true**, lights **true**, sound `gate_bell` | `usePushNotifications.ts` ~279–288 |
| Channel `general` | importance **3**, sound `default` | same ~296–305 |
| FCM high priority | `channel_id: orders_alert`, `sound: gate_bell`, icon `ic_stat_sociva` | PNQ `sendFcmDirect` |
| High-priority rules | Seller: `placed\|enquired\|requested\|quoted`; Buyer: `payment_failed\|refund_failed\|otp` | PNQ ~719–724 |
| Foreground | Web Audio beeps if prefs.sounds + `high_priority=true`; seller overlay loops `/sounds/gate_bell.mp3` | `usePushNotifications`, `useNewOrderAlert` |
| Capacitor config | `presentationOptions: ['badge','sound','alert']` | `capacitor.config.ts` |

Separate channel: `sociva_live_delivery` for live delivery foreground service (not marketing/order tray).

### 6.2 Why sound feels wrong / default

1. **Asset gap:** Workspace has **no** `public/sounds/gate_bell.mp3` and **no** discovered `res/raw/gate_bell` — FCM/`createChannel` may silently fall back to system default or silence depending on OEM.
2. **Android channel immutability:** Once `orders_alert` is created on a device, changing `sound` in code **does not update** the user’s channel. A new channel id (e.g. `orders_alert_v2`) is required after shipping a new sound.
3. **No LocalNotifications path** for guaranteed foreground ringing when FCM is suppressed (app open / OEM battery).
4. **Campaign / bypass pushes** may not use `orders_alert` / `gate_bell`.
5. **User prefs:** `notification_preferences.sounds` gates some foreground synthesis; OS channel settings can still mute independently.

### 6.3 Professional delivery-app style — recommended requirements (do not implement yet)

| Concern | Recommendation |
|---------|----------------|
| Asset | Short looping-capable bell/ring (~1–3s), royalty-cleared; place in `android/app/src/main/res/raw/order_ring.ogg` (and iOS bundle); web copy under `public/sounds/` |
| Channel | New max-importance channel `orders_incoming_v1`: importance IMPORTANCE_HIGH (4) or MAX (5), `bypassDnd` only if product/legal allows, vibration pattern, lights, custom sound, `showBadge` |
| Heads-up | High priority FCM (`priority: HIGH` + Android `priority: HIGH`) + importance ≥ HIGH; full-screen intent only for extreme cases (careful with Play policy) |
| Foreground (app open) | Do **not** rely on tray alone: play local sound + strong haptic via LocalNotifications or in-app player; suppress duplicate if overlay already ringing |
| Dedup | Same `tag` = `order_id` so cancel replaces new-order tray |
| Vibration | Distinct pattern for incoming vs chat vs general |
| Settings | In-app deep link to channel settings; document that sound changes need new channel ids |
| Testing matrix | Pixel / Samsung / Xiaomi / Oppo with battery optimization on/off; app killed / background / foreground |

---

## 7. Recommended target architecture

### 7.1 Principles

1. **Single event bus:** Domain events (`order.cancelled`, `order.accepted`, …) → Notification Orchestrator → channel adapters.
2. **Order state is truth; notifications are projections.** Never let tray/overlay/inbox disagree with `orders.status` for >1s while online.
3. **Lifecycle-aware notifications:** create / supersede / invalidate / expire — not append-only forever.
4. **Push carries sync metadata** always: `entity_type`, `entity_id`, `status`, `is_terminal`, `notif_id`, `collapse_key`.
5. **Realtime + push + poll** as layered reliability (at-least-once), with idempotent client reducers.

### 7.2 Target components

```
┌─────────────────────────────────────────────────────────────┐
│ Domain events (DB triggers / edge / RPCs)                   │
└───────────────────────────┬─────────────────────────────────┘
                            ▼
┌─────────────────────────────────────────────────────────────┐
│ Notification Orchestrator (queue + rules + dedupe_key)      │
│  - idempotent enqueue                                       │
│  - supersede prior notifs for same (user, entity, kind)     │
│  - retries with backoff / DLQ                               │
└───────┬─────────────┬──────────────┬────────────────────────┘
        ▼             ▼              ▼
   In-app store   Push adapter   WhatsApp adapter
   (upsert/read)  (FCM/APNs)     (templates)
        │             │
        ▼             ▼
   Realtime fanout  Device clients
        │             │
        └──────┬──────┘
               ▼
     Client Notification Store (reducer)
       - merge push + realtime + poll
       - clear timers/overlays on terminal
       - reconcile on resume / offline catch-up
```

### 7.3 Capabilities matrix

| Capability | Mechanism |
|------------|-----------|
| Deduplication | Stable `dedupe_key` + short window + entity supersession |
| Retries | Existing PNQ retry + DLQ/alert on exhausted |
| Lifecycle | On terminal: mark related inbox read server-side; collapse push; emit invalidate event |
| Foreground | Local alert controller owned by one module (replace ad-hoc buzz hooks) |
| Background | High-importance channel + FCM high priority |
| Offline recovery | On resume: fetch open actionable orders + unread notifs; reconcile overlay |
| Cross-device | Realtime INSERT+UPDATE on `user_notifications`; shared server truth |
| Push ↔ in-app sync | Same `queue_item_id` / `notif_id` in push data |

---

## 8. Phased implementation plan (ordered, no code in this audit)

### Phase 0 — Stop the bleeding (1–2 days)

1. In `useNewOrderAlert` UPDATE handler: on non-actionable/terminal → `dismissById`, stop buzz, invalidate `seller-orders` + `seller-dashboard-stats`.
2. Re-check status before snooze re-queue.
3. In PNQ `pushData`: always include `order_id`, `status`, `is_terminal` (string booleans).
4. Confirm cancel push uses same collapse `tag` as new-order push.

### Phase 1 — Inbox & projection hygiene (3–5 days)

1. Server-side: on order terminal transition, mark related unread `user_notifications` as read (or insert superseding cancel notif and close priors).
2. Subscribe Realtime to `user_notifications` UPDATE for cross-device read sync.
3. On resume, invalidate `seller-orders` (not only badges) when seller mode.

### Phase 2 — Android sound / heads-up (2–4 days)

1. Add professional ring asset to Android `res/raw` + web `public/sounds` + iOS bundle.
2. Ship **new** channel id `orders_incoming_v1` (do not mutate old channel).
3. Wire LocalNotifications or dedicated foreground ring for app-open incoming orders.
4. Document OEM testing matrix; deep-link to channel settings.

### Phase 3 — Orchestrator hardening (1–2 weeks)

1. Collapse bypass paths into queue (campaign, society, license) with feature flags.
2. Formalize notification lifecycle APIs (create / supersede / expire).
3. Unify column model (`data` vs `payload`).
4. Observability: dashboards for queue lag, push skip reasons, terminal sync miss rate.

### Phase 4 — Scale / fault tolerance (ongoing)

1. DLQ + pager on sustained PNQ failures.
2. Per-user rate limits; quiet hours.
3. Multi-device token health scoring.
4. Optional: outbox pattern if trigger→HTTP invoke proves fragile.

---

## 9. Open questions / unknowns

1. **Live project verification:** Confirm production DB trigger URL for PNQ matches the deployed project (historical multi-project migrations).
2. **Whether `gate_bell` exists only in built APK artifacts** not checked into this workspace (Capacitor sync / CI asset step?).
3. **OEM-specific mute rates** for `orders_alert` in the field (no analytics cited in-repo).
4. **Exact production copy of `buyer_cancel_order`** vs migration snapshots — confirm `app.acting_as` and notify flags on live DB.
5. **Rules engine coverage:** How many live events still use only legacy `fn_enqueue_order_status_notification` vs `notification_rules`.
6. **WhatsApp:** Whether marketing/utility template approvals cover all enqueue types currently marked eligible.
7. **Multi-store sellers:** Confirm all `seller_id`s on a user are in `sellerIdsRef` for alert dismiss after fix.
8. **iOS Critical Alerts / Android full-screen intent** — product/legal appetite (not currently used).

---

## Appendix A — Buyer vs seller quick reference

| Concern | Buyer | Seller |
|---------|-------|--------|
| New order urgency | N/A (they placed it) | Overlay + `orders_alert` + SLA countdown |
| Cancel | Initiates RPC; detail self-updates | Must rely on realtime/push/list refresh — currently incomplete |
| Inbox filters | Hides seller-only / `target_role=seller` | Broader |
| High-priority push | payment/OTP failures | placed/enquired/requested/quoted |
| Stale cleanup | Delivery + order types on cold start | Same function; does not clear overlay |

## Appendix B — Evidence index (primary symbols)

- `process-notification-queue/index.ts` — `sendFcmDirect`, stale guards, `pushData` construction  
- `src/hooks/usePushNotifications.ts` — channels, terminal push parsing  
- `src/hooks/useNewOrderAlert.ts` — `ACTIONABLE_STATUSES`, UPDATE noop gap, snooze  
- `src/components/seller/SellerOrderCard.tsx` — `slaSeconds` / `slaIsActive`  
- `src/hooks/useAppLifecycle.ts` — resume keys; `order-terminal-push`  
- `src/components/notifications/PushNotificationProvider.tsx` — INSERT-only realtime  
- `src/hooks/queries/useNotifications.ts` — `cleanupStaleDeliveryNotifications`  
- `src/components/order/OrderCancellation.tsx` — `buyer_cancel_order`  
- Migrations clearing `auto_cancel_at` on cancel/advance (Apr 2026)

---

## Remediation status (2026-08-07)

Concrete code fixes shipped after this audit. Phases 0–4 + practical P2 hygiene implemented.

### Fixed

| ID | Fix | Where |
|----|-----|-------|
| **P0-1** | Seller overlay dismisses on non-actionable/terminal `orders` UPDATE; also on `order-terminal-push` and visibility reconcile | `src/hooks/useNewOrderAlert.ts` |
| **P0-2** | PNQ `pushData` always includes `order_id` / `orderId` / `entity_id` / `status` / `is_terminal` (plus type / queue_item_id) | `supabase/functions/process-notification-queue/index.ts` |
| **P0-3** | App resume invalidates `seller-orders` + `seller-dashboard-stats` (+ orders strip); terminal realtime also invalidates those caches | `src/hooks/useAppLifecycle.ts`, `useNewOrderAlert.ts` |
| **P1-1** | Inbox Realtime listens to `user_notifications` **UPDATE** as well as INSERT | `src/components/notifications/PushNotificationProvider.tsx` |
| **P1-2** | Server trigger marks related unread inbox rows read on terminal order status | migration `20260807120244_notification_terminal_lifecycle.sql` |
| **P1-3** | Snooze re-fetches live order status before re-queue; cancelled orders cannot resurrect | `useNewOrderAlert.ts` |
| **P1-4** | Society / license / `sendPushNotification` route through `notification_queue` only (no dual-write inbox); campaigns keep bulk FCM for scale but use `general` channel + WA hard opt-in + token health mark; `send-push-notification` aligned to `order_ring` / `orders_incoming_v1` | `society-notifications.ts`, `notifications.ts`, `LicenseManager.tsx`, `send-campaign`, `send-push-notification` |
| **P1-5** | Shipped `order_ring` to `android/.../res/raw` + `public/sounds`; new channel `orders_incoming_v1`; PNQ/FCM/APNs use `order_ring` | Android raw, `usePushNotifications.ts`, PNQ |
| **P1-6** | `buyer_cancel_order` now sets `app.acting_as = 'buyer'` before UPDATE | migration `20260807120244_...` |
| **P2-1** | `notificationService` push channel wired via queue lifecycle helpers | `src/services/notificationService.ts` |
| **P2-2** | Dual-field helpers + writers emit both; readers heal `data`/`payload` and `action_url`/`reference_path` | `notification-fields.ts`, PNQ, `useNotifications.ts` |
| **P2-3** | Hard WhatsApp Meta opt-in via `whatsapp_opted_in_at` (grandfather soft opt-ins in migration) | migration `20260807122130_...`, `whatsapp-notify.ts`, campaign WA query |
| **P2-4** | Removed obsolete push `.FROZEN_BACKUP` files; freeze doc updated; live PNQ remains sole function tree (`.tmp-fn-deploy` left as deploy scratch) | `src/PUSH_NOTIFICATION_FREEZE.md` |
| **P2-5** | Live `trigger_process_notification_queue` reaffirmed for project `kkzkuyhgdvyecmxtmkpy` | migration `20260807122130_...` |
| **P2-6 / Phase 2** | `@capacitor/local-notifications` for foreground/app-open incoming-order ring; cancel on terminal; Android channel-settings deep link; OEM matrix below | `local-order-notifications.ts`, `useNewOrderAlert.ts`, `notification-channel-settings.ts` |
| **Phase 3** | Lifecycle helpers create / supersede / expire; dual fields; structured PNQ observability (`queue_lag`, `push_skip`, `batch_summary`) | `notification-lifecycle.ts`, PNQ, `notification-ops.ts` |
| **Phase 4** | DLQ table `notification_dead_letter`; per-user push rate limits; quiet hours prefs; device token health scoring / prune on FCM invalid; outbox skipped (documented — trigger + self-schedule sufficient) | migration + PNQ + Notifications settings UI |

### Deferred / impossible

| Item | Why |
|------|-----|
| Mutating legacy `orders_alert` channel sound on existing installs | Impossible on Android — `orders_incoming_v1` shipped instead |
| Full Notification Orchestrator rewrite | Not required; queue collapse + lifecycle helpers achieve the practical goal |
| Heavy outbox redesign | Trigger→HTTP already recoverable via PNQ self-schedule + orphan recovery; noted in migration comment |
| iOS Critical Alerts / Android full-screen intent | Product/legal — not enabled |
| Deleting `.tmp-fn-deploy` | User deploy scratch — left intact |

### OEM testing matrix (checklist)

| Device / OEM | Battery opt | App killed | Background | Foreground (LocalNotifications + overlay) | Channel sound `orders_incoming_v1` | Cancel clears tray/overlay |
|--------------|-------------|------------|------------|-------------------------------------------|------------------------------------|----------------------------|
| Pixel (stock) | off / on | ☐ | ☐ | ☐ | ☐ | ☐ |
| Samsung | off / on | ☐ | ☐ | ☐ | ☐ | ☐ |
| Xiaomi / Redmi | off / on | ☐ | ☐ | ☐ | ☐ | ☐ |
| Oppo / Realme | off / on | ☐ | ☐ | ☐ | ☐ | ☐ |
| iPhone | N/A | ☐ | ☐ | ☐ | N/A (APNs sound) | ☐ |

**DLQ inspect:** `SELECT * FROM notification_dead_letter ORDER BY failed_at DESC LIMIT 50;`

### Deploy notes

1. Apply migration `20260807120244_notification_terminal_lifecycle.sql` (if not already) and `20260807122130_notification_remediation_phase234.sql`.
2. Redeploy edge functions: `process-notification-queue`, `send-push-notification`, `send-campaign` (and any shared `_shared` consumers).
3. Rebuild native Android (`npx cap sync android`) so LocalNotifications plugin + `res/raw/order_ring.mp3` ship.
4. Verify: buyer cancel while seller has overlay open → buzz/local notif stops + SLA timer clears without refresh.

*Remediation updated 2026-08-07 (Phases 2–4 + P2 hygiene).*
