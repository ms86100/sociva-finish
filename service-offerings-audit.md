# SOCIVA Bookable, Contact & Enquiry Service Offering Audit

Audit date: 2026-08-08  
Production URL: `https://www.sociva.in`  
Supabase project: `kkzkuyhgdvyecmxtmkpy`  
Repository commit: `50e11b34feca8a86db9823df16e26b9bd6356a66` on `master`  
Working tree: materially dirty before this audit; findings reference the current working tree and deployed production catalog separately.

## Executive Summary

SOCIVA is **not safe to release as a trustworthy three-offering marketplace**.

- **Bookable** has the broadest visible implementation: live discovery, BOOK CTAs, slots, appointment details, buyer/seller calendar surfaces, order-backed state, cancellation/reschedule UI, reminders, reviews, and an atomic creation RPC. It is nevertheless unsafe because deployed privileged RPCs trust caller-supplied prices and relationships, slot administration lacks ownership controls, slot release can be repeated, rescheduling can target unrelated slots, payment is hardcoded to COD/pending, and failed idempotent retries can return false success.
- **Contact** supports a direct call/modal and a product-scoped chat data model. The production listings inspected have no contact phone, interaction logging can fail silently, and product-contact messages are written to tables the seller inbox never reads. A buyer can believe a message was sent while the seller has no usable retrieval/reply surface.
- **Enquiry** has an order-backed skeleton for quote/offer/visit actions, including order chat and generic statuses. The main production action, `request_service`, is incorrectly routed to Bookable, although the canonical product model defines it as an enquiry without required availability. Enquiry creation is non-transactional, non-idempotent, and has no structured quote or commercial conversion.
- Production contained **31 notification dead letters in the preceding 24 hours**, all grouped under `supabase.rpc(...).catch is not a function`, including order, order-status, chat, and settlement events.
- Production data contained one completed booking with `payment_status='pending'`, two past bookings still `confirmed`, 13 of 14 live Bookable products without a `service_listings` row, and only two of four live Bookable sellers with future available slots.

The live browser pass proves discoverability and existing-history rendering only. It did not perform destructive writes, real payment, simultaneous booking, cancellation, or rescheduling. Those cases are not marked PASS.

**Final release classification: RED — critical security, booking-integrity, false-success, and workflow-completeness defects make release unsafe.**

## Evidence Standard and Scope

Results use:

- **PASS**: directly observed in this run through live UI, production database/API evidence, or executable tests.
- **FAIL**: a directly observed deviation or a deployed code/catalog defect with deterministic impact.
- **BLOCKED**: attempted or required live verification was unsafe or lacked an authorized fixture.
- **NOT TESTED**: not attempted; never treated as PASS.

Current-run evidence:

- Authenticated production UI, read-only navigation.
- Production catalog, RLS, functions, triggers, constraints, aggregate counts, cron and 24-hour logs.
- Deployed Edge Function inventory and notification worker source.
- Current repository static tracing.
- Production build: PASS.
- Focused Vitest: 5 files, 630/630 tests passed.
- Broader test run: 1,413 passed, 312 skipped; database-heavy suites were blocked by 403s and the process required forced close.

Safety exclusions:

- No real charge, refund, notification blast, destructive deletion, or uncontrolled production write.
- Two-buyer concurrency, forged RPC, cross-tenant authorization, payment failure, refund, and cancellation writes are BLOCKED pending isolated fixtures and explicit authorization.
- Android/emulator, iPhone, tablet and payment-provider flows are NOT TESTED in this audit.

## Overall Score

```text
BOOKABLE: 32/100
CONTACT: 18/100
ENQUIRY: 22/100

OVERALL SERVICE OFFERING: 21/100

Silent Failure Risk: CRITICAL
Buyer Understanding: 34/100
Seller Understanding: 28/100
Technical Reliability: 20/100
```

The overall score is not a simple mean. Critical authorization, financial-authority, false-success and slot-integrity defects cap release readiness.

### Score breakdown

| Category | Bookable | Contact | Enquiry |
|---|---:|---:|---:|
| Functional completeness | 52 | 25 | 34 |
| Reliability | 18 | 18 | 16 |
| Buyer UX | 55 | 24 | 20 |
| Seller UX | 40 | 10 | 34 |
| State management | 24 | 8 | 28 |
| Error handling | 24 | 12 | 16 |
| Notification reliability | 18 | 14 | 16 |
| Security | 12 | 32 | 25 |
| Data integrity | 16 | 22 | 18 |
| Edge cases | 12 | 12 | 10 |
| Regression safety | 16 | 14 | 12 |
| Admin visibility | 12 | 6 | 16 |
| Test coverage | 10 | 5 | 7 |
| Production readiness | 10 | 5 | 8 |

### Genuine implementation estimate

| Service | Genuinely implemented | Partially implemented | Missing/broken |
|---|---:|---:|---:|
| Bookable | 52% | 29% | 19% |
| Contact | 24% | 28% | 48% |
| Enquiry | 31% | 34% | 35% |

These percentages describe breadth, not safety. A feature can be present yet release-blocked by one integrity flaw.

## Bookable Score

**32/100 — major gaps; DO NOT SHIP.**

What works:

- Live BOOK cards, detail CTA, slot picker, appointment details, My Appointments, Add to Calendar.
- Seller availability, slot and schedule surfaces exist.
- Order, order-item and booking creation are grouped in one RPC.
- Conditional slot increment is atomic.
- Buyer/seller ownership checks exist in key transition RPCs.
- Order-to-booking status synchronization, reviews and reminder jobs exist.

What fails or is unsafe:

- The booking RPC accepts authoritative seller, product, slot, date, time, product name, price, total and add-on price from the caller.
- It does not verify the product belongs to the seller, the slot belongs to the seller/product, supplied times match the slot, or totals match canonical prices.
- Failed setup commits a cancelled order; the same idempotency key can later return success with no valid booking.
- Any authenticated user can call deployed `generate_service_slots_for_seller()` for another seller.
- A buyer with a qualifying booking can repeatedly call `release_service_slot()` and reduce capacity multiple times.
- Reschedule does not validate new-slot seller/product/date/time and can corrupt counters.
- Capacity greater than one conflicts with a trigger that rejects any second active booking on the slot.
- Service-specific duration/buffer is displayed but slots are generated from store-level duration/buffer.
- Cancellation fee and notice are advisory UI checks, not authoritative cancellation rules.
- Recurrence stores configuration but generates no future bookings.
- Booking payment is always COD/pending; there is no Bookable checkout/payment state machine.
- Two production bookings were already past but still `confirmed`.

## Contact Score

**18/100 — severely incomplete; DO NOT SHIP as a managed Contact workflow.**

What works:

