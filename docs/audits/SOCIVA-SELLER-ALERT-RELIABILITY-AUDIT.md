# SOCIVA Seller Alert Reliability Audit

**Date:** 2026-10-26 (IST)  
**Status:** Discovery complete. **Remediation implemented and partially activated in production** (see Completion Report).  
**Production project:** `kkzkuyhgdvyecmxtmkpy`  
**Method:** Read-only SQL on live orders / `notification_queue` / tokens / cron / settings; repo source; deployed Edge Function source for `send-seller-status-reminders`; architecture cross-check against prior audit dated 2026-10-24.  
**Evidence rule:** Provider HTTP success and `push_success_count > 0` mean the push provider accepted the request. They do **not** prove device display, Focus/DND behaviour, or audible `gate_bell` playback. Device sound for both incidents is **unknown**.

Related prior work (do not treat as current truth without revalidation):
- [SOCIVA-SELLER-NOTIFICATION-RELIABILITY-AUDIT-2026-10-24.md](./SOCIVA-SELLER-NOTIFICATION-RELIABILITY-AUDIT-2026-10-24.md)
- [SOCIVA-SELLER-NOTIFICATION-DEVICE-MATRIX-2026-10-24.md](./SOCIVA-SELLER-NOTIFICATION-DEVICE-MATRIX-2026-10-24.md)

Customer PII, phone numbers, and raw device tokens are omitted from this report.

---

## 1. Architecture and current configuration

### 1.1 Path (product / scheduled / enquiry orders)

```
Business event (order INSERT / payment_pending→placed / order_items INSERT)
  → enqueue_seller_new_order_notification (Postgres)
  → notification_queue (durable row, idempotency_key)
  → wake: INSERT trigger + cron wakeup_notification_queue_if_pending (* * * * *)
  → process-notification-queue (deployed v97; inline FCM / APNs)
  → device OS notification
  → optional audible alert (channel / aps.sound / Focus / volume)
  → seller accept / reject / expiry
  → status change stops unacked reminder eligibility
```

Primary modules:
- Enqueue SQL: migrations under `supabase/migrations/*enqueue*seller*`, notably `20261021220000_closed_store_scheduled_ordering.sql`, `20261010140000_seller_order_alert_obligation.sql`
- Worker: `supabase/functions/process-notification-queue/index.ts`
- Ad-hoc push: `supabase/functions/send-push-notification/index.ts` (not the main queue path in repo)
- Unacked / status nudges: `supabase/functions/send-seller-status-reminders/index.ts` (**repo ≠ live**; see §4 / DEF-003)
- Prep / day-of scheduled windows: `supabase/functions/send-scheduled-order-reminders/index.ts`
- Android gate: `supabase/functions/_shared/seller-alert-gate.ts`
- iOS TS / sound: `supabase/functions/_shared/ios-time-sensitive.ts`
- Client: `src/hooks/usePushNotifications.ts`, `useNewOrderAlert.ts`, `OrderAlertMessagingService.java`

### 1.2 Live configuration (2026-10-26)

| Setting / job | Live value | Notes |
|---|---|---|
| `system_settings.order_acceptance_timeout_seconds` | **300** (5 minutes) | Unchanged since 2026-08-07 |
| Instant `auto_cancel_at` | `now() + 300s` when entering `placed` without a future stamp | Cleared after leave-`placed` |
| Scheduled open-store stamp at create | Often `now() + 30 minutes` in checkout SQL; closed-store / prep path can replace with prep-window deadline | See `20261021233000_*`, `20261021250000_*` |
| `seller_alert_android_config` | `mode=version_gated`, `min_version_code=67` | Native v3 path |
| Stamped Android tokens (`alert_capability` / `app_version_code`) | **0 / 135** | All Android order alerts stay on **v2 notification+data** |
| Cron `send_seller_status_reminders_every_5m` | `*/5 * * * *` active | Invokes live function v5 |
| Cron `send_scheduled_order_reminders_every_5m` | `*/5 * * * *` active | Prep / 24h / late windows |
| Cron `sweep_expired_unaccepted_orders_every_1m` | `* * * * *` active | Safety net for OAE |
| Cron `wakeup_notification_queue_if_pending` | `* * * * *` active | Queue drain |

