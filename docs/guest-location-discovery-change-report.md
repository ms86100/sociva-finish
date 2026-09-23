# Guest location-first discovery - change report

**Branch:** `fix/guest-location-discovery`  
**Status:** Client-only implementation complete. **No production Supabase writes.** **No Codemagic / App Store deploy** until you explicitly approve after review.

## Why

App Store 5.1.1(v): login must not block browsing. Guests discover nearby catalog first (Swiggy-like); phone OTP only at cart / book / enquire / contact.

## Production architecture (read-only audit)

| Surface | Finding |
|--------|---------|
| Discovery RPCs (`search_sellers_paginated`, `get_products_for_sellers`, `search_products_v2`, `get_app_bootstrap`, `active_banners_for_society`) | Already `anon` EXECUTE on production |
| Seller radius | Enforced server-side via `seller_is_discoverable_to_buyer` / delivery radius |
| V1 path | **No new production GRANTS or RPCs required** |
| Integration project | Untouched for this V1 (client path only) |

## Client changes

| Area | Change |
|------|--------|
| `guest-browse-routes.ts` | Guest allow-list (home, search, categories, discovery, product, festival, seller storefront) |
| `location-onboarding.ts` | Local first-launch gate |
| `LocationDiscoveryPage` | Pre-permission explanation + GPS / manual map |
| `AppShellGate` | Guests browse allow-list; location onboarding redirect; **authenticated society → `/profile/edit` unchanged** |
| `ProtectedRoute` | Cart, orders, profile, favorites, subscriptions, notifications |
| `Header` | Guest **Sign in** + **Available near you** |
| `pending-auth-action.ts` | sessionStorage pending action + return path |
| Cart / enquire / book / contact | Set pending action → `/auth` → restore after OTP |
| `capacitor.config.ts` + `codemagic.yaml` | When In Use copy is discovery-first |

## Intentionally unchanged for logged-in users

- Society onboarding redirect when `!profile.society_id`
- Seller / admin / builder routes
- Cart mutation rules once authenticated
- No change to production DB policies or edge functions

## Test matrix (automated)

- `src/test/guest-location-discovery.test.ts` - allow-list, onboarding flag, pending action, source wiring, location copy

## Related docs

- Phase 0 audit: [`docs/guest-discovery-audit.md`](guest-discovery-audit.md)
- Phase 2 manual matrix: [`docs/guest-discovery-phase2-test-matrix.md`](guest-discovery-phase2-test-matrix.md)

## Manual QA checklist (before store build)

1. Fresh install / clear storage → location explanation → allow or manual → home browse without account  
2. Guest: home → product → add to cart → OTP → item restored / return to product  
3. Guest: enquire / book / contact → OTP → sheet resumes  
4. Signed-in user with society: home behavior unchanged  
5. Signed-in without society: still `/profile/edit`  
6. Deny location: can still pick map and browse  

## Deploy gate

**Do not** ship to TestFlight / production or apply Supabase migrations until this report is accepted and you reply with an explicit deploy approval.