- Contact action type, listing configuration, direct-call modal and product-scoped chat storage exist.
- Conversation upsert prevents duplicate buyer/seller/product threads.
- Product-chat send has optimistic rollback and Realtime refresh.

What fails:

- Both production Contact products had no phone; one was live/approved.
- Anonymous/direct call continues even when interaction logging fails.
- Supabase errors are ignored in `logInteraction()`.
- Product-contact messages use `seller_conversation_messages`; the seller inbox uses `chat_messages`.
- Seller notification links open `/seller/messages`, which cannot display the contact conversation.
- No contact status, viewed/responded/closed state, SLA, history, cancellation, conversion, or admin queue.
- Contact relational tables lack seller/product/buyer FKs and allowed-value checks.

Actual semantics: **direct call or product chat**, not a managed callback/contact-request workflow.

## Enquiry Score

**22/100 — major gaps; DO NOT SHIP as a complete Enquiry/Quote workflow.**

What works:

- An order-backed enquiry skeleton exists for `request_quote`, `make_offer`, and similar non-cart actions.
- It creates an enquiry order, item, initial order chat, seller board entry and generic workflow.
- Order chat is visible to buyer and seller and supports Realtime/read-state.

What fails:

- All 11 production `request_service` products are routed into `ServiceBookingFlow`; none has a `service_listings` row.
- The intended `ProductEnquirySheet` is therefore unreachable for the primary Enquiry action.
- Order, item and first message are three independent client writes.
- The order-item error is ignored; chat failure leaves an order while showing failure; retry can duplicate.
- No idempotency key.
- Product list price is stored as enquiry total even when the buyer requests a custom quote.
- “Quoted” has no quote amount, line items, terms, expiry, revision or immutable acceptance snapshot.
- There is no conversion link to a paid order/booking.
- Null payment type can be presented as Online Payment.

## Current Architecture

SOCIVA has four overlapping sources of transaction semantics:

1. Buyer journey: `cart | book | enquire | contact`.
2. Category: transaction type, default action and behavior flags.
3. Store: `seller_profiles.default_action_type`.
4. Product: `products.action_type`.

Canonical intent:

```text
book     -> service_booking -> book
enquire  -> request_service -> request_service
contact  -> contact_enquiry -> contact_seller
```

Actual primary storage:

```text
Bookable:
products
  -> service_listings
  -> service_availability_schedules
  -> service_slots
  -> orders/order_items
  -> service_bookings
  -> reviews/refunds/notifications

Contact:
products
  -> seller_contact_interactions
  -> seller_conversations
  -> seller_conversation_messages

Enquiry:
products
  -> orders(order_type=enquiry)
  -> order_items
  -> chat_messages
  -> generic order workflow
```

There are two disconnected messaging systems:

- Order chat: `chat_messages`, visible in seller inbox.
- Contact chat: `seller_conversations` + `seller_conversation_messages`, not visible in seller inbox.

The active Admin Services tab is a placeholder. `AdminServiceBookingsPage.tsx` contains a more useful page but has no active route.

## Service Offering Matrix

| Capability | Bookable | Contact | Enquiry | Evidence |
|---|---:|---:|---:|---|
| Seller creates offering | PARTIAL | PARTIAL | YES | Product/store flows exist; only 3/14 Book products have service listings |
| Buyer discovers offering | YES | PARTIAL | PARTIAL | Book visible live; Contact/Enquiry CTAs not found in live sample |
| Buyer views details | YES | YES | YES | Shared product detail |
| Price | YES | YES | PARTIAL | Contact says contact for price; enquiry total is misleading |
| Availability | PARTIAL | NO | NO | 2/4 Book sellers have future slots |
| Cart | NO | NO | NO | Not the intended model |
| Checkout | NO | NO | NO | No Bookable/Enquiry conversion checkout |
| Payment | PARTIAL | NO | NO | Bookable hardcodes COD/pending |
| Booking/request | YES | NO | PARTIAL | Booking RPC exists; `request_service` misroutes |
| Seller acceptance | NO | NO | PARTIAL | Book starts confirmed; enquiry generic transitions |
| Seller rejection | PARTIAL | NO | PARTIAL | Generic status flow only |
| Cancellation | PARTIAL | NO | PARTIAL | Booking rules not enforced; enquiry generic cancel |
| Reschedule | PARTIAL | NO | NO | Present but unsafe |
| Refund | PARTIAL | NO | NO | Shared machinery does not deterministically cover confirmed bookings |
| Buyer notification | PARTIAL | PARTIAL | PARTIAL | Queue exists; 31 recent dead letters |
| Seller notification | PARTIAL | PARTIAL | PARTIAL | Contact deep-link is unusable |
| Admin visibility | PARTIAL | NO | PARTIAL | Placeholder/unused admin surfaces |
| Status tracking | PARTIAL | NO | PARTIAL | Contact has no status |
| History | PARTIAL | NO | YES | Cancelled booking hidden from calendar; enquiry order history |
| Reviews | YES | NO | PARTIAL | Generic order-linked review |
| Analytics | PARTIAL | NO | PARTIAL | No response/conversion funnel |

## Actual User Journeys

### Bookable

```text
Seller creates product
-> optional service_listings write
-> store-level availability and slots
-> buyer sees Book
-> buyer selects slot
-> create_service_booking_atomic()
-> order immediately confirmed, COD/pending
-> seller notification
-> generic order progression
-> completion/review
```

Broken expectations:

- “Confirm Booking” does not mean payment confirmed.
- There is no seller request acceptance step.
- Per-service duration/buffer/capacity are not authoritative in slot generation.
- Recurring means “configuration saved,” not recurring bookings created.

### Contact

```text
Buyer opens Contact
-> Call Now: best-effort interaction log -> tel:
or
-> Message: best-effort interaction log
-> product conversation/message
-> notification points to seller inbox
-> seller inbox cannot load the conversation
```

### Enquiry

Intended:

```text
Request Service -> enquiry -> seller response -> quote -> acceptance -> conversion
```

Actual for `request_service`:

```text
Request Service -> Book Service drawer -> no service listing/slots for normal enquiry products
```

Actual for other enquiry actions:

```text
form -> order insert -> item insert -> chat insert -> generic order statuses
```

## Functional Gap Analysis

1. Bookable payment/booking consistency is undefined beyond COD/pending.
2. Seller acceptance is bypassed by immediate `confirmed`.
3. Per-service duration, capacity, buffer and cancellation settings are partly stored but not consistently enforced.
4. Contact has no managed request lifecycle.
5. Contact chat has no seller consumption path.
6. Primary Enquiry action is routed to Bookable.
7. Quote status has no commercial quote.
8. Enquiry cannot convert to a linked order/booking.
9. Admin cannot investigate contacts, conversations, quote revisions or stalled requests.
10. Service schema migration history is not demonstrably self-contained.

## Silent Failure Analysis