### 1.3 Deployed vs repo (material drift)

| Component | Live | Repo | Impact |
|---|---|---|---|
| `send-seller-status-reminders` | **v5** - unacked at 3/10/20 min; **no** `isFarFutureScheduled`; **no** morning `scheduled_accept` path | Has far-future skip + `scheduled_accept` 2h before deadline | Overnight bells for tomorrow's scheduled orders (**confirmed on #bcce1b63**) |
| `process-notification-queue` | v97; writes `push_success_count` on sampled rows | Rich inline FCM worker | Oct-24 "emergency stub" finding is **stale** for current v97 samples; still re-diff hashes before assuming parity |
| Token stamping | 0 stamped | Client stamp + RPC present | v3 native path unused |

---

## 2. Incident A: MOM's Home Pickle

### 2.1 What business event occurred?

Not a contact/enquiry. **Zero** rows in `seller_contact_interactions` for this seller.

Relevant same-day event: **instant purchase order** `192904fe-…` (Lemon Pickle), created **2026-10-26 18:57 IST**, seller user token platform **iOS**.

### 2.2 Lifecycle evidence

| Stage | Outcome | Evidence |
|---|---|---|
| Persisted order | Yes | `orders` row; status ended `cancelled` |
| Seller action required | Yes - accept while `placed` | Cancel reason text: seller didn't respond in time |
| Notification enqueued | Yes | `notification_queue` type `order`, title `New order: 1x Lemon Pickle`, created 18:57:00 IST |
| Job processed | Yes | `status=processed`, processed ~2s later |
| Push attempted | Yes | `push_attempted=true`, `push_success_count=1`, `push_fail_count=0` |
| Reminder | Yes | `seller_order_status_reminder` "New order is still waiting" at 19:00:01 IST, `push_success_count=1` |
| Auto-cancel | Yes ~6 min after create | Cancelled 19:03:00 IST; `life_min ≈ 6.0`; matches **5-minute** acceptance policy (+ sweep lag) |
| Buyer / seller cancel pushes | Yes | Seller cancel push `success_count=1`; buyer cancel `push_skip_reason=no_tokens` |
| Device delivery / display / bell | **Unknown** | No device logs; seller is iOS; Focus / mute / permission not observable from DB |
| Deep link target | Intended `/orders/{id}` | Payload / reference_path pattern for order type |

### 2.3 Conclusion (Incident A)

**Backend did not miss the event.** Initial alert and one unacked reminder were queued, processed, and accepted by the push provider within the 5-minute window. The order was then cancelled for non-acceptance.

**Root cause of "no bell" is not proven as a queue miss.** Remaining hypotheses (unverified):
- H-A1: iOS Focus / Silent / notification permission muted sound.
- H-A2: Seller did not notice banner within ~6 minutes (policy too short vs human response time - **policy defect**, separate from delivery).
- H-A3: Stale or weak APNs delivery after FCM accept (no delivery receipt stored).

**Confirmed policy defect (not delivery):** Instant acceptance window is **5 minutes**, not the intended **30 minutes**. MOM's order died at ~6 minutes with seller-timeout copy. That alone produces avoidable "missed order" reports even when the push was accepted.

---

## 3. Incident B: SreshtA Batters `#bcce1b63`

### 3.1 Order type and state

| Field | Value |
|---|---|
| Order id prefix | `bcce1b63` (short ref `#EB0426`) |
| Type | `purchase` / delivery **scheduled** (`scheduled_date=2026-10-27`, start `07:45:00`) |
| Created | 2026-10-26 21:38:37 IST |
| Status (audit time) | **`placed`**, `accepted_at` null, `auto_accepted=false` |
| `auto_cancel_at` | **2026-10-27 07:30:00 IST** (prep window; gap ≈ **591 minutes** from create) |
| Prep / fulfil / cutoff | prep 07:30, fulfil 07:45, buyer cutoff 07:15 IST |
| `reminder_state` | `{}` (scheduled prep worker has not marked day-of kinds yet) |

Store closure did **not** suppress the placement-time seller alert (expected).

