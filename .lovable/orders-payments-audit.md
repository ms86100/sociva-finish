
# Orders & Payments Module — Deep Audit Report

## Scope

5 pages, 14 components, 1 RPC function, 7 tables, 2 DB triggers, 1 edge function.

**Pages**: CartPage, OrdersPage, OrderDetailPage, FavoritesPage, MySubscriptionsPage

**Components**: ReorderButton, OrderCancellation, UrgentOrderTimer, OrderRejectionDialog, OrderItemCard, CouponInput, PaymentMethodSelector, RazorpayCheckout, ReviewForm, FulfillmentSelector, DeliveryStatusCard, OrderHelpSheet, OrderChat, FeedbackSheet

**Tables**: orders, order_items, cart_items, payment_records, reviews, favorites, coupons, coupon_redemptions

**DB Triggers**: validate_order_status_transition, enqueue_order_status_notification, enqueue_order_placed_notification, trg_update_seller_stats_on_order, decrement_stock_on_order, set_order_society_id, generate_delivery_code, trg_auto_assign_delivery

**RPC**: create_multi_vendor_orders

**Edge Function**: create-razorpay-order

---

## Feature & Rule Inventory

### Cart Management
- Cart items stored in `cart_items` table with `user_id`, `product_id`, `quantity`
- `society_id` auto-populated via `set_cart_item_society_id` trigger from user profile
- Quantity update to 0 triggers removal (UI-enforced)
- Remove item shows undo toast (optimistic update)
- Clear cart requires confirmation dialog
- RLS: user can only read/write own cart items within their society

### Checkout Flow
- Minimum order amount per seller enforced in UI (CartPage)
- Pre-checkout product availability validation queries products table
- Unavailable items flagged; cart refreshed with toast notification
- Confirmation dialog shows per-seller order summary
- Multi-seller cart creates separate orders via `create_multi_vendor_orders` RPC
- Submit guard prevents double-click (useSubmitGuard hook)
- Delivery fee: free above threshold (system_settings), applied to first order only in multi-vendor
- Fulfillment type selection (self_pickup/delivery) per seller

### Order Creation (create_multi_vendor_orders RPC)
- Validates buyer profile exists
- Groups cart items by seller_id
- Proportional coupon discount across items
- Platform fee from system_settings
- Cross-society distance via haversine_km
- Urgent orders get `auto_cancel_at = now() + 3min`
- Cart cleared atomically after all sub-orders created
- Idempotency key generated per order
- Payment record created with platform fee
- Stock decremented via `decrement_stock_on_order` trigger

### Payment
- COD default when seller has no `upi_id`
- UPI via Razorpay Route (create-razorpay-order edge function)
- Payment status webhook polling (15s timeout)
- Payment record tracks: amount, method, platform_fee, status

### Order Status Transitions (validate_order_status_transition trigger)
- Standard: placed → accepted → preparing → ready → picked_up → delivered → completed
- Service: enquired → quoted → accepted → scheduled → in_progress → completed
- Terminal: completed, cancelled, returned (no further transitions)
- Notifications auto-enqueued on status change

### Cancellation
- Buyer can cancel when status is `placed` or `accepted` only
- Reason required from predefined list; "other" requires text input
- `cancelled` is terminal (no undo possible)

### Urgent Orders
- Timer countdown from `auto_cancel_at` field
- Warning states at 60s and 30s
- Timeout triggers auto-cancel and refetch
- Sound hook for seller view (useUrgentOrderSound)

### Coupons
- Code uppercased and trimmed on input
- Society-scoped: seller + buyer must share society
- Validation: expiry, start date, usage limit, per-user limit, minimum order amount
- Percentage discount with max cap; flat discount capped at order total
- Multi-seller cart blocks coupon input in UI

### Reviews
- Available for `completed` AND `delivered` orders (FIXED — was completed-only)
- Rating required (1-5 stars)
- Duplicate blocked by DB unique constraint (order_id)
- Comment optional, max 500 chars
- Category-specific dimension ratings from category_config.review_dimensions
- RLS: buyer_id = auth.uid() AND order status IN (completed, delivered)
- society_id auto-set via trigger

### Favorites
- Stored in `favorites` table (user_id, seller_id, society_id)
- society_id auto-set via `set_favorite_society_id` trigger
- Filtered by user's home society (FIXED — was effectiveSocietyId)
- Only approved, available sellers displayed
- Remove with instant UI update (optimistic)