Silent failures are **CRITICAL risk** because they include false business outcomes, not only telemetry loss:

- Contact interaction Supabase errors are ignored.
- Call feedback can toast success after database rejection.
- Contact message appears sent but is absent from seller inbox.
- Slot query errors render “No available slots.”
- Seller availability load errors expose defaults that can overwrite real data.
- Marketplace batch failures render “No listings found.”
- Enquiry order-item insert failure is ignored.
- Notification worker invocation errors are swallowed by clients.
- Production has 31 current dead letters despite successful worker HTTP responses.
- Failed booking retry can return success for a cancelled order.

## Buyer Confusion Analysis

Buyer understanding score: **34/100**.

The buyer cannot reliably answer:

- Is Request Service a booking or an enquiry?
- Is this booking paid, pending payment, or pay-later?
- Does the seller need to accept?
- Did Contact create a tracked request?
- Where is the Contact status?
- What amount did the seller actually quote?
- Is “Accepted” a commercial commitment?
- Will cancellation charge the displayed fee?
- Will recurrence actually create future appointments?
- What happens if notification delivery fails?

## Seller Confusion Analysis

Seller understanding score: **28/100**.

The seller cannot reliably answer:

- Where do Contact messages appear?
- Which requests require a quote versus a slot?
- Does “confirmed” mean paid?
- Does a Bookable order require acceptance?
- What amount/terms were quoted?
- What is the response deadline?
- What happens if no response is given?
- Why can Schedule disappear after a query error?
- Are availability defaults real or fallback data?
- Which completed/pending values affect earnings and settlement?

## Technical Reliability Analysis

Technical reliability score: **20/100**.

Positive controls:

- Atomic conditional slot increment.
- Buyer/seller ownership checks in several transition RPCs.
- Buyer + idempotency unique index for orders when a key is supplied.
- Notification queue, dead-letter storage and safety cron.
- RLS enabled on relevant public tables.
- Production build succeeds.

Release-blocking weaknesses:

- Privileged RPCs do not derive authority from canonical rows.
- Public/authenticated EXECUTE remains broad on critical RPCs.
- Slot regeneration and release authorization are unsafe.
- Enquiry lacks transaction/idempotency.
- Notification delivery is currently failing for multiple event families.
- Current tests do not execute the critical deployed RPC and RLS boundaries.

## Booking/State Machine Analysis

Observed booking/order states:

```text
orders:
payment_pending, placed, confirmed, preparing, ready, scheduled,
on_the_way, arrived, in_progress, completed, delivered,
enquired, quoted, accepted, rejected, rescheduled, cancelled

service_bookings:
pending, requested, confirmed, scheduled, rescheduled,
in_progress, completed, cancelled, rejected, no_show
```

Actual creation starts at:

```text
order.status = confirmed
booking.status = confirmed
payment_type = cod
payment_status = pending
```

This bypasses the conceptual request/acceptance stage. Production already has:

- 2 confirmed bookings in the past.
- 1 completed booking with payment pending.

Invalid or unsafe transitions:

- Reschedule can target an unrelated slot and supplied timestamps.
- `rescheduled` triggers release logic against the new slot.
- Cancellation fee/notice are not enforced by the cancellation mutation.
- Direct seller booking UPDATE policy is broader than required.
- `release_service_slot()` can be replayed.

## Payment Analysis

Bookable has no integrated checkout:

- Booking RPC hardcodes COD/pending.
- Buyer does not choose deposit/full/COD/online payment.
- Razorpay/wallet/loyalty flows are not designed as Bookable transitions.
- A confirmed booking can remain payment pending through completion.
- Paid confirmed-booking cancellation is not deterministically linked to refund creation.

Contact has no payment, which is appropriate, but the UI must state this.

Enquiry should have no payment before quote acceptance. Current enquiry rows store listing price as `total_amount`, and order detail can imply Online Payment when payment type is absent.

Unacceptable current possibility:

```text
booking = completed
payment = pending
refund = none
```

This exists once in production.

## Notification Analysis

| Event | Buyer | Seller | Admin |
|---|---:|---:|---:|
| Booking created | PARTIAL | PARTIAL | NO |
| Booking paid | PARTIAL | PARTIAL | PARTIAL |
| Booking confirmed | PARTIAL | PARTIAL | NO |
| Booking rejected | PARTIAL | PARTIAL | NO |
| Booking cancelled | PARTIAL | PARTIAL | PARTIAL |
| Reschedule | PARTIAL | PARTIAL | NO |
| Enquiry submitted | PARTIAL | PARTIAL | PARTIAL |
| Enquiry response | PARTIAL | PARTIAL | PARTIAL |
| Contact request | NO | PARTIAL | NO |
| Refund | PARTIAL | PARTIAL | PARTIAL |
| Payment failure | PARTIAL | PARTIAL | PARTIAL |

Production health:

```text
notification_queue total: 100
unprocessed: 0
failed queue rows: 0
dead letters: 31
dead letters in last 24h: 31
```

All 31 recent dead letters shared the root error:

```text
supabase.rpc(...).catch is not a function
```

Types affected: order_status, order, order_lifecycle, chat_message, chat, general and settlement.

Business writes and notification writes are mostly decoupled, which is correct, but the UI/admin do not expose delivery degradation and several clients swallow wake-up errors.

## Database/Data Integrity Analysis

Production aggregate checks:

```text
booking without order: 0
booking without product: 0
order without seller: 0
order without buyer: 0
paid cancelled without refund: 0
message without conversation: 0
completed booking with payment pending: 1
slot counter mismatch at query time: 0
past active bookings: 2
```

Important schema weaknesses:

- Contact conversation/interactions lack buyer/seller/product FKs.
- `service_bookings.order_id`, `slot_id` and `product_id` are nullable.
- Product action, contact phone, service duration, service listing and payment requirements are not enforced as cross-table invariants.
- Booking deletion behavior can erase history when seller profile is deleted.
- Rescheduling updates in place and self-references `rescheduled_from`; it does not preserve old values.

## Security/RLS Analysis

Confirmed in deployed production:

- All relevant public tables inspected have RLS enabled.
- Current `service_bookings` policies permit participant SELECT and seller UPDATE; the obsolete buyer INSERT policy in an older schema export is not active.
- `orders` participant UPDATE remains broad at the row level; column safety relies on triggers.
- `create_service_booking_atomic`, `book_service_slot`, `hold_service_slot`, `release_service_slot` and `reschedule_service_booking` have broad execution grants.
- `generate_service_slots_for_seller()` is callable by authenticated users and does not verify caller ownership.
- `release_service_slot()` authorizes a buyer with a qualifying booking, then blindly decrements; repeated calls are possible.
- `save_product_with_service()` can populate the entire products row from JSON.
- `update_product_with_service()` accepts `approval_status` from seller-controlled JSON.
- Contact message INSERT checks only `sender_id=auth.uid()`, not conversation participation.