### 3.2 Notification evidence

| When (IST) | Type | Title | Provider |
|---|---|---|---|
| 21:38:37 | `order` | `Scheduled order for 27 Oct, 7:45 AM` | processed, `push_success_count=1` |
| 21:45:01 | `seller_order_status_reminder` unacked-1 | `New order is still waiting` | success 1 |
| 21:50:01 | unacked-2 | same | success 1 |
| 22:00:02 | unacked-3 | same | success 1 |

Seller device token: **iOS**, token present, **no** `alert_capability` / `app_version_code` (irrelevant for iOS channel gate).

### 3.3 Conclusion (Incident B)

**Backend did notify immediately** that a scheduled order existed. Copy correctly distinguished fulfilment for tomorrow on the **initial** alert.

**Confirmed defects:**
1. **Live reminder worker ignores scheduled far-future policy.** Deployed `send-seller-status-reminders` v5 has no `isFarFutureScheduled` / morning `scheduled_accept` path. Repo already contains that logic but is **not** what production runs. Result: three urgent "tap to accept" bells within ~22 minutes of scheduling overnight, with copy that does **not** say the food is for tomorrow.
2. **"Seller did not receive bell" is not supported by queue/provider evidence.** Same as Incident A: provider accept ≠ audible proof. Possible Focus/mute/permission; also possible seller dismissed overnight reminders and later reported the morning as silent.

**Unresolved:** Whether SreshtA's phone played sound for any of the four pushes. No device telemetry.

**Deadline correctness:** `auto_cancel_at` is prep-based (07:30 next day), **not** create+5m and **not** store opening alone. Good for scheduled acceptance horizon; UI / buyer messaging should surface this deadline explicitly (gap vs intended "morning reminder trio" product rule).

---

## 4. Exact root causes (ranked)

### Confirmed

| ID | Severity | Root cause |
|---|---|---|
| **DEF-001** | P0 product | Instant acceptance timeout is **300s** live; product intent is **30 minutes**. MOM order auto-cancelled ~6 min. |
| **DEF-002** | P0 reliability perception | System treats FCM/APNs accept as operational success; no device delivery / ack telemetry → "no bell" reports are unfalsifiable from ops alone. |
| **DEF-003** | P0 scheduled UX | **Live** `send-seller-status-reminders` ≠ repo: overnight unacked bells for tomorrow scheduled orders; missing morning `scheduled_accept` schedule. Proven on `#bcce1b63`. |
| **DEF-004** | P1 Android | Native `orders_incoming_v3` path unused (0 stamped tokens). Production Android uses JS-created `orders_incoming_v2`. Channel sound immutable after first create. |
| **DEF-005** | P1 policy | Instant unacked reminders at 3/10/20 min under a **5-minute** cancel window: only bucket 1 can land before cancel (MOM got one at +3 min). 10/20 min reminders are unreachable under current timeout. |
| **DEF-006** | P2 ack model | Client "acknowledge" stops in-app ring only; **server reminders continue** until status leaves `UNACKED_STATUSES`. Viewing an order ≠ acceptance. |

### Hypotheses (not confirmed)

| ID | Severity | Hypothesis | Needed evidence |
|---|---|---|---|
| H-A1 / H-B1 | P1 | iOS Focus / mute prevented sound for sellers who reported silence | Seller device settings interview; Focus logs; test push while Focus on |
| H-007 | P2 | PNQ live still diverges from repo on retry / no_tokens | Full function source diff of process-notification-queue v97 vs repo |
| H-008 | P2 | v2 channel created historically without `gate_bell` on some Android sellers | Seller-side channel inspect; not applicable to these two **iOS** incidents |

---

## 5. Notification lifecycle and delivery evidence (summary)

For both incidents: **Created → Queued → Processed → Provider accepted** is evidenced.  
**Device receipt / display / sound / human attention** are **not** evidenced.  
Mark dashboard fields for the last two as **unknown**, never "delivered".

---

## 6. Android channel compatibility