### Reorder
- Checks product availability before adding to cart
- Warns about existing cart items (confirm dialog)
- Clears existing cart on confirmation
- Skips unavailable items with count toast
- Navigates to /cart on success

### Order Detail
- Realtime subscription for order updates (postgres_changes)
- Chat available when order not completed/cancelled
- Unread message count badge on chat icon
- Copy order ID to clipboard
- Feedback prompt with localStorage flag
- Delivery status card for delivery fulfillment orders
- Bill summary shows discount and delivery fee breakdown

---

## Discovered Issues

### O1 — CRITICAL: Review RLS blocked reviews on "delivered" orders ✅ FIXED
- **Problem**: INSERT policy only allowed `orders.status = 'completed'`; UI also only checked `completed`
- **Impact**: If seller marks order `delivered` but never `completed`, buyer can never review
- **Fix**: Updated RLS policy to allow `completed` OR `delivered`; updated `canReview` in OrderDetailPage

### O2 — CRITICAL: Order cancellation "Undo" always fails ✅ FIXED
- **Problem**: Undo attempted `cancelled → placed` transition; DB trigger blocks this (terminal state)
- **Impact**: User sees "Could not undo cancellation" error after clicking Undo
- **Fix**: Removed undo action from cancellation toast; replaced with simple `toast.success`

### O3 — MEDIUM: Delivery fee inconsistency in multi-vendor orders (DOCUMENTED)
- **Problem**: `payment_records.amount` excludes delivery fee for order 1; `total_amount` includes it
- **Impact**: Delivery fee revenue unattributed in seller earnings
- **Status**: Document only — involves financial logic requiring product decision

### O4 — MEDIUM: Coupon applied only for single-seller carts (DOCUMENTED)
- **Problem**: RPC processes coupon params even for multi-seller carts if UI bypassed
- **Impact**: Low risk — UI prevents multi-seller coupon application
- **Status**: Document only

### O5 — LOW: Order cancellation undo UX misleads users ✅ FIXED (via O2)

### O6 — LOW: Favorites filtered by effectiveSocietyId ✅ FIXED
- **Problem**: Admin "view as" caused personal favorites to disappear
- **Fix**: Changed to `profile?.society_id` for consistent personal data

### O7 — INFO: Order items status lacks DB-level transition validation (DOCUMENTED)
- **Problem**: No trigger validates item status transitions
- **Impact**: UI prevents backward transitions; direct DB access could bypass
- **Status**: Not user-facing; document only

---

## QA Round 2 — Findings

### A1 — COD auto-cancel race condition ✅ NOT_REPRODUCIBLE
- **Analysis**: `auto-cancel-orders` function already has `.neq("payment_method", "cod")` — COD orders explicitly excluded
- **Status**: No fix needed

### A2 — Multi-order navigation bug ✅ FIXED (previous round)
- **Fix**: `useCartPage.ts` line 265 now navigates to `/orders` when `pendingOrderIds.length > 1`

### A3 — verifyOTP timing attack ✅ FIXED (previous round)
- **Fix**: Replaced `===` with byte-level XOR comparison in `manage-delivery/index.ts`

### A4 — Cart addItem count rollback ✅ FIXED (previous round)
- **Fix**: `useCart.tsx` now captures `prevCount` before optimistic update and restores in catch block

### A5 — useOrderDetail missing useEffect dependency (DOCUMENTED)
- **Problem**: `fetchOrder` and `fetchUnreadCount` not in dependency array
- **Analysis**: Not a real bug — `id` is in deps and functions use `id` from closure; effect re-runs correctly on `id` change
- **Fix**: Added eslint-disable comment documenting the intentional pattern
- **Status**: Lint-level only; no runtime risk

### A6 — Signup profile email mismatch ✅ FIXED
- **Problem**: Profile insert used `email` from React state instead of `data.user.email`
- **Impact**: If Supabase normalizes email casing, profiles.email could differ from auth.users.email
- **Fix**: Changed to `data.user.email ?? email` in `useAuthPage.ts` line 344

### B5 — Profile email enumeration ✅ FIXED
- **Problem**: `handleCredentialsNext` queried profiles table by email, allowing unauthenticated enumeration
- **Impact**: Attacker could check if an email is registered without authenticating
- **Fix**: Removed direct profiles query; duplicate detection now relies on Supabase auth error and unique constraint