Required remediation: revoke broad execution/direct mutations, expose narrow RPCs, enforce ownership and canonical derivation inside each privileged function, then add real role-based tests.

## Concurrency Analysis

Positive:

- Slot increment uses `UPDATE ... WHERE booked_count < max_capacity`.
- Order idempotency has a unique buyer/key index.

Failures:

- Booking conflict trigger rejects any second active booking, contradicting `max_capacity > 1`.
- Failed atomic booking commits a cancelled order and poisons idempotent retry.
- Enquiry has no idempotency key.
- Contact interaction and feedback taps have no idempotency.
- Reminder dedupe is count-then-insert without a unique event key.
- Reschedule counter logic can inflate or under-count.
- Slot release is replayable.

Two-buyer live collision is BLOCKED pending isolated production-safe fixtures. Static/deployed logic proves authoritative capacity updates exist, but capacity, retry and reschedule defects prevent a pass.

## Background Job Analysis

Active relevant jobs:

```text
*/5  * * * *  send-booking-reminders
*/10 * * * *  auto_cancel_expired_unpaid_orders
*/10 * * * *  notification queue wake-up
*/30 * * * *  due reminders
*/30 * * * *  auto-approve overdue refunds
```

Findings:

- Jobs were observed starting/completing.
- Booking reminders returned HTTP 200, but no inspected production booking had reminder timestamps.
- Reminder endpoint authorization is weak and cron credential material is embedded in migration SQL.
- Slot extension loops sellers without per-seller exception isolation.
- Slot generation uses UTC dates while buyer/seller semantics are India wall-clock.
- No recurrence-expansion job exists.
- Notification workers return success while moving affected records to dead letter.

## Regression Analysis

High-risk shared changes:

- Recent booking/chat hardening introduced the caller-authority and retry defects.
- Wallet/payment/refund changes operate on shared `orders` but Bookable bypasses checkout.
- Generic order statuses, payment triggers and settlement fallbacks can treat unsupported service rows as cart commerce.
- Multiple workflow maps disagree across TypeScript and SQL.
- `request_service` tests validate conceptual mapping while active UI routes it to booking.
- Notification queue changes currently produce dead letters.

Dead/duplicate code:

- `BookingSheet.tsx` is unused legacy UI.
- `ProductEnquirySheet` contains dead `book` and `request_service` metadata for paths intercepted elsewhere.
- `AdminServiceBookingsPage.tsx` is implemented but unreachable.
- Active Admin Services tab is a placeholder.
- Booking synchronization and workflow mapping exist in multiple generations of migrations/functions.

## Admin/Operational Visibility

Admin cannot reliably:

- list all Bookable/Contact/Enquiry objects by authoritative status;
- inspect slot-counter drift;
- locate failed or poisoned idempotent bookings;
- see Contact requests/conversations;
- see quote revisions/conversion;
- track seller response SLA;
- correlate booking payment/refund/settlement;
- act on notification dead letters from the service workflow;
- audit reschedule old/new values;
- identify stale confirmed bookings automatically.

The active Services tab should be replaced by the existing booking page plus Contact/Enquiry operational queues.

## Top 10 Silent Failures

### #1
**Failure:** Contact interaction logging fails but call/chat continues.  
**Evidence:** `ContactSellerModal.tsx` ignores Supabase `error`.  
**Who is affected:** Buyer, seller, admin.  
**Why:** Supabase resolves query errors instead of throwing.  
**Impact:** Missing leads/audit trail.  
**Severity:** P1.  
**Fix:** Inspect `error`; label dialer-open separately; retry asynchronously.  
**Test:** Force RLS/network failure and assert explicit non-blocking telemetry warning plus retry.

### #2
**Failure:** Contact message appears sent but seller cannot retrieve it.  
**Evidence:** Buyer writes `seller_conversation_messages`; seller inbox reads `chat_messages`.  
**Who is affected:** Buyer and seller.  
**Why:** Two disconnected chat models.  
**Impact:** Lost lead and trust.  
**Severity:** P0.  
**Fix:** Unify messaging or build a complete product-conversation inbox.  
**Test:** Send as buyer; seller must see/reply; buyer must receive/read reply.

### #3
**Failure:** Call feedback can show success after failed insert.  
**Evidence:** Insert result is not checked.  
**Who is affected:** Buyer/admin analytics.  
**Why:** False-success UI.  
**Impact:** Corrupt outcome analytics.  
**Severity:** P1.  
**Fix:** Check mutation result and enforce one feedback per interaction.  
**Test:** Simulate 401/409/timeout; no success toast.

### #4
**Failure:** Slot fetch failure renders normal “No available slots.”  
**Evidence:** `useServiceSlots`/picker collapse error to empty data.  
**Who is affected:** Buyer and seller.  
**Why:** Missing query error state.  
**Impact:** Lost bookings; seller appears unavailable.  
**Severity:** P1.  
**Fix:** Separate loading/error/unconfigured/full/empty states.  
**Test:** RLS/network failure must show Retry, never “no slots.”

### #5
**Failure:** Availability fetch failure exposes fake defaults.  
**Evidence:** Seller manager defaults Monday-Saturday 09:00-18:00.  
**Who is affected:** Seller/buyers.  
**Why:** Load errors are treated as no saved data.  
**Impact:** Seller can overwrite real schedule.  
**Severity:** P0.  
**Fix:** Block editing/saving until authoritative load succeeds.  
**Test:** Failed load cannot enable Save; old schedule remains intact.

### #6
**Failure:** Marketplace data failure appears as “No listings found.”  
**Evidence:** Batch errors become empty arrays.  
**Who is affected:** Buyers/sellers.  
**Why:** Error metadata is discarded.  
**Impact:** Marketplace appears empty.  
**Severity:** P1.  
**Fix:** Return partial/error state and render Retry.  
**Test:** One failed batch yields an explicit partial/error banner.

### #7
**Failure:** Enquiry item-link failure still allows success.  
**Evidence:** `order_items` insert result is ignored.  
**Who is affected:** Buyer/seller/admin.  
**Why:** Three non-transactional client writes.  
**Impact:** Productless enquiry and broken context.  
**Severity:** P0.  
**Fix:** Atomic idempotent enquiry RPC.  
**Test:** Inject item failure; no rows persist and no success toast.

### #8
**Failure:** Enquiry chat failure leaves an order but reports failure.  
**Evidence:** Order/item commit before chat error.  
**Who is affected:** Buyer/seller.  
**Why:** No rollback.  
**Impact:** Retry duplicates requests.  
**Severity:** P0.  
**Fix:** One transaction and idempotency key.  
**Test:** Retry after injected chat failure creates exactly one enquiry.