| Item | Finding |
|---|---|
| Manifest default channel meta | `orders_incoming_v3` |
| Native service | `OrderAlertMessagingService` registered; posts on data-only when background/killed |
| Live FCM for unstamped Android | **notification+data** on **`orders_incoming_v2`** + sound name `gate_bell` |
| Live FCM for stamped Android | data-only `orders_incoming_v3` when capability `order_alert_native_v1` and `app_version_code >= 67` |
| Production stamp rate | **0%** → v3 path **never** selected |
| Asset | `android/app/src/main/res/raw/gate_bell.mp3` present in repo |
| Migration risk | Do **not** flip all traffic to v3 until stamp works and a version-aware rollout + rollback (`mode=legacy`) is verified |

These two incidents are **iOS sellers**; Android channel bugs did not cause A/B, but remain a fleet-wide P1.

---

## 7. iOS sound and entitlements

| Item | Finding |
|---|---|
| Sound constant | `IOS_APNS_SOUND_FILE = gate_bell.caf` in `_shared/ios-time-sensitive.ts` |
| Asset in repo | `ios-config/gate_bell.caf` (copied into app bundle in Codemagic) |
| Time Sensitive | `interruption-level: time-sensitive` for seller placed / unacked / related alerts when helper matches |
| Entitlement | Generated in `codemagic.yaml` as `com.apple.developer.usernotifications.time-sensitive` (not a committed static entitlements file) |
| Both incident sellers | Single **iOS** token each; pushes accepted |
| Guarantee | Mute switch / Focus can still silence; Time Sensitive is not absolute |

Device sound verification for A/B: **not performed** (no seller device access this audit).

---

## 8. Five-minute cancellation configuration and dependents

**Authoritative setting:** `system_settings.order_acceptance_timeout_seconds = 300`.

**Dependent paths (must all move together for 30-minute policy):**
1. `_order_acceptance_timeout_seconds()` + `schedule_order_acceptance_expiry` / `trg_schedule_order_acceptance_expiry` (sets `orders.auto_cancel_at` on enter-`placed`).
2. `expire_unaccepted_order` + per-order OAE edge `expire-unaccepted-order` + cron `sweep_expired_unaccepted_orders_every_1m`.
3. `seller_advance_order` late-accept block vs `auto_cancel_at`.
4. Buyer/seller UI: `UrgentOrderTimer`, `isOrderAcceptanceExpired`, dashboard urgency (`useOrderDetail`, `OrderDetailPage`, `SellerDashboardPage`, `ActiveOrderStrip`).
5. Reminder buckets in `send-seller-status-reminders` (3/10/20) - only coherent if timeout ≥ ~25-30 minutes.
6. Refund / inventory / COD side effects inside expire path (must remain idempotent).

**Do not** change scheduled/preorder `auto_cancel_at` stamps that already encode prep windows when raising the instant default.

There is **no** `seller_response_deadline` column; **`auto_cancel_at` is the single deadline field**.

---

## 9. Proposed 30-minute acceptance policy (instant only)

**Rule:** On instant (non-scheduled) enter-`placed`, set `auto_cancel_at = created_or_placed_at + 30 minutes` once; persist; never recompute from client clocks.

**Change:** `order_acceptance_timeout_seconds` **300 → 1800** (or dedicated key with the same helper).  

**Scope:** Instant acceptance expiry only. Leave payment pending, booking, scheduled prep deadlines, buyer cancel rules untouched unless a dependency forces an update.

**UI:** Read `auto_cancel_at` only; no local `now+30m` invent.

---

## 10. Instant-order reminder schedule

| T+ | Action |
|---|---|
| 0 | Initial urgent seller notification (existing enqueue) |
| ~10 min | Reminder if still in accept-required status |
| ~20 min | Reminder if still eligible |
| 30 min | Auto-cancel if still eligible; **no** reminder after cancel |

Stop reminders on accept / reject / cancel / other terminal. Idempotency keys per bucket. Deploy reminder worker that matches timeout (retire 3-minute bucket or keep as optional early nudge only if product wants it).

Final minute: cancellation worker re-reads status under row lock / conditional update; do not enqueue unacked after `auto_cancel_at`.

---

## 11. Scheduled-order morning reminder schedule