### D1 — fetchSocieties loads all societies without pagination (DOCUMENTED)
- **Problem**: `useAuthPage.ts` line 69-79 loads all active/verified societies
- **Impact**: Performance risk at scale (10K+ societies)
- **Status**: No user impact at current scale; requires UX redesign for search-as-you-type

### D4 — delete-user-account sequential deletion (DOCUMENTED)
- **Problem**: No dedicated delete-user-account edge function found; reset-and-seed-scenario deletes sequentially
- **Status**: Only used in dev/testing, not user-facing

---

## QA Round 3 — Findings

### CHECKOUT-01 — removeItem doesn't sync cart-count badge ✅ FIXED
- **Severity**: P2
- **Problem**: `useCart.tsx` `removeItem` didn't update the `cart-count` query, causing stale badge in BottomNav
- **Fix**: Added optimistic `cart-count` decrement on remove, with rollback in catch block

### CHECKOUT-02 — handleRazorpayFailed cancel-before-check race condition ✅ FIXED
- **Severity**: P1
- **Problem**: `useCartPage.ts` cancelled orders THEN checked if they were paid — webhook could mark paid between cancel and check, but the `.eq('payment_status', 'pending')` guard on cancel protects the DB. However the UX flow was confusing.
- **Fix**: Reversed the order — check payment status FIRST, then cancel only if still pending. Eliminates race window entirely.

### CHECKOUT-03 — updateQuantity doesn't sync cart-count badge ✅ FIXED
- **Severity**: P2
- **Problem**: `useCart.tsx` `updateQuantity` didn't update the `cart-count` query
- **Fix**: Added optimistic `cart-count` delta update with rollback in catch block

### AUTH-01 — Dead code in handleCredentialsNext ✅ FIXED
- **Severity**: P3
- **Problem**: Empty try/catch with `setIsLoading(true)` causing a flash — leftover from B5 fix
- **Fix**: Removed dead code; `setSignupStep('society')` called directly

---

## QA Round 4 — Orders + Delivery + Reviews

### ORDER-01 — ReorderButton doesn't check approval_status ✅ FIXED
- **Severity**: P1
- **Problem**: `ReorderButton.tsx` only checked `is_available` when fetching products for reorder, not `approval_status`
- **Impact**: Suspended/rejected products could be added to cart via reorder, failing at checkout
- **Fix**: Added `.eq('approval_status', 'approved')` to the products query

### ORDER-02 — OrderCancellation unused variable ✅ FIXED
- **Severity**: P3
- **Problem**: `previousStatus` declared but never used in `OrderCancellation.tsx`
- **Fix**: Removed dead variable

### DELIVERY-01 — Webhook allows unsigned requests when no secret configured ✅ FIXED
- **Severity**: P1
- **Problem**: `manage-delivery/index.ts` webhook handler fell through to allow any request when no `3pl_webhook_secret` was set
- **Impact**: Any unauthenticated request could change delivery statuses in production
- **Fix**: Changed fallback from "allow" to "reject with 503" when no secret is configured

### ORDER-03 — OrderList re-fetches on tab switches (DOCUMENTED)
- **Severity**: P2
- **Problem**: `location.key` dependency causes both buyer and seller order lists to re-fetch on tab switch
- **Impact**: Extra API calls; no data corruption
- **Status**: Documented — requires UX decision on caching strategy

---

## QA Round 5 — Community + Admin + Notifications

### BULLETIN-01 — Realtime channel not filtered by society_id ✅ FIXED
- **Severity**: P1
- **Problem**: `BulletinPage.tsx` realtime subscription listened to ALL bulletin_posts changes across all societies
- **Impact**: Unnecessary API calls for every user on every post in any society; potential cross-society data leak if RLS misconfigured
- **Fix**: Added `filter: society_id=eq.${effectiveSocietyId}` to the realtime channel; also scoped channel name per society

### BULLETIN-02 — Stale comment_count after adding comment ✅ FIXED
- **Severity**: P2
- **Problem**: `PostDetailSheet.tsx` showed stale "Comments (X)" header after adding a comment
- **Fix**: Mutate `post.comment_count` locally after successful comment insert

### BULLETIN-03 — Help request self-response not server-guarded (DOCUMENTED)
- **Severity**: P3
- **Problem**: No server-side check preventing author from responding to own help request
- **Impact**: UI prevents it; low risk
- **Status**: Documented — would need RLS policy or trigger

### NOTIFY-01 — Notification inbox pagination (NOT_REPRODUCIBLE)
- **Severity**: P2 (downgraded)
- **Problem**: Initially appeared to load all notifications, but `useNotifications` already has `.limit(50)`
- **Status**: Mitigated — 50 most recent shown; older ones not shown but no crash or data loss