### #9
**Failure:** Failed booking retry returns false success.  
**Evidence:** Cancelled order is committed; idempotent branch checks only key.  
**Who is affected:** Buyer/seller.  
**Why:** Failure is represented as durable order state.  
**Impact:** Buyer sees booking confirmation without booking.  
**Severity:** P0.  
**Fix:** Roll back all writes; validate existing order + booking before idempotent success.  
**Test:** Full-slot request and two retries must create no order/booking and never return success.

### #10
**Failure:** Notification processing fails while business operation appears successful.  
**Evidence:** 31 recent dead letters; client wake-up errors swallowed.  
**Who is affected:** Buyer/seller/admin.  
**Why:** Worker runtime bug plus fire-and-forget invocation.  
**Impact:** Missed bookings, chats, statuses and settlements.  
**Severity:** P0.  
**Fix:** Repair worker, replay dead letters idempotently, alert on failure rate.  
**Test:** Each event reaches delivered or an alerted retry state; zero unexplained dead letters.

## Top 10 Buyer Confusion Issues

1. **Current UI:** Request Service opens Book Service. **Expected:** describe a need. **Actual understanding:** a slot purchase is required. **Fix:** route only `book` to booking; `request_service` to enquiry.
2. **Current UI:** “Booking confirmed!” with payment pending. **Expected:** confirmed means commercially secured. **Actual:** COD/pending and no seller acceptance. **Fix:** use “Appointment requested” or implement acceptance/payment.
3. **Current UI:** Contact may show no phone and no tracked fallback. **Expected:** a usable contact method. **Actual:** disabled call/message dead end. **Fix:** require at least one verified channel before publishing.
4. **Current UI:** No visible Enquiry CTA in live sample. **Expected:** ask before buying. **Actual:** feature appears absent. **Fix:** explicit “Send Enquiry” cards/details.
5. **Current UI:** Listing price becomes enquiry total. **Expected:** indicative price or no price. **Actual:** looks payable. **Fix:** separate indicative price from quote.
6. **Current UI:** Null payment can display Online Payment. **Expected:** no payment before quote acceptance. **Actual:** payment ambiguity. **Fix:** hide payment card pre-conversion.
7. **Current UI:** “Mark Accepted.” **Expected:** accept an exact quote/terms. **Actual:** generic status. **Fix:** “Accept ₹X quote valid until Y.”
8. **Current UI:** cancellation fee displayed. **Expected:** fee is enforced/reflected in refund. **Actual:** advisory only. **Fix:** one authoritative cancellation transaction.
9. **Current UI:** recurring bookings imply automation. **Expected:** future appointments created. **Actual:** only config stored. **Fix:** implement expansion or remove claim.
10. **Current UI:** cancelled booking disappears from appointments. **Expected:** durable confirmation/history. **Actual:** apparent disappearance. **Fix:** recent history and refund/status card.

## Top 10 Seller Confusion Issues

1. Contact messages never appear in seller inbox; unify the inbox and deep link.
2. Schedule tab disappears on loading/error; retain the tab and show Retry.
3. Availability failures display fake defaults; block editing until load succeeds.
4. “Mark Quoted” has no quote form; require amount, terms and expiry.
5. Request Service can arrive as a booking/no-slot dead end; preserve canonical journey.
6. Booking starts confirmed; seller cannot tell whether action is required.
7. Confirmed/completed bookings can remain payment pending; earnings meaning is unclear.
8. Completed-this-week stats omit earlier-week bookings due query range.
9. Contact/Enquiry has no response SLA, reminder, expiry or escalation.
10. No audit history explains reschedule, cancellation, payment or notification failures.

## Top 10 Technical Risks

1. Caller-controlled booking price/seller/product/slot/add-on authority.
2. Cross-seller slot regeneration by any authenticated user.
3. Replayable slot release causing capacity corruption.
4. Unsafe reschedule relationships/times and counter logic.
5. Failed booking idempotency false success.
6. Non-transactional/non-idempotent enquiry creation.
7. Disconnected messaging models and unusable notification route.
8. Cancellation/refund/payment state contradiction.
9. Notification worker dead-letter outbreak.
10. Duplicate and drifting workflow/business-rule implementations.

## Gap Register

| ID | Service | Gap | Type | Sev | Evidence/root cause | Concrete fix/test | Blocker |
|---|---|---|---|---|---|---|---|
| G01 | Bookable | Caller controls price/relationships | SECURITY/PAYMENT | P0 | Deployed atomic RPC trusts args | Canonical locked rows; forged-payload tests | YES |
| G02 | Bookable | Cross-seller slot regeneration | SECURITY/BOOKING | P0 | No ownership check | Owner/admin gate; adversarial RLS test | YES |
| G03 | Bookable | Replayable slot release | DATA/BOOKING | P0 | Slot-only decrement | Booking-transition release once | YES |
| G04 | Bookable | False idempotent success | API/BOOKING | P0 | Failed order committed | Rollback; valid booking required | YES |
| G05 | Bookable | Unsafe reschedule | BOOKING/DATA | P0 | Unrelated slot/times accepted | Lock/validate slot and policy | YES |
| G06 | Contact | Seller cannot see message | FUNCTIONAL | P0 | Split chat tables | Unified inbox E2E | YES |
| G07 | Enquiry | Non-atomic creation | API/DATA | P0 | Three writes | Atomic idempotent RPC | YES |
| G08 | All | 31 notification dead letters | NOTIFICATION/OPS | P0 | Worker runtime error | Fix/replay/alert | YES |
| G09 | Bookable | Payment hardcoded COD/pending | PAYMENT | P1 | No checkout state | Booking payment state machine | YES |
| G10 | Bookable | Cancellation fee not enforced | PAYMENT/BOOKING | P1 | Advisory precheck | Atomic cancellation/refund RPC | YES |
| G11 | Enquiry | Request Service routed to Book | FUNCTIONAL/UX | P1 | Wrong action classification | Route by canonical map | YES |
| G12 | Enquiry | No structured quote/conversion | FUNCTIONAL | P1 | Status-only quote | Quote tables + acceptance snapshot | YES |
| G13 | Contact | False-success telemetry | API/UX | P1 | Ignored errors | Check errors/idempotency | YES |
| G14 | Bookable | Slot errors look unavailable | UX/API | P1 | Error collapsed to [] | Explicit retry states | YES |
| G15 | Bookable | Service duration ignored | BOOKING | P1 | Store-level slots | Interval/capacity model | YES |
| G16 | Bookable | Recurrence is configuration only | FUNCTIONAL | P1 | No expansion job | Worker or remove UI | YES |
| G17 | All | Broad direct order update | SECURITY | P1 | Participant UPDATE + triggers | Narrow RPC-only mutation | YES |
| G18 | Contact | Missing FKs/status/SLA | DATABASE | P2 | Thin telemetry tables | Managed request model | NO |
| G19 | All | Admin Services placeholder | OPERATIONS | P2 | Real page unreachable | Route operational consoles | NO |
| G20 | All | No behavioral critical-path tests | TESTING | P1 | Source/map-heavy tests | DB/RLS/concurrency/E2E suites | YES |
| G21 | Bookable | UTC/IST boundary risk | DATA | P1 | UTC DB + wall-clock columns | Explicit timezone model | YES |
| G22 | All | Mobile/device audit incomplete | TESTING | P2 | No emulator/device run | Android/iOS/tablet matrix | NO |

