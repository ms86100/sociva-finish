# Sociva WhatsApp Production Readiness Report

**Date:** 2026-08-03  
**Author role:** Lead Solution Architect / Senior Full Stack  
**Business number:** +91 99029 20804 (Phone Number ID `1188855344317220`)  
**Live API check:** `whatsapp_business_manager_messaging_limit` = **`TIER_250`**, `quality_rating` = **`GREEN`**, `verified_name` = **Sociva**

---

## PHASE 1 — Meta production readiness (evidence-based)

### Sources (Meta official)

| Topic | Source |
|---|---|
| Messaging limits / TIER_250 / scaling paths | [Messaging Limits](https://developers.facebook.com/documentation/business-messaging/whatsapp/messaging-limits) (updated May 21, 2026) |
| Recipient allowlist = test numbers only | Meta Cloud API Calling Troubleshooting: error `131030` — *“Only occurs when using public test numbers (PTNs)”* |
| Templates outside 24h customer service window | Meta WhatsApp Cloud API send / template guides |
| Authentication templates for OTP | Meta Authentication Templates documentation |
| Test assets vs production | Meta Get Started / Cloud API overview (test numbers require adding recipients; production business numbers do not) |

---

### Q1. Once production phone is registered, do I still whitelist every customer?

**No.**

- Error `#131030` (*Recipient phone number not in allowed list*) applies to **public test numbers (PTNs)** only, per Meta’s own troubleshooting docs.
- Your production sender `+91 99029 20804` is a registered business phone number, not a PTN.
- Live proof: API accepted a free-form text send to `918448802907` from Phone Number ID `1188855344317220` without any recipient allowlist step.

**What you still have instead of a whitelist:** a **portfolio messaging limit** — max unique WhatsApp users you can deliver to **outside** a customer service window in a rolling 24h period. Live value for Sociva: **`TIER_250`**.

---

### Q2. Can any customer receive messages from 9902920804 without being a test recipient?

**Yes, technically — with product rules:**

| Condition | Requirement |
|---|---|
| User messaged you within ~24h (customer service window) | Free-form text / interactive replies allowed |
| Business-initiated (OTP, booking confirm, order update, promo) | **Approved message template** + user **opt-in** (especially marketing) |
| Volume | Shared **TIER_250** unique users / 24h outside CSW until you scale |
| Cannot message | Your own business number as recipient; numbers not on WhatsApp |

So: no Meta “test recipient” list — but **not** “blast anyone anytime.”

---

### Q3. Exact limitations without Meta Business Verification

From Meta Messaging Limits (official):

| Item | Without Business Verification |
|---|---|
| Starting portfolio limit | **250** unique users / 24h outside CSW (`TIER_250`) — **confirmed live on Sociva** |
| Path to 2,000 | Verify business **OR** partner verify **OR** deliver **2,000** high-quality template messages to unique users in 30 days |
| Automatic scale to 10k / 100k / unlimited | Only after reaching 2,000 and meeting quality + utilization criteria |
| Official Business Account / green check | Generally requires verified business (not available as “unverified soft launch”) |
| Trust / review of templates & quality | Unverified portfolios face slower scaling and higher policy risk |
| Legal entity | Meta Business Verification expects legal business identity documents; you stated no registered company yet → **verification path is blocked until you incorporate / register** |

Verification is **not** a hard “API off” switch for a production number that already sends. It **is** the primary official path off `TIER_250` (unless you grind 2,000 template deliveries).

---

### Q4. Which message types still work?

| Message type | Works now? | How |
|---|---|---|
| **Customer replies** (user → Sociva) | **Yes** | Webhook / Cloud API inbound |
| **Free-form replies** (Sociva → user inside 24h CSW) | **Yes** | Session messages |
| **Booking confirmations** | **Yes, if** approved **utility** template (or inside CSW) | Template + opt-in for proactive |
| **OTP** | **Only via authentication templates** (Meta requirement for OTP use case); still subject to template approval + limits | Do **not** send OTP as free-form marketing-style text at scale |
| **Order updates** | **Yes, if** approved utility templates (or inside CSW) | Same |
| **Seller notifications** | **Yes, same rules** | Utility templates / CSW |
| **Marketing messages** | **Restricted** | Approved **marketing** templates + explicit opt-in; counts against messaging limit; higher quality/policy risk |

**Not verification-gated at “cannot send” level:** utility/service templates on a production number at `TIER_250`.  
**Verification-gated for scale:** moving past 250 unique users/day outside CSW (unless alternate 2,000-delivery path).

---

### Q5. What will not work / stay blocked until verification or billing?

| Blocker | Impact |
|---|---|
| **No legal company → cannot complete Business Verification** | Stuck on **TIER_250** unless you hit the 2,000-template path; no OBA trust signals |
| **No payment method on WABA** (if not already added) | Billable **template** traffic can fail or stop; Meta bills template deliveries (post-2025 per-message model) |
| **No approved templates** | Cannot reliably send booking/OTP/order/marketing **outside** 24h window |
| **Auth OTP templates** | Must use Meta authentication category; may face extra eligibility checks depending on account state |
| **Marketing at marketplace scale** | Unsafe/illegal without opt-in; poor quality → limit freezes / restrictions |
| **Temporary user tokens** | Production must use **permanent System User** token with WhatsApp permissions |
| **App / WABA not in Live mode** (if still Development for some assets) | Can limit webhook/production behavior — confirm App Mode = Live |

---

## Go / No-Go recommendation

### Soft launch (pilot / early users ≤ ~250 unique WA recipients/day outside CSW)

**CONDITIONAL GO**

Allowed if you:

1. Keep using production number **9902920804** (already registered, GREEN, Sociva display name).
2. Add **payment method** on the WABA if missing.
3. Create & get approved **utility** templates for booking/order/payment/refund (and **authentication** for OTP if WA OTP is required).
4. Collect **WhatsApp opt-in** at signup/checkout.
5. Route all sends through Notification Service (templates outside CSW).
6. Keep MSG91 SMS as OTP fallback until auth templates are approved and reliable.
7. Treat marketing as **off** until verification + marketing templates + opt-in UX.

### Full marketplace production (India-scale buyers + sellers)

**NO-GO until blockers cleared**

1. Register legal entity and complete **Meta Business Verification**.
2. Scale messaging limit off **TIER_250** (verify → 2,000 → automatic scaling).
3. Approve full template set (buyer + seller events below).
4. Permanent System User token in secrets (rotate any tokens pasted in chat).
5. Billing healthy; quality stays GREEN.
6. Wire Notification Service into `notification_queue` pipeline (Phase 2).

**Bottom line:** You are **not** stuck on a test-recipient whitelist. You **are** stuck on a **250 unique-user/day** soft ceiling and incomplete legal/verification/billing/template readiness for real Sociva scale.

---

## PHASE 2 — Application notification inventory & plan

*(Analysis only — implementation deferred until this report is accepted.)*

### Current architecture

```
DB triggers / edge fns / client enqueue
        ↓
notification_queue  →  process-notification-queue
        ↓
user_notifications (in-app) + FCM/APNs (push)
```

- **SMS:** MSG91 OTP only (`msg91-send-otp` / verify).
- **Email:** none for transactional.
- **WhatsApp:** `send-whatsapp` + `notificationService.ts` scaffold — **admin test only**, not commerce.

### Existing events (push + in-app today)

**Commerce:** new order, status transitions (`placed`, `enquired`, `requested`, `quoted`, `accepted`, `preparing`, `ready`, `scheduled`, `confirmed`, `rescheduled`, `on_the_way`, `arrived`, `delivered`, `completed`, `cancelled`, `no_show`, …), escalation nudges, booking create/cancel (client), UPI proof / verify / reject, order chat, booking reminders (1h/30m/10m).

**Delivery:** delivery OTP, gate OTP, en route, stalled.

**Payments:** refund completed/failed, SLA auto-approve; settlement on `payment_settlements` INSERT.

**Seller admin:** store/license/product approve/reject/suspend; daily summary; low stock; review received.

**Society / workforce:** visitor, parcel, disputes, snags, milestones, emergency, jobs, digests, campaigns.

**Auth:** SMS OTP only.

### Push gaps even before WhatsApp

- Refund **request** → seller not notified  
- Refund **approve / reject** → buyer often silent  
- Settlement eligibility/paid (beyond settlement row INSERT) incomplete  

### WhatsApp events to implement (after Conditional GO)

**Buyer (P0):** booking confirmed/cancelled/reminders; order accepted; out for delivery; cancelled; delivery OTP; refund completed/approved/rejected; payment verified/failed.

**Buyer (P1–P2):** quote received; ready; delivered; reschedule/no-show; review reminder; optional WA OTP; marketing only with opt-in + marketing templates.

**Seller (P0):** new enquiry/booking/order; cancellation; refund requested.

**Seller (P1–P2):** UPI pending; reminders; settlements; store approve/reject/suspend; review; low stock; earnings summary.

**Do not WA-spam:** every toast, society digests, favorited-product marketing without opt-in.

### Recommended Meta template names

`sociva_otp_login`, `sociva_booking_confirmed`, `sociva_booking_cancelled`, `sociva_booking_reminder`, `sociva_order_placed_seller`, `sociva_order_accepted`, `sociva_order_ready`, `sociva_order_out_for_delivery`, `sociva_order_delivered`, `sociva_order_cancelled`, `sociva_quote_received`, `sociva_delivery_otp`, `sociva_payment_pending_seller`, `sociva_payment_verified`, `sociva_refund_requested`, `sociva_refund_approved`, `sociva_refund_rejected`, `sociva_refund_completed`, `sociva_settlement_*`, `sociva_store_approved`, `sociva_store_rejected`, `sociva_new_message` (P2).

### Implementation plan (execute only after approval)

1. **Meta console:** payment method, utility + auth templates, confirm App Live, System User token.
2. **Extend** `_shared/whatsapp.ts` for template sends (not free-form only).
3. **Notification Service** as sole provider facade; add WhatsApp channel beside push.
4. **Hook** `process-notification-queue` (or parallel worker) to WA for allowlisted `type`s + user phone + opt-in flag.
5. **Prefs:** `notification_preferences.whatsapp` + consent timestamp.
6. **Wire P0 buyer/seller events**; close refund notify gaps.
7. **Keep SMS** for OTP until auth template proven.
8. **Observability:** `whatsapp_messages` + delivery webhooks; alert on quality downgrade.
9. **Pilot** ≤250 unique/day; then pursue Business Verification for scale.

---

## Delivery investigation — 8448802907 (2026-08-03)

| Finding | Evidence |
|---|---|
| API accepted free-form sends | Graph returned `wamid…` for `918448802907` |
| Handset never received | User report |
| Sample Meta templates blocked on production number | `#131058` Hello World / Jasper templates only from Public Test Numbers |
| Root cause | Outside **24h customer service window** + **no approved custom templates** yet → Meta accepts then fails/suppresses free-form delivery |
| Fix submitted | Custom templates `sociva_*` created — status **PENDING** Meta review |
| Immediate workaround | Recipient must WhatsApp **+91 99029 20804** first (“hi”), then free-form delivers; or wait for `sociva_hello` APPROVED |

## Immediate action checklist

- [x] Send “hello im from sociva” to 8448802907 from 9902920804 (API accepted — delivery blocked by CSW/templates)
- [x] Root-cause documented; custom templates submitted
- [ ] Confirm delivery after user messages business number OR templates approve
- [ ] Confirm payment method on WABA
- [x] Submit utility templates for P0 events (PENDING Meta)
- [ ] Register legal entity → start Business Verification
- [ ] Rotate any access tokens that appeared in chat
- [x] Phase 2 started: WA channel in `process-notification-queue` + refund notify gaps

---

*Report updated after delivery investigation + Phase 2 implementation.*