**Intended:**
1. Immediate alert at schedule time (already works; keep distinguishing copy).
2. **Do not** run overnight unacked 3/10/20 on far-future scheduled orders (**deploy repo DEF-003 fix**).
3. Three morning reminders before `auto_cancel_at` (or prep deadline), spaced in seller local TZ (default Asia/Kolkata), only while still unaccepted.
4. If deadline too soon for three, keep immediate + as many useful pre-deadline reminders as fit; never burst three at once.
5. Day-of prep reminders stay in `send-scheduled-order-reminders` (single logical owner per kind via `reminder_state` / idempotency).

**Deploy note:** Repo already sketches `scheduled_accept` with 2h lead - refine to explicit "three morning slots" product config; then deploy so live matches.

---

## 12. Pre-order, booking, enquiry policies

| Flow | Current (evidence / source) | Proposed |
|---|---|---|
| Pre-order / scheduled food | Same enqueue; scheduled title; acceptance deadline often prep-based | Keep separate from instant 30m; morning accept reminders |
| Service booking | `New Booking Confirmed` at create; booking reminders cron (not always HP bell); reschedule notify improved in remediation migrations | Confirm path; stop using order unacked cancel for bookings |
| Contact / enquiry | `enquired` order via contact RPC → insert enqueue; **MOM incident was not this** | SLA reminders without order auto-cancel unless an order exists |

Do not apply instant 30-minute cancel to enquiry-only rows without an acceptance lifecycle.

---

## 13. Durable queue, retries, idempotency

**Existing strengths:** `notification_queue` + idempotency keys; enqueue failure table path in obligation migration; minute wakeup; PNQ retries with backoff in repo; unacked keys `{orderId}-unacked-{1|2|3}`.

**Gaps to close:**
- Deploy reminder function parity (DEF-003).
- Never mark "heard"; store provider response codes; surface `no_tokens` / invalid token invalidation.
- Stuck `processing` reclaim (repo has attempt caps - verify live).
- One scheduler owner per reminder kind (status reminders vs scheduled prep) with shared eligibility checks on latest order status.

---

## 14. Order-state and cancellation race analysis

- Deadline authority: `orders.auto_cancel_at`.
- Accept vs expire: expire must `UPDATE … WHERE status='placed' AND auto_cancel_at <= now()` (or equivalent) so late accept wins.
- Reminder insert after cancel: worker must re-check status before insert (live unacked query is status-based; OK if cancel committed first).
- Duplicate refunds: expire path must stay idempotent (existing OAE design assumption - regression-test on 30m change).
- Scheduled: cancel at prep deadline must not use instant 5m/30m helper.

---

## 15. Defects ranked by severity

| ID | Sev | Evidence | Expected | Actual | Remediation |
|---|---|---|---|---|---|
| DEF-001 | P0 | setting=300; MOM life≈6m | Instant wait 30m | Cancel ~5-6m | Raise timeout to 1800; align UI/reminders/OAE |
| DEF-002 | P0 | queue success only | Ops can see delivery/ack gaps | Unknown at device | Telemetry + seller recovery dashboard; do not equate FCM 200 with heard |
| DEF-003 | P0 | bcce unacked×3; live FN source | No overnight unacked; morning accept bells | Overnight "still waiting" | Deploy repo reminder worker (+ refine morning trio) |
| DEF-004 | P1 | 0 stamped tokens | Capable Android use v3 native | Always v2 | Fix stamp pipeline; gated rollout |
| DEF-005 | P1 | buckets 10/20 vs 5m cancel | Reminders before deadline | Mostly unreachable | Fix with DEF-001 |
| DEF-006 | P2 | ack vs status code | Clear stop rule | Ack ≠ stop server reminders | Document; stop only on resolve (default) |
| DEF-007 | P2 | booking / enquiry matrix | Distinct SLAs | Partially shared unacked set includes `preparing`/`enquired` | Split reminder policies by order_type/status |

Findings format notes: reproduction for DEF-001/003 is "place instant / scheduled order and inspect queue + settings"; affected modules listed in §1 and §16.

---

## 16. Remediation steps and affected modules (approval gate)

**Do not implement until approved.** Suggested sequence:

1. **Deploy** `send-seller-status-reminders` from repo (far-future skip + scheduled_accept) - fixes DEF-003 immediately for open scheduled orders.  
   Module: `supabase/functions/send-seller-status-reminders`.
2. **Change** `order_acceptance_timeout_seconds` 300→1800 after dependency review - DEF-001.  
   Modules: `system_settings`, OAE SQL, expire edge, UI timers (read-only if they already use `auto_cancel_at`).
3. Retune unacked buckets to ~10 and ~20 only (optional keep early nudge).  
   Module: same reminder function.
4. Implement configurable morning reminder slots for scheduled accept.  
5. Fix Android token stamp (`stamp_device_token_client_build` success path) then gradual v3.  
   Modules: `usePushNotifications.ts`, gate table, PNQ.
6. Ops dashboard: pending placed, queue age, provider fail, unanswered approaching deadline.  
7. Automated tests (§17) before prod setting change.
8. Controlled deploy + rollback: revert setting to 300; set android gate `legacy`; redeploy previous reminder function version.

---

## 17. Required regression tests

- Instant: alert@0; remind@10; remind@20; no remind after accept; no cancel before 30m; cancel at 30m; concurrent accept/expire; duplicate cron; multi-device; controllable clock.
- Scheduled: alert immediate; closed store; skip overnight unacked; morning reminders; TZ; stop after accept; cancel at prep deadline; buyer status copy.
- Pre-order / booking / enquiry: independent lifecycles.
- Push payload: Android v2 vs v3 gate; iOS `gate_bell.caf` + time-sensitive flags (unit).
- Device: sound in fg/bg/terminated on real Android/iOS (manual evidence pack) - **cannot** be claimed from CI alone.

---

## 18. Deployment and rollback strategy

1. Sandbox / staging function deploy for reminders → verify on a test scheduled order no overnight unacked.  
2. Prod deploy reminder function only (low risk, behaviour closer to intended).  
3. Announce seller-facing 30m policy; flip setting; watch sweep + expire metrics.  
4. Rollback: setting→300; previous reminder bundle; android `mode=legacy`.  
5. Never force-channel-migrate without stamp coverage metrics > threshold.

---

## 19. Test results and environmental limitations

| Test | Result |
|---|---|
| Live SQL incidents A/B | Completed (this doc) |
| Deployed reminder source inspection | Completed (DEF-003) |
| Repo architecture map | Completed |
| Real-device audible tests for A/B sellers | **Not run** |
| Full PNQ v97 ↔ repo byte diff | **Not completed** (H-007) |
| Production behaviour changes | **None** (per Phase 10) |

---

## 20. Outstanding risks

- Sellers already trained on 5-minute urgency will see longer pending orders after 30m change (buyer wait / kitchen planning).
- Deploying repo reminders without morning-trio config still leaves a 2h-before-deadline nudge rather than three morning bells.
- iOS Focus will continue to produce "no bell" reports that look like product bugs.
- Android silent v2 channels cannot be fixed server-side for existing installs.
- Competing reminder systems (status vs scheduled prep) can still double-bell near prep if eligibility overlaps - needs shared exclusion rules.
- Declaring 100% audible delivery remains impossible under OS constraints; design for durable obligation + escalation + observability instead.

---

## Approval ask

Approved and executed (see Completion Report below).

---

# Completion Report (2026-10-26 remediation)

## Root cause and remediation

| Defect | Root cause | Remediation | Production status |
|---|---|---|---|
| **DEF-001** | `order_acceptance_timeout_seconds = 300` | Migration sets **1800**; helper default **1800**; UI already reads `auto_cancel_at` | **Live:** `_order_acceptance_timeout_seconds()` returns **1800**. Applies to **new** enter-`placed` stamps; existing rows keep their already-persisted `auto_cancel_at` |
| **DEF-002** | Ops treated provider accept as delivery/audible | `classifyPushDeliveryEvidence`; `notification_queue.delivery_evidence`; `seller_alert_ops_snapshot`; PNQ writes honest evidence; payload hint `provider_accept_not_audible` | Column + view **live**. PNQ evidence writes are **in repo**, **not yet redeployed** (still prior PNQ version until next PNQ deploy) |
| **DEF-003** | Live reminder v5 lacked far-future skip / morning slots | Shared policy + worker: skip overnight unacked; morning slots at deadline-180/-120/-60 min; recheck status before enqueue | **Live:** `send-seller-status-reminders` **v6** |