## P0 Issues

- G01-G08.
- Release remains blocked until each has a deployed fix and passing regression evidence.

## P1 Issues

- G09-G17, G20 and G21.
- These block full rollout because they create major workflow, money, state and error ambiguity.

## P2 Issues

- G18, G19 and G22.
- Admin observability, lifecycle depth and device coverage must follow before scale.

## P3 Issues

- Visual polish, response analytics, conversion funnel, calendar conveniences, advanced recurrence and richer quote negotiation after correctness.

## Exact File-Level Fixes

### P0/P1 fix plan

| File / function | Current problem | Required change | Dependencies/risk | Required test |
|---|---|---|---|---|
| New migration overriding `create_service_booking_atomic()` | Trusts caller authority | Derive seller/product/price/add-ons/slot under lock | Orders, slots, notifications, payment | Forged price/seller/product/slot; concurrency |
| New migration overriding `book_service_slot()` | Slot metadata not bound | Validate slot seller/date/time/capacity/product model | Shared store-slot design | Cross-seller and spoofed-time rejection |
| New migration overriding `generate_service_slots_for_seller()` | No caller ownership | Require seller owner/admin/service role; cap horizon | Seller schedule triggers/cron | Buyer A cannot regenerate Seller B |
| New migration overriding/removing `release_service_slot()` | Replay decrement | Accept booking ID and release only on one valid transition | Cancellation/reschedule | Repeated release changes count once |
| New migration overriding `reschedule_service_booking()` | Unsafe slot/counter/policy | Lock both slots; validate relationship/time/notice; audit old/new | Status triggers | Concurrent reschedule and foreign-slot denial |
| `src/components/booking/ServiceBookingFlow.tsx` | Client authority and false success copy | Send identifiers only; display requested/payment state | New RPC response | Stale slot and idempotent retry UX |
| `src/components/booking/BuyerCancelBooking.tsx` + new migration | Policy advisory only | One cancellation/refund RPC; remove direct booking update | Refund/wallet/gateway | Fee/refund/capacity atomicity |
| `src/hooks/useServiceSlots.ts`, `TimeSlotPicker.tsx` | Error looks unavailable | Expose loading/error/retry/unconfigured/full | Query keys | Offline/RLS error-state tests |
| `src/components/seller/ServiceAvailabilityManager.tsx` | Fake defaults can overwrite | Block save until successful load; transactional save | Schedule regeneration | Load/insert failure preserves old schedule |
| `src/components/product/ProductDetailSheet.tsx` | `request_service` treated as book | Route only canonical Book actions to booking | Cards/action maps | All action types produce correct surface |
| New `create_enquiry_atomic` migration + `ProductEnquirySheet.tsx` | Partial/duplicate writes | Transaction, server authority, idempotency | Orders/items/chat/notifications | Inject each failure; one or zero records |
| `SellerMessagesPage.tsx`, `useSellerChat.ts` | Contact chat disconnected | Unified thread model/inbox/direct route/read state | Notifications/realtime | Buyer-send/seller-reply two-context E2E |
| `ContactSellerModal.tsx`, `CallFeedbackModal.tsx` | Ignored mutation errors | Check errors, dedupe, post-resume feedback | Contact schema | 401/timeout/duplicate tests |
| New quote migrations + seller/buyer quote components | No quote semantics | Versioned amount/terms/expiry/acceptance/conversion links | Payment/order/booking | Revision, expiry, accept, conversion |
| `process-notification-queue` deployed source | Current dead letters | Fix RPC promise usage; replay safely; alert | Queue/dead-letter schema | All event types deliver exactly once |
| `AdminServiceBookingsTab.tsx`, `AdminServiceBookingsPage.tsx`, `App.tsx` | Placeholder/unreachable | Route booking/contact/enquiry ops console | Admin RLS | Admin filter/investigate/audit E2E |

Historic migrations must not be edited. Every database change should be a new forward migration with explicit rollback SQL.

## Database Changes

1. Add canonical booking creation/cancellation/reschedule RPCs.
2. Revoke obsolete PUBLIC/authenticated execution and direct mutation paths.
3. Add booking invariant checks and an audit-event table for old/new values.
4. Resolve capacity model: one booking per slot or true capacity; make trigger/index agree.
5. Add managed `contact_requests` or unify Contact with the conversation/order model.
6. Add FKs/checks/idempotency for contact interactions and feedback.
7. Add `enquiries`, `quotes`, `quote_versions`, accepted snapshot and conversion links, or equivalent normalized order extensions.
8. Add unique event keys for reminders and notification dedupe.
9. Add reconciliation views/jobs for slot counters, stale bookings, payment contradictions and dead letters.
10. Store explicit timezone on seller/service; generate and compare instants consistently.

## API Changes

- Client submits IDs and user input only; server derives price, ownership, status and relationships.
- Return typed errors: `SLOT_TAKEN`, `SERVICE_UNAVAILABLE`, `PRICE_CHANGED`, `POLICY_WINDOW`, `PAYMENT_REQUIRED`, `IDEMPOTENT_REPLAY`.
- Enquiry creation returns one stable enquiry/order ID.
- Quote acceptance requires expected version and amount.
- Cancellation/reschedule require expected status/version to prevent stale writes.
- Notification operations return durable queue ID, not delivery success.

## Frontend Changes

- Separate Book, Contact and Enquiry routes/forms/copy.
- Display payment, acceptance, seller response, cancellation and next-step expectations before submit.
- Add explicit loading/error/empty states.
- Preserve cancelled/rejected history.
- Add seller Contact inbox and quote composer.
- Add direct notification deep links.
- Use accessible labels, `aria-live`, focus management and non-nested interactive card controls.
- Test 320/360/390px, tablet and desktop layouts at 200% zoom.

## Concrete Solution Design

### 1. Authoritative Bookable transaction