---

## QA Round 6 — Security (RLS, Edge Functions, Rate Limiting)

### SEC-01 — process-settlements has no authentication ✅ FIXED
- **Severity**: P0
- **Problem**: `supabase/functions/process-settlements/index.ts` had zero auth — anyone could POST to trigger settlement processing or pass `force=true` to override the auto-settle toggle
- **Impact**: Attacker could trigger premature payouts, manipulate settlement status
- **Fix**: Added service-role-only auth check (`Authorization: Bearer <SERVICE_ROLE_KEY>`). Only cron or internal calls can invoke.

### SEC-02 — process-notification-queue callable without auth ✅ FIXED
- **Severity**: P1
- **Problem**: `supabase/functions/process-notification-queue/index.ts` had no auth. Publicly callable, could be used to trigger push processing by anyone.
- **Impact**: Spam trigger, potential notification queue exhaustion
- **Fix**: Added auth gate requiring either service-role key OR valid user JWT. Anonymous/unauthenticated calls are rejected with 401. Client-side callers (who pass user JWT via `supabase.functions.invoke()`) continue to work.

### SEC-03 — Test/seed functions properly gated ✓ VERIFIED
- **Severity**: N/A
- **Status**: `reset-and-seed-scenario`, `seed-integration-test-users`, `seed-test-data`, `save-test-results` all properly gated by `ALLOW_TEST_FUNCTIONS` env check. No issues.

### SEC-04 — Razorpay webhook signature verification ✓ VERIFIED
- **Severity**: N/A
- **Status**: `razorpay-webhook` has mandatory signature check with constant-time XOR comparison. Properly rejects missing/invalid signatures.

### SEC-05 — purge-non-admin-data properly admin-gated ✓ VERIFIED
- **Severity**: N/A
- **Status**: Uses `withAuth` + explicit admin role check from `user_roles` table. Correct.

### SEC-06 — Gate token security ✓ VERIFIED
- **Severity**: N/A
- **Status**: AES-GCM encryption, HMAC signing, timing-safe comparison, nonce-based replay prevention, security officer verification. Comprehensive.

---

## QA Round 7 — Multi-Vendor Order Flow Audit

### MVO-01 — P0: RPC regression — missing delivery_fee, discount, coupon, payment_records, delivery_handled_by, auth guard ✅ FIXED
- **Problem**: Migration `20260321135149` rewrote `create_multi_vendor_orders` for `auto_cancel_at` but stripped: `delivery_fee`, `discount_amount`, `coupon_id`, `delivery_handled_by`, `payment_records` INSERT, `coupon_redemptions` INSERT, `auth.uid()` caller check, delivery radius validation
- **Impact**: Payment recording broken (webhook no-op), unlimited coupon reuse, wrong delivery routing, no auth guard
- **Fix**: New migration merging all idempotency layers (advisory lock, ON CONFLICT, canonical response) with restored columns, payment_records INSERT, coupon tracking, auth guard, radius validation, and delivery_handled_by resolution

### MVO-02 — P0: Razorpay webhook silent failure ✅ FIXED (via MVO-01)
- **Problem**: No `payment_records` rows meant webhook's `UPDATE payment_records` found 0 rows → payments never marked paid → auto-cancelled
- **Fix**: Restored payment_records INSERT in the RPC

### MVO-03 — P1: Delivery fee only on first seller's order (DOCUMENTED)
- **Severity**: P1
- **Problem**: Flat delivery fee applied to first seller's order only in multi-vendor cart
- **Status**: Matches current UI (single "Delivery Fee" line in bill). True per-seller fees require UI + backend redesign.

### MVO-04 — P1: buyer_cancel_pending_orders guard ✓ VERIFIED
- **Problem**: Hypothesized that accepted orders could be cancelled on payment failure
- **Analysis**: RPC has `AND payment_status = 'pending'` guard. Additionally, `validate_order_status_transition` trigger blocks invalid transitions at DB level.
- **Status**: No fix needed

### MVO-05 — P2: COD cancellation message ✓ VERIFIED
- **Problem**: Hypothesized misleading cancellation reason for COD orders
- **Analysis**: `auto-cancel-orders` already differentiates: urgent-expired → "seller didn't respond in time", orphaned UPI → "payment not completed". COD orders hit the urgent path correctly.
- **Status**: No fix needed