### Before / after policy

| Policy | Before | After |
|---|---|---|
| Instant accept window | 300s | **1800s** |
| Instant unacked bells | 3 / 10 / 20 min (3m useless under 5m cancel) | **10m and 20m** only (`*-unacked-10m` / `*-unacked-20m`) |
| Scheduled overnight unacked | Fired (live v5) | **Suppressed** when far-future (`isFarFutureScheduled`) |
| Scheduled morning accept | Missing on live | **Due slots** m180 / m120 / m60 before `auto_cancel_at` |
| Provider accept meaning | Implicitly "delivered" in ops reading | Explicit **`provider_accepted` + audible=`unknown`** |

### `#bcce1b63` historical verification

Under the new policy, the same order shape (scheduled next day, `auto_cancel_at` ~591m after create) is `isFarFutureScheduled=true`, so overnight `unacked-1/2/3` **would not enqueue**. Immediate placement alert path is unchanged. Morning slots at 07:30-3h / -2h / -1h IST become due before prep cancel. Automated test encodes this reconstruction.

### Android v2 / v3 strategy (no blind cutover)

- Unstamped Android tokens remain on **`orders_incoming_v2`** notification+data + `gate_bell`.
- v3 data-only requires stamp `order_alert_native_v1` + `app_version_code >= 67`.
- Client stamp retries improved (`PUSH_BUILD_ID=2026-10-26-SELLER-ALERT-STAMP-V2-SAFE`); zero stamped tokens still means **v2 fallback** until apps refresh.
- Gate rollback: `seller_alert_android_config.mode=legacy` or env `SELLER_ALERT_ANDROID_MODE=legacy`.

### Changed files

- `supabase/migrations/20261026250000_seller_alert_acceptance_30m.sql`
- `supabase/functions/_shared/seller-status-reminders-policy.ts` (new)
- `supabase/functions/send-seller-status-reminders/index.ts`
- `supabase/functions/process-notification-queue/index.ts` (delivery_evidence; not redeployed yet)
- `src/hooks/usePushNotifications.ts` (stamp retries)
- `src/test/seller-alert-reliability-remediation.test.ts` (new)
- `src/test/seller-priority-notify-matrix.test.ts`
- `src/test/seller-notification-remediation.test.ts`

### Automated tests

- `seller-alert-reliability-remediation` + related notify matrix / iOS / remediation / closed-store / scheduled-orders: **passed** (local Vitest).
- Real iOS/Android audible device matrix for remediation: **not run** this session.
- Audible success is **never** inferred from API responses in new classifiers.

### Deployment status

| Component | Version / state |
|---|---|
| `send-seller-status-reminders` | **v6** deployed (`ezbr_sha256` `2ad833fc…`) |
| Timeout setting / helper | **1800** live |
| `delivery_evidence` column + ops view | **Applied** |
| `process-notification-queue` | **Not redeployed** in this pass (code ready; evidence column unused until deploy) |
| Android channel routing | **Unchanged** (v2 default) |

### Outstanding risks / blockers

- PNQ not redeployed: `delivery_evidence` stays null until PNQ ships.
- Client stamp fix requires **app rebuild/release** to raise stamp rate; cannot force audible on muted channels / Focus / mute switch.
- Existing `#bcce1b63` may still be `placed`; morning slots will fire if still unaccepted before 07:30 IST - that is intended.
- Competing `send-scheduled-order-reminders` prep bells can still coincide near prep window.
- Zero missed notifications / guaranteed bell is **not** claimed.

### Rollback

1. `UPDATE system_settings SET value='300'::jsonb WHERE key='order_acceptance_timeout_seconds';` (and restore helper default if needed).
2. Redeploy previous `send-seller-status-reminders` v5 bundle (or earlier).
3. Android: keep / set `seller_alert_android_config.mode='legacy'`.
4. Drop or ignore `delivery_evidence` (non-breaking).