- **Problem:** caller controls money and slot relationships.
- **Root cause:** privileged RPC persists request payload as truth.
- **Behavior:** server locks canonical product/listing/slot, recalculates total, reserves once and returns deterministic status.
- **Database:** new RPC, invariant checks, unique idempotency, audit row.
- **Backend:** identifiers-only contract; typed errors.
- **Frontend:** review server quote; handle price/slot changes.
- **Notification:** enqueue after commit with dedupe key.
- **Security:** owner/product/slot validation; narrow grants.
- **Migration:** forward override; revoke old signature after client rollout.
- **Test:** forged payload, stale slot, two buyers, retry, rollback.
- **Rollback:** restore prior signature behind disabled feature flag; retain audit data.

### 2. Payment/booking consistency

- **Problem:** confirmed booking can be payment pending/completed pending.
- **Root cause:** hardcoded COD and generic order flow.
- **Behavior:** explicit pay-later or prepay policy; holds expire; confirmation follows payment/acceptance policy.
- **Database:** booking payment policy, hold expiry, valid transition constraints.
- **Backend:** create quote/hold, provider confirmation, atomic conversion.
- **Frontend:** payment choice and truthful statuses.
- **Notification:** payment success/failure and hold expiry.
- **Security:** provider/webhook authority for paid.
- **Migration:** backfill existing bookings to explicit pay-later/manual-review state.
- **Test:** success/failure/out-of-order webhook/abandon/cancel/refund.
- **Rollback:** disable online booking payment and preserve COD path.

### 3. Contact communication

- **Problem:** buyer message is invisible to seller.
- **Root cause:** split chat systems.
- **Behavior:** one thread visible to both, with status/read/SLA.
- **Database:** either migrate product conversations to canonical chat or add complete participant-constrained model.
- **Backend:** get/create/send/mark-read RPCs.
- **Frontend:** buyer and seller inboxes plus direct route.
- **Notification:** conversation-specific deep link.
- **Security:** participant membership on every insert/read/update.
- **Migration:** migrate existing product conversations; dual-read temporarily.
- **Test:** two-role send/reply/read/unauthorized access.
- **Rollback:** retain old tables read-only during cutover.

### 4. Atomic Enquiry and structured Quote

- **Problem:** partial writes and status-only quote.
- **Root cause:** client orchestration and generic order statuses.
- **Behavior:** idempotent enquiry; seller sends versioned quote; buyer accepts exact terms; one linked conversion.
- **Database:** enquiry/quote/version/conversion keys.
- **Backend:** create/respond/quote/accept/decline/convert RPCs.
- **Frontend:** dedicated forms and status timeline.
- **Notification:** submitted/responded/quote/expiry/acceptance.
- **Security:** participant ownership and immutable accepted snapshots.
- **Migration:** map existing enquiry orders; unresolved rows remain legacy read-only.
- **Test:** partial failure, retry, stale version, expiry, one conversion.
- **Rollback:** disable conversion while preserving enquiry/chat.

### 5. Notification recovery

- **Problem:** 31 recent dead letters.
- **Root cause:** worker RPC promise misuse.
- **Behavior:** queue remains authoritative; retry with backoff; alert and admin inspect/replay.
- **Database:** dedupe keys and replay audit.
- **Backend:** repair worker and classify retryable/permanent failures.
- **Frontend:** operation success remains separate from notification delivery.
- **Notification:** health alerts outside the failed channel.
- **Security:** admin-only replay and redacted diagnostics.
- **Migration:** none unless dedupe/replay columns are added.
- **Test:** all event families, worker duplicate execution, provider failure.
- **Rollback:** pause worker and retain queue without dropping records.

### 6. Time and availability

- **Problem:** UTC server comparisons and wall-clock columns can disagree.
- **Root cause:** implicit timezone and store-level slot assumptions.
- **Behavior:** seller timezone is explicit; slots represent canonical instants and service occupancy.
- **Database:** timezone, start/end timestamptz or deterministic conversion.
- **Backend:** timezone-aware generation and policy checks.
- **Frontend:** show buyer and seller timezone where they differ.
- **Notification:** schedule from canonical instant.
- **Security:** no client-supplied timezone authority for existing slots.
- **Migration:** backfill `Asia/Kolkata`, validate future slots, regenerate unbooked slots.
- **Test:** midnight, date boundary, DST-capable zones, 30/60/120-minute overlap.
- **Rollback:** default to India timezone and preserve booked slot snapshots.

## Test Plan

### Required E2E matrix

| Actor | Flow | Required result |
|---|---|---|
| Buyer | Discover each offering | Card shows type, price model, duration/next step |
| Buyer | Book | One slot/order/booking; truthful payment/acceptance |
| Buyer | Pay | Provider/database/UI agree |
| Buyer | Cancel | Policy, refund and slot release agree |
| Buyer | Reschedule | Old/new slot and audit agree |
| Buyer | Contact | Seller receives and can reply |
| Buyer | Enquire | One durable enquiry with status |
| Buyer | Respond | Correct thread, read state and notification |
| Buyer | View status | Meaning and next action are explicit |
| Seller | Create/edit/publish | Every configured field stored/displayed/enforced |
| Seller | Availability | Errors cannot overwrite; slots generated correctly |
| Seller | Accept/reject/cancel | Valid actor/state/payment consequences |
| Seller | Reschedule/respond/close | Buyer updates and audit record |
| Seller | History | Cancelled/completed/expired remain visible |
| Admin | View/search/filter | All three offerings and failed/stale states |
| Admin | Investigate/resolve | Correlated entity/payment/refund/notification trail |
| Admin | Audit | Who/old/new/reason/timestamp |

### Automated requirements

- **Unit:** price, timezone, policy, labels, status guards.
- **Integration:** atomic booking/enquiry/quote/cancel/reschedule/refund.
- **Concurrency:** same slot, same idempotency key, simultaneous reschedule/release.
- **RLS/API:** buyer A, seller A/B, anonymous, admin, forged IDs/fields.
- **Notification:** dedupe, retry, dead letter, deep link, unrelated-user exclusion.
- **Payment:** provider success/failure/replay/out-of-order, wallet/loyalty/refund.
- **E2E:** real buyer/seller/admin browser contexts for all three offerings.
- **Accessibility:** axe, keyboard isolation, labels, live regions, focus.
- **Device:** Android/iOS/tablet/web responsive and offline/resume.

No manual happy-path result can replace concurrency, RLS, payment and rollback tests.

## Regression Plan

Affected by fixes:

- Product cards/detail/action maps.
- Seller onboarding/product editor/default action.
- Orders/order items/status workflows.
- Booking/service listing/schedule/slot tables.
- Razorpay/COD/wallet/loyalty/refunds/settlements.
- Both chat systems and notifications.
- Seller dashboard/messages/schedule/stats.
- Admin routes and analytics.

Regression suites:

