# 04 - Approved Content Glossary

Living reference for Sociva UI copy. Extend existing domain modules; do not add a new i18n framework.

Canonical standard: `02-sociva-terminology-standard.md`.

---

## 1. Copy module map

| Domain | Module | Extend for |
|--------|--------|------------|
| Seller onboarding | `src/lib/seller-onboarding-copy.ts` | Onboarding steps, CTAs |
| Buyer reach | `src/lib/buyer-reach.ts` | Reach option labels |
| Product timing | `src/lib/product-timing-copy.ts` | Timing labels |
| Order cancellation | `src/lib/order-cancellation-copy.ts` | Cancel reasons/messages |
| Cleaner City ride | `src/lib/cleaner-city/rideMissionCopy.ts` | Status, hints, pickup code |
| Cleaner City match | `src/lib/cleaner-city/matchCopy.ts` | Match reason chips |
| Commerce modes | `COMMERCE_MODE_COPY` in `CommerceModePage.tsx` | Book vs services titles |
| Notifications (server) | `supabase/functions/_shared/notification-display-copy.ts` | Fallback push titles/bodies |
| Shared UX (new, thin) | `src/lib/ux-copy/common.ts` | Cross-module actions/empty/errors if repeated 3+ times |

---

## 2. Approved repeated strings

### Actions

| Key | Approved |
|-----|----------|
| sign_in | Sign In |
| please_sign_in | Please Sign In |
| continue | Continue |
| book_now | Book Now |
| add_product | Add Product |
| send_request | Send Request |
| request_a_seat | Request a seat |
| offer_a_ride | Offer a ride |
| save | Save |
| confirm | Confirm |
| cancel | Cancel |
| try_again | Try again |

### Empty / errors / success

| Key | Approved |
|-----|----------|
| empty_generic | Nothing here yet |
| empty_rides | No rides yet. Find a match or offer a seat. |
| empty_orders | No orders yet |
| error_generic | Something went wrong. Please try again. |
| error_network | Connection problem. Check your network and try again. |
| success_saved | Saved |
| success_sent | Sent |

### Cleaner City

| Key | Approved |
|-----|----------|
| product_name | A Cleaner City |
| role_host | Host |
| role_guest | Guest |
| nav_home | Home |
| nav_find | Find |
| nav_my_rides | My rides |
| nav_route | Route |
| nav_you | You |
| fuel_contribution | Fuel contribution |
| fuel_help | Your share is calculated from route distance and the current petrol price. This is not a fare. |
| pickup_point | Pickup point |
| meeting_point | Meeting point |
| pickup_code | Pickup code |
| show_code_to_host | Show this code to your host. They type it to start - you do not enter it. |
| enter_guest_code | Ask your guest for the 6-digit pickup code, then start. |
| seats_available | Seats available |
| good_route_match | Good route match |
| route_match_soft | Similar route |

### Marketplace

| Key | Approved |
|-----|----------|
| store | Store |
| seller | Seller |
| buyer | Buyer |
| customer_seller_view | Customer |
| order_status | Order status |
| fulfilled_on | Fulfilled on {date} |
| payment_history | Payment History |
| personal_details | Personal Details |
| contact_details | Contact Details |

---

## 3. Status labels (Cleaner City) - keep humanised

From `rideMissionCopy.ts` (approved direction):

| Internal status | Display |
|-----------------|---------|
| requested | Waiting for host |
| confirmed | Seat confirmed |
| pickup_pending | Meet at the gate |
| started | On the road |
| completed | Ride done |
| rejected | Declined |
| cancelled | Cancelled |
| no_show | No-show |
| disputed | Under review |
| safety_incident | SOS active |

Do not show raw snake_case enums to residents.

---

## 4. Intentionally unchanged

- Legal Consumer Protection wording
- Society expense "Vendor Name"
- Database column names, API enums, RLS policy names
- Admin capability labels that remain admin-only (may still be polished)
- Dynamic user/seller names and real contact numbers

---

## 5. Onboarding credit

Any onboarding / welcome credit copy must state **500** Sociva Credits only, unless explicitly overridden for a specific case.
