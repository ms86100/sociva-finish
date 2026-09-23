# Guest discovery - Phase 0 production audit (read-only)

**Date:** 2026-09-22  
**Production project:** `kkzkuyhgdvyecmxtmkpy` (read-only)  
**Feature branch:** `fix/guest-location-discovery`

## 1. Auth & routing (today → guest change)

| Surface | Production today | Guest change (client only) |
|--------|------------------|----------------------------|
| `AppShellGate` | Unauthenticated → `/auth` (native) or `/landing` (web `/`) | Guests may enter allow-listed browse paths; location onboarding first |
| Authenticated `!society_id` | Redirect `/profile/edit` | **Unchanged** |
| Cart / orders / profile / favorites / subscriptions / notifications | Shell-accessible when logged in | Wrapped in `ProtectedRoute` → `/auth` with `returnTo` |
| Seller / admin / builder | Role routes | **Unchanged** |

## 2. Discovery RPCs (anon EXECUTE already true on prod)

Inspected (read-only): `search_sellers_paginated`, `get_products_for_sellers`, `search_products_v2`, `get_app_bootstrap`, `active_banners_for_society`.

| Finding | Implication |
|--------|-------------|
| Already callable with anon key for read payloads | **No new production GRANTs required for V1** |
| Seller radius via `seller_is_discoverable_to_buyer` / `delivery_radius_km` | Keep server-side; no flat client km filter |
| Prefer client-only path | Integration guest RPCs **not** required for V1 |

## 3. Commerce gates (`!user`)

| Action | Gate | Pending restore |
|--------|------|-----------------|
| Add to cart | `useCart.addItem` | Yes → re-add after OTP |
| Enquire | `ProductEnquirySheet` | Yes → reopen sheet |
| Book | `ServiceBookingFlow` | Yes → reopen booking |
| Contact | `useProductDetail` / `ContactSellerModal` | Yes → reopen contact |
| Favorites | heart buttons | Auth + return path (no auto-favorite) |
| Orders / checkout / payments | Protected routes + existing user checks | Unchanged once authenticated |

## 4. Anon risk matrix

| Allowed for guests (read) | Must stay blocked |
|---------------------------|-------------------|
| Nearby sellers/products, categories, product detail, public storefront, festival collections, bootstrap needed for Home | Cart writes, orders, bookings, enquiries, payments, profile writes, seller ops, admin, wallet, credits, notification writes |

## 5. Impact matrix

| Actor | Intentional change? |
|-------|---------------------|
| Guest (new) | Location → browse → OTP on account action |
| Logged-in buyer with society | No |
| Logged-in buyer without society | No (still `/profile/edit`) |
| Seller / admin | No |
| Production DB / RLS / edge functions | No (until explicit approval) |

## 6. Backend decision

**V1 = client-only.** Production Supabase remains untouched. If App Review or telemetry later shows missing anon coverage, add **new** read-only guest RPCs on **integration first**, then request a separate prod GRANT approval.