1. Cart purchase remains unaffected by service routing changes.
2. Bookable never enters cart fulfillment/stock logic.
3. Contact creates no order unless the redesigned semantics explicitly require one.
4. Enquiry does not reserve inventory/slot or show payment before conversion.
5. Conversion creates exactly one linked transaction.
6. Shared payment/webhook/refund logic fails closed for unsupported transaction types.
7. Multi-store ownership and seller switching remain isolated.
8. Existing order chat remains visible during contact-chat migration.
9. Notification deep links reach the exact entity/thread.
10. Clean migration replay creates the same schema/functions/policies as production.

## Production Readiness

### Bookable

```text
SAFE TO SHIP? NO
```

Critical caller-authority, slot regeneration/release, reschedule, retry and payment-state defects remain.

### Contact

```text
SAFE TO SHIP? NO
```

Direct calling is a thin utility, but the managed Contact journey is incomplete and product messages are seller-dead-ended.

### Enquiry

```text
SAFE TO SHIP? NO
```

The primary action is misrouted; creation can partially persist/duplicate; quote and conversion semantics are missing.

## Recommended Implementation Sequence

### Phase 1 — Emergency integrity and notification containment

1. Restrict slot-generation/release/booking/reschedule RPCs.
2. Repair notification worker, alerting and safe dead-letter replay.
3. Remove false-success idempotent booking path.

### Phase 2 — Authoritative Bookable state and money

1. Canonical server pricing/relationships.
2. Explicit acceptance/payment policy.
3. Atomic cancellation/refund and reschedule.
4. Counter reconciliation and stale-booking cleanup.

### Phase 3 — Correct journey routing

1. Make `book`, `request_service`, and `contact_seller` mutually consistent across category/store/product/UI/SQL.
2. Prevent unsupported/missing configuration from publishing.

### Phase 4 — Enquiry and quote correctness

1. Atomic idempotent enquiry.
2. Structured versioned quote.
3. Linked commercial conversion.

### Phase 5 — Contact correctness

1. Unified message model/inboxes.
2. Managed status/read/SLA.
3. Verified contact channel and consent.

### Phase 6 — Availability/time/recurrence

1. Explicit timezone and interval model.
2. Service duration/buffer/capacity enforcement.
3. Recurrence worker or remove recurrence claims.

### Phase 7 — UX clarity and accessibility

Truthful CTA/status/payment/cancellation/error copy, mobile layout, keyboard and screen-reader behavior.

### Phase 8 — Admin observability

Operational queues, correlation, stale/dead-letter alerts and audit history.

### Phase 9 — Automated test gates

RLS, API, integration, concurrency, notification, payment, refund, E2E, device.

### Phase 10 — Regression certification

Clean migration replay, staging load/concurrency, production-safe smoke, Android/iOS/web evidence, go/no-go review.

## Final Verdict

```text
RED
Critical functionality/reliability/security/data-integrity issues make release unsafe.
```

## Final Questions — Direct Answers

### 1. What is the current Bookable score?

**32/100.**

### 2. What is the current Contact score?

**18/100.**

### 3. What is the current Enquiry score?

**22/100.**

### 4. What percentage of each feature is genuinely implemented?

Bookable 52%; Contact 24%; Enquiry 31%.

### 5. What percentage is partially implemented?

Bookable 29%; Contact 28%; Enquiry 34%.

### 6. What functionality exists in UI but does not work end-to-end?

Request Service, Contact product messaging, recurring booking, cancellation fee, structured reschedule policy, quote acceptance/conversion, admin Services management, several availability/error states.

### 7. What functionality exists in backend but is not exposed correctly?

Product conversations, booking admin page, generic enquiry transitions, contact-enquiry workflow, slot holds, service fields, reminder/dead-letter diagnostics and several audit/notification primitives.

### 8. What can fail silently today?

Contact logs/feedback, contact seller retrieval, enquiry item linking, notification delivery, slot/marketplace/availability queries, seller dashboard capability detection, booking retry validity and test-result persistence.

### 9. What can create duplicate bookings or requests?

Enquiry retries, contact interaction taps, reminder count-then-insert, replayable slot release/counter drift, and poisoned booking idempotency. Booking creation has conditional capacity protection but remains unsafe under its surrounding rules.

### 10. What can create inconsistent buyer/seller state?

Split chats, stale query caches, missing Realtime booking subscription, broad generic order transitions, partial enquiry writes, reschedule counter defects, notification loss and hidden cancelled history.

### 11. What can cause money/payment confusion?

Confirmed COD/pending bookings, completed/pending production record, enquiry list price stored as total, null payment shown as Online Payment, unenforced cancellation fee and unclear paid-booking refunds.

### 12. What can cause buyer confusion?

Request Service becoming Book Service, absent Contact/Enquiry CTAs, confirmation-before-payment, generic statuses, no tracked Contact state, hidden cancellations and recurrence claims.

### 13. What can cause seller confusion?

Invisible Contact messages, disappearing Schedule tab, fake availability defaults, no quote composer, unclear acceptance responsibility, pending payment at completion and no SLA/operational queue.

### 14. What existing code is likely to cause regression?

Multiple action/workflow maps; shared generic order/payment/refund/settlement logic; legacy BookingSheet; dead enquiry action metadata; duplicate chat models; historic trigger generations; current notification worker; store default overriding product action.

### 15. What are the top 10 bugs another senior QA engineer would probably discover?

1. Contact message absent from seller inbox.
2. Request Service opens booking/no slots.
3. Enquiry retry duplicates after chat failure.
4. Slot query error says no availability.
5. Cancellation fee not applied.
6. Recurrence creates no future booking.
7. Confirmed/completed booking remains payment pending.
8. Cancelled booking disappears.
9. Seller availability defaults overwrite after load failure.
10. Order/chat/status notifications fail or deep-link incorrectly.

### 16. What are the top 10 UX problems another product designer would discover?

The ten Buyer Confusion issues above: journey naming, confirmation/payment, Contact availability, absent Enquiry, indicative price, payment card, generic quote status, cancellation promise, recurrence promise and hidden history.

### 17. What are the top 10 engineering problems another senior engineer would discover?

The ten Technical Risks above: caller authority, cross-seller regeneration, replay release, unsafe reschedule, poisoned idempotency, non-atomic enquiry, split chat, payment/refund contradiction, notification dead letters and duplicated business rules.

### 18. What must be fixed before release?

All P0 and P1 issues, with deployed RLS/RPC/concurrency/payment/notification/E2E evidence.

### 19. What can safely remain for later?

Advanced analytics, richer quote negotiation, optional recurrence, visual polish and convenience features—only after truthful core journeys, admin incident visibility and baseline accessibility.

### 20. Would I approve SOCIVA going live tomorrow?

```text
DO NOT APPROVE
```

Bookable can be manipulated into financially and relationally inconsistent records; slot administration and retries are unsafe; Contact can lose seller-visible leads; Enquiry is misrouted and partially persistent; notification delivery is actively degraded. These are correctness and trust failures, not cosmetic gaps.
