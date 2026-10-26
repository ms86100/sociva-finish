# SOCIVA SILENT DEFECT DISCOVERY AUDIT

**Phase:** 1 - Discovery and planning only (no application code changes in this phase)  
**Date:** 2026-10-26 (IST)  
**Auditor role:** Principal architect / QA / reliability / security / product (agent-assisted)  
**Authority:** User deep defect discovery brief; wait for explicit approval before remediation  

---

## Executive summary

Highest-risk, evidence-backed issues found in this pass:

| Priority | ID | Title | Why it matters |
| --- | --- | --- | --- |
| P1 | SOCIVA-AUDIT-001 | Native deep links to `/explore/*`, `/book`, `/services` rewritten to `/orders` | Shared guided-discovery and Book/Contact links open the wrong destination on native |
| P1 | SOCIVA-AUDIT-002 | Marketplace data waterfall (sellers → products → chunked seller_profiles) | Home / Book / Contact / Explore shelf likely exceed 1s to useful content on cold cache |
| P2 | SOCIVA-AUDIT-003 | `/seller/orders/:id` lacks `ProtectedRoute` while `/orders/:id` is protected | Auth gate inconsistency; relies on RLS + page behaviour only |
| P2 | SOCIVA-AUDIT-004 | Pending deep-link consume waits for `user && profile` | Cold-start taps can delay until profile hydrates; incomplete profiles still a risk surface |
| P3 | SOCIVA-AUDIT-005 | Promotion / food_discovery fallback lands on `/category/food_beverages` when path missing | Diverges from product rule that marketing blasts default to `/` |
| P2 | SOCIVA-AUDIT-007 | Campaign deep-link picker offers dead paths (`/marketplace`, `/offers`, `/bulletin`, `/home`) | Admin-selected push destinations do not match App routes (`/` and `/community`) |
| P1 | SOCIVA-AUDIT-011 | `app-images` INSERT RLS only checks `auth.uid() IS NOT NULL` | Authenticated user may upload under another user’s storage prefix |
| P2 | SOCIVA-AUDIT-008 | Session expiry hard-redirects to `#/auth` with no `returnTo` | User loses cart/order context after re-login |
| P2 | SOCIVA-AUDIT-009 | Optional “Schedule for later” without slot still places instant order | Buyer can think order is scheduled when it is not |
| P2 | SOCIVA-AUDIT-012 | `pickNotificationRoute` prefers any `reference_path` over type-based order route | Stale `/` or wrong path can beat `/orders/:id` |
| P3 | SOCIVA-AUDIT-010 | `handleImageError` hides broken images with no guaranteed placeholder | Empty tiles on home/book listings |
| P3 | SOCIVA-AUDIT-006 | Large dirty working tree on `main` | Uncommitted discovery/UI work increases regression risk vs last shipped SHA |

**Recommended remediation order:** AUDIT-001 → AUDIT-011 → AUDIT-007 → AUDIT-002 → AUDIT-009 → AUDIT-008 → AUDIT-003 → AUDIT-004 → AUDIT-012 → AUDIT-005 → AUDIT-010 → working-tree hygiene → device push + paid-order gates.

**Addenda:** Route inventory from [Inventory routes and features](446a4090-1711-426e-a908-368f0598e6ba); silent-defect static scan from [Scan silent defect risks](6c59d044-9946-4194-a2f6-7e8b9c5eb08e). Push landing uses `reference_path` / `action_url` / `route` (not a `dest` column).

**Performance ask (`<1s` for home, book, contact, orders, account):** Not implemented in this phase. Evidence and a concrete plan are in sections 9 and 13. No source edits until you approve.

---

## 1. Repository and environment baseline

| Item | Value |
| --- | --- |
| Repo | `https://github.com/ms86100/sociva-finish.git` |
| Branch | `main` (tracks `origin/main`) |
| Local HEAD | `4ba9c19` (`fix: show Stay in the loop notification ask on home after any login`) |
| Working tree | **Dirty** - many modified `src/**` discovery/home/commerce files + large untracked tmp/apk/docs artifacts. Preserved; not reset. |
| Frontend | React + Vite + HashRouter (`src/App.tsx`), Capacitor Android/iOS |
| Backend | Supabase project `kkzkuyhgdvyecmxtmkpy` (production) |
| Public web | `https://www.sociva.in` |
| Prior audit HEAD (shipped E2E record) | `d635741` in `docs/audits/SOCIVA-COMPLETE-E2E-REGRESSION-AUDIT.md` (older than current HEAD) |

### Safe checks run this session

| Command | Result |
| --- | --- |
| Focused Vitest: admin-moderation-deeplinks, guided-discovery, home-search-filters, listing-trust, guest-location-discovery | **41 passed** / 5 files |
| Full Vitest / Playwright device matrix / paid checkout | **NOT RUN** this pass (scope = discovery) |
| Native iOS/Android push tap | **NOT TESTED** (no device session this pass) |
| Live paid order / refund | **BLOCKED** (no authorised charges) |

Companion historical evidence (not re-executed as PASS here):  
`docs/audits/SOCIVA-COMPLETE-E2E-REGRESSION-AUDIT.md`,  
`docs/audits/SOCIVA-ORDER-NOTIFICATION-RELIABILITY-AUDIT.md`,  
`docs/audits/SOCIVA-SELLER-NOTIFICATION-DEVICE-MATRIX-2026-10-24.md`.

---

## 2. Architecture summary (from source)

- **SPA:** React Router HashRouter; routes declared in `src/App.tsx`.
- **Shell:** `AppShell` / `BottomNav` (Home, Book, Contact→`/services`, Orders, Account→`/profile`).
- **Data:** Supabase client; marketplace composed via `useMarketplaceSellers` + `useMarketplaceProducts` + extra `seller_profiles` select in `useMarketplaceData`.
- **Mobile:** Capacitor; Android App Links for `www.sociva.in` / `sociva.in` in `android/app/src/main/AndroidManifest.xml`; hostname in `capacitor.config.ts`.
- **Share:** OG URLs via `/api/share/product|store/...` in `src/lib/sociva-share.ts`; native path normalisation in `src/hooks/useDeepLinks.ts`.
- **Push:** `usePushNotifications` + `pickNotificationRoute` / `resolveNotificationRoute` in `src/lib/notification-routes.ts`; queue processing in edge functions (historically audited).

---

## 3. Feature and route inventory (primary buyer shell)

| Path | Component | Auth gate | Notes |
| --- | --- | --- | --- |
| `/` | `HomePage` | Guest OK (shell) | Eager import; prefetches buyer routes |
| `/book` | `CommerceModePage` | Guest OK | Lazy |
| `/services` | `CommerceModePage` | Guest OK | Contact mode; `/contact` redirects here |
| `/orders` | `OrdersPage` | `ProtectedRoute` | Lazy |
| `/orders/:id` | `OrderDetailPage` | `ProtectedRoute` | |
| `/seller/orders/:id` | `OrderDetailPage` | **No ProtectedRoute** | Alias path |
| `/profile` | `ProfilePage` | `ProtectedRoute` | Account tab |
| `/account` | Navigate → `/profile` | | |
| `/explore/:hubId` | `GuidedDiscoveryHubPage` | Guest browse | Meal/cuisine hubs |
| `/product/:productId` | `ProductDeepLinkPage` | Guest | Share target |
| `/seller/:id` | `SellerDetailPage` | Guest | Store share target |
| `/cart` | `CartPage` | Guest / auth at checkout | |
| `/search`, `/category/:category`, `/discovery/:type` | respective pages | Guest | |
| `/auth`, `/welcome`, `/landing` | auth/marketing | | Native prefers fixed login |
| `/seller/*`, `/admin/*`, society/workforce routes | seller/admin/society | Role routes | Large surface; mapped in App.tsx |

Full route table continues in `src/App.tsx` (~lines 601–760+): seller dashboard, admin, society, workforce, builder, etc. Those remain in the coverage matrix as inspected-for-presence; runtime PASS not claimed.

---

## 4. Audit coverage matrix

| Feature / journey | Role | Inspection | Result | Defect IDs |
| --- | --- | --- | --- | --- |
| Auth returnTo / guest browse paths | Buyer | Code + Vitest guest-location | Pass (static/tests) | |
| Deep link normalisation + KNOWN_ROUTES | Shared | Code (`useDeepLinks.ts`) | **Fail** | AUDIT-001 |
| Share URL generation (product/store) | Buyer | Code + existing share tests (not re-run full suite) | Pass (static) | |
| Share open → native app (device) | Buyer | | **Not Tested** | |
| Push tap → route | Seller/Buyer | Code path | Probable OK when `reference_path` set; cold-start uses pending link | AUDIT-004 |
| Push delivery sound / killed app | Seller | | **Not Tested** / historically partial | |
| Home first meaningful paint | Buyer | Code waterfall | **Fail risk** | AUDIT-002 |
| Book / Contact load | Buyer | Same marketplace pipeline | **Fail risk** | AUDIT-002 |
| Orders / Account chunk load | Buyer | Lazy + prefetch | Probable OK after warm prefetch; cold first tap unmeasured | AUDIT-002 |
| Instant / scheduled / pre-order place | Buyer/Seller | | **Blocked** (no paid sandbox this pass) | |
| Seller order accept / notify | Seller | Prior audits + code | Partial historical evidence | |
| `/seller/orders/:id` auth | Seller | Route table | **Fail** (gate inconsistency) | AUDIT-003 |
| Promotion default dest | Shared | `notification-routes.ts` | Probable product mismatch | AUDIT-005 |
| RLS order ownership | Shared | Client select by id only | Unverified without RLS SQL review this pass | |
| Admin / society / workforce | Admin | Route presence only | Not Tested | |
| UI clipping across all screens | All | | Not Tested (no full visual pass) | |
| Uncommitted discovery UI regression | Buyer | Working tree dirty | Unverified suspicion | AUDIT-006 |

---

## 5. Deep-link and shareable-link findings

### SOCIVA-AUDIT-001 - Unknown deep-link segments forced to `/orders`

- **Severity:** High  
- **Classification:** Confirmed defect (code path)  
- **Role:** Buyer / seller / guest  
- **Platform:** iOS / Android (native deep-link handler)  
- **Feature:** App Links / `sociva://` / cold+warm `appUrlOpen`  
- **Evidence:** `src/hooks/useDeepLinks.ts` `KNOWN_ROUTES` set (lines 13–20) does **not** include `explore`, `book`, `services`, `discovery`, `subscriptions`, `directory`, `disputes`, `workforce`, `group-buys`. Handler (lines 144–147):

```text
if (topSegment && !KNOWN_ROUTES.has(topSegment)) {
  console.warn('Deep link: unknown route segment', topSegment, '→ fallback to /orders');
  path = '/orders';
}
```

  Verified by script against the Set: `explore`, `services`, `book` → **MISSING**.  
  Meanwhile App registers `/explore/:hubId`, `/book`, `/services` (`src/App.tsx`). Guest browse treats `/explore/...` as valid (`isGuestBrowsePath` tests).

- **Reproduction (expected on device):** Open `https://www.sociva.in/#/explore/home_food?tile=meal:dinner` or path-style equivalent via App Link → native resolves top segment `explore` → stores `/orders` → after auth navigates to Orders, not Dinner hub.  
- **Expected:** Preserve `/explore/...`, `/book`, `/services`.  
- **Actual (code):** Rewritten to `/orders`.  
- **Impact:** Shared discovery / Book / Contact links appear “broken” (app opens wrong place).  
- **Root cause:** Allowlist incomplete vs router.  
- **Confidence:** Confirmed (static). Device retest still required for end-to-end.  
- **Recommended fix:** Expand `KNOWN_ROUTES` from router inventory (or allow any first segment that matches `App.tsx` routes); never default unknown guest browse hubs to `/orders`. Add Vitest for `resolveDeepLinkPath` + allowlist.  
- **Regression tests:** `explore/home_food`, `book`, `services`, `api/share/product`, unknown segment safe fallback.

### Share generation (positive evidence)

- `productShareUrl` / `storeShareUrl` use `https://www.sociva.in/api/share/...` with OG (`src/lib/sociva-share.ts`).  
- `resolveDeepLinkPath` maps `/api/share/product|store` → `/product/:id` / `/seller/:id` (lines 93–105).  
- Classification: Pass (static). Device WhatsApp handoff: Not Tested this pass.

### SOCIVA-AUDIT-004 - Pending deep link gated on profile

- **Severity:** Medium  
- **Classification:** Probable defect / cold-start risk  
- **Evidence:** `src/App.tsx` AppRoutes effect: `if (!user || !profile) return;` then `consumePendingDeepLink()` after 300ms.  
- **Impact:** Notification/deep-link navigation deferred until profile exists; competing with onboarding redirects.  
- **Confidence:** Probable.  
- **Fix direction:** Consume on `user` once session restored for already-public routes; keep auth wall only for protected paths.

---

## 6. Notification routing findings

| Area | Evidence | Result |
| --- | --- | --- |
| Order taps | `resolveNotificationRoute` order_* → `/orders/:id`; push tap calls `pickNotificationRoute` then `navigate` + `setPendingDeepLink` | Pass (static) |
| Seller refund | Explicit seller refund routes | Pass (static); covered by admin/refund tests historically |
| Promotion / food_discovery | Fallback `/category/food_beverages` if no path | AUDIT-005 |
| Device delivery / sound | Requires physical device | Not Tested |
| Duplicate delivery | Prior reliability audits | Not re-verified |

### SOCIVA-AUDIT-005 - Promotion fallback destination

- **Severity:** Low–Medium (product consistency)  
- **Classification:** Probable defect vs stated product rule  
- **Evidence:** `src/lib/notification-routes.ts` cases `promotion` | `food_discovery` | `campaign`: missing path → `/category/food_beverages`. Workspace push rule: default dest `/` for marketing blasts unless named otherwise.  
- **Confidence:** Probable (policy vs code).  
- **Fix:** Default `/` for `promotion`/`campaign`; keep food_discovery on food category only when that type is intended.

### SOCIVA-AUDIT-007 - Campaign screen picker uses dead App paths

- **Severity:** Medium  
- **Classification:** Confirmed defect (admin UI vs router)  
- **Role:** Admin → all push recipients  
- **Platform:** Shared (push tap on web/iOS/Android)  
- **Evidence:** `src/components/admin/campaign/CampaignDeepLinkPicker.tsx` `SCREEN_OPTIONS`:

| Picker path | App.tsx reality |
| --- | --- |
| `/marketplace` | No route (only historical name in deep-link allowlist) |
| `/offers` | No route; also **missing** from `KNOWN_ROUTES` → native rewrite to `/orders` (AUDIT-001 interaction) |
| `/bulletin` | No route; live community is `/community` |
| `/home` | No route; home is `/` |

  Working destinations in the same picker: `/orders`, `/profile`. Store/product kinds that emit `/seller/:id` and `/product/:id` are fine.

- **Expected:** Picker only offers real HashRouter paths (`/`, `/community`, `/book`, `/services`, `/explore/...`, etc.).  
- **Actual:** Admin can queue campaigns that open NotFound or Orders.  
- **Impact:** Marketing/ops pushes look “broken” after tap.  
- **Confidence:** Confirmed.  
- **Recommended fix:** Replace options with live routes; map legacy stored `reference_path` values on send/read.  
- **Regression tests:** Campaign picker unit contract; pickNotificationRoute for remapped legacy paths.

**Push field note (inventory):** Queue/FCM data uses `reference_path`, `action_url`, and `route` - there is no `dest` column on the push path.

---

## 7. Silent functional defect findings

### SOCIVA-AUDIT-003 - Seller order detail route unprotected at router layer

- **Severity:** Medium  
- **Classification:** Confirmed inconsistency / probable auth gap  
- **Evidence:** `src/App.tsx`: `/orders/:id` wrapped in `ProtectedRoute`; `/seller/orders/:id` is not. Both render `OrderDetailPage`. Data load uses `orders` select by id (`useOrderDetail.ts`) - **RLS must** enforce ownership; not re-audited in SQL this pass.  
- **Impact:** Unauthenticated users may hit the page shell; data should empty via RLS (unverified). Inconsistent UX vs buyer path.  
- **Confidence:** Confirmed for missing ProtectedRoute; unverified for data leak.  
- **Fix:** Wrap with `ProtectedRoute` (and SellerRoute if seller-only). Add test that anonymous redirect matches `/orders/:id`.

### SOCIVA-AUDIT-008 - Session expiry drops return destination

- **Severity:** Medium  
- **Classification:** Confirmed code-path risk  
- **Evidence:** `src/App.tsx` ~257–259: toast then `window.location.hash = '#/auth'` with no `returnTo` / `from` state. Contrast: `ProtectedRoute` / BottomNav pass `returnTo`.  
- **Impact:** After expiry on `/orders/:id` or `/cart`, re-login returns to default home, not prior context.  
- **Confidence:** Confirmed (static).  
- **Fix:** Capture current hash path into auth state or `sessionStorage` before sign-out redirect.  
- **Regression tests:** Simulated auth error mid-route restores destination after login.

### SOCIVA-AUDIT-009 - Optional schedule toggle can still place an instant order

- **Severity:** Medium  
- **Classification:** Confirmed code-path risk  
- **Evidence:** `src/hooks/useCartPage.ts`: `sendScheduledSlot = schedulingRequired || wantsScheduledDelivery`, but place-order only hard-blocks when `schedulingRequired && !scheduleSlotValid` (lines ~969–971). Optional toggle with empty date/time still places; RPC schedule params stay null when date/time missing (744–745).  
- **Expected:** If buyer enables “Schedule for later”, require a valid slot before Place Order (or clear the toggle).  
- **Actual:** Instant order can be created while UI implied scheduling.  
- **Confidence:** Confirmed (static); DB outcome needs one sandbox place to prove.  
- **Fix:** Gate place when `wantsScheduledDelivery && !scheduleSlotValid`; align CTA label with actual schedule payload.  
- **Regression tests:** Open-store cart → schedule ON → no slot → Place Order blocked.

### SOCIVA-AUDIT-010 - Broken images hide without placeholder

- **Severity:** Low–Medium  
- **Classification:** Confirmed UX code-path risk  
- **Evidence:** `src/utils/imageHelpers.ts` `handleImageError` sets `display: none` after transform retry; many call sites lack a sibling fallback (e.g. listing cards).  
- **Fix:** Always show gradient/initials placeholder; prefer `OrderStripThumb`-style candidate chains.  
- **Confidence:** Confirmed.

### SOCIVA-AUDIT-011 - `app-images` INSERT RLS unbound to user folder

- **Severity:** High (security / ownership)  
- **Classification:** Confirmed code-path risk (policy text); live cross-user upload **Not Tested** this pass  
- **Evidence:** `supabase/migrations/20261025120000_app_images_upload_auth_uid.sql` INSERT policy: `bucket_id = 'app-images' AND auth.uid() IS NOT NULL` only - no `storage.foldername(name)[1] = auth.uid()`. Clients still path as `${ownerId}/...` (`image-upload.tsx`).  
- **Impact:** Any authenticated user may INSERT objects under another user’s prefix if they can craft the path.  
- **Confidence:** Confirmed for weak policy; exploitability Unverified without storage probe.  
- **Fix:** Restore folder-bound `WITH CHECK`; keep `auth.uid()` reliability. Do not weaken further.  
- **Regression tests:** User A cannot upload to User B prefix (integration).

### SOCIVA-AUDIT-012 - Notification `reference_path` overrides type routing

- **Severity:** Medium  
- **Classification:** Probable (payload-dependent)  
- **Evidence:** `pickNotificationRoute` returns any non-dead `reference_path` starting with `/` before `resolveNotificationRoute` (`notification-routes.ts` ~278–281). Bare `/` is not in `DEAD_ROUTE_PATTERNS`. Order type with stale `reference_path='/'` opens home, not order.  
- **Fix:** Ignore vague paths (`/`, `/home`, dead campaign paths); prefer type+entity_id for order/chat.  
- **Confidence:** Probable.  
- **Verify:** Inbox row `type=order` + `reference_path=/`.

### Other silent risks inspected (no primary finding)

- Cart double-submit: `useSubmitGuard` on primary place-order - not elevated ([Scan silent defect risks](6c59d044-9946-4194-a2f6-7e8b9c5eb08e)).  
- Cart / closed-store size sheet: prior E2E PASS - not re-run UI this pass.  
- Double booking / payment: **Blocked** (no live money).  
- Share product/store URLs: remapped before unknown-route fallback - Pass (static).

---

## 8. UI/UX and text-clipping findings

- Full visual audit across all account/seller/admin screens: **Not Tested** this pass.  
- Recent discovery listing polish exists only in **local dirty tree** (GuidedDiscovery*). Do not treat as production until committed/deployed.  
- Classification for subjective “more mesmerizing”: Improvement Suggested, deferred until after P0/P1.

---

## 9. Performance findings (home / book / contact / orders / account < 1s)

### SOCIVA-AUDIT-002 - Marketplace waterfall + Book/Contact eager pagination

- **Severity:** High (user-stated SLO)  
- **Classification:** Confirmed architecture risk; runtime TTI **Not Measured** this pass  
- **Evidence:**  
  1. `src/hooks/queries/useMarketplaceData.ts`: sellers → products → chunked `seller_profiles` enrichment.  
  2. `src/hooks/queries/useCommerceModeListings.ts`: while `hasMoreSellers`, keeps `fetchNextSellers` (50/page, cap 1000); `isLoading` stays true until pagination + top-up finish - delays first useful paint on `/book` and `/services`.  
  Home / Book / Contact / Explore share this pipeline. Global Query `staleTime` alone does not remove the waterfall.  
- **Lazy routes:** Book/Contact/Orders/Profile are `lazyWithRetry`; Home prefetches via `prefetchBuyerRoutes()` - helps warm tab switches, not cold marketplace content.  
- **Expected (user):** Interactive useful content on those tabs in **&lt; 1s**.  
- **Actual:** No lab measurement this session; structural waterfall + eager full pagination make &lt;1s cold content unlikely.  
- **Confidence:** Probable fail vs SLO; Confirmed as multi-phase fetch + Book/Contact pagination gate.  
- **Recommended fix (plan only):**  
  1. Instrument TTU on `/`, `/book`, `/services`, `/orders`, `/profile`.  
  2. Collapse seller enrichment into sellers RPC; stop third round-trip.  
  3. Paint first marketplace page immediately; background-fetch more sellers (do not block `isLoading` on full cap).  
  4. Cached React Query hydration for society marketplace.  
  5. Ensure Orders/Account do not wait on marketplace.  
- **Acceptance:** Median TTU &lt; 1000ms on mid Android + production API for logged-in society user with warm disk cache; cold network documented separately.

---

## 10. Security and data-consistency findings

| Topic | Result |
| --- | --- |
| Client order fetch by id only | Relies on RLS - **Not re-verified** in DB advisors this pass |
| Admin routes | `AdminRoute` present |
| Seller routes | `SellerRoute` present for dashboard; order alias gap AUDIT-003 |
| Secrets in repo | `.env` modified locally - do not commit; not expanded in this report |

No Critical security exploit confirmed without RLS proof. Do not weaken RLS to “make routes work”.

---

## 11. Platform-specific findings

| Platform | Finding |
| --- | --- |
| Android App Links | Intent filters present for `www.sociva.in` / `sociva.in` (`AndroidManifest.xml`) - config present; live verify **Not Tested** |
| iOS associated domains | Not fully verified this pass |
| HashRouter vs path App Links | `resolveDeepLinkPath` handles hash and path - Pass (static); interact with AUDIT-001 allowlist |
| Web | Share + routing mostly HashRouter; OG bounce via `/api/share` |

---

## 12. Severity-ranked defect register

| ID | Severity | Classification | Confidence |
| --- | --- | --- | --- |
| SOCIVA-AUDIT-001 | High | Confirmed defect | Confirmed |
| SOCIVA-AUDIT-002 | High | Architecture risk vs &lt;1s SLO | Probable / Confirmed waterfall |
| SOCIVA-AUDIT-003 | Medium | Confirmed inconsistency | Confirmed (route); Unverified (leak) |
| SOCIVA-AUDIT-004 | Medium | Probable cold-start risk | Probable |
| SOCIVA-AUDIT-005 | Low–Medium | Probable product mismatch | Probable |
| SOCIVA-AUDIT-007 | Medium | Confirmed dead campaign paths | Confirmed |
| SOCIVA-AUDIT-008 | Medium | Confirmed session returnTo loss | Confirmed |
| SOCIVA-AUDIT-009 | Medium | Confirmed optional schedule gap | Confirmed |
| SOCIVA-AUDIT-010 | Low–Medium | Confirmed blank image UX | Confirmed |
| SOCIVA-AUDIT-011 | High | Confirmed weak storage INSERT policy | Confirmed policy; exploit Unverified |
| SOCIVA-AUDIT-012 | Medium | Probable stale reference_path | Probable |
| SOCIVA-AUDIT-006 | Low | Process / regression risk | Confirmed dirty tree |

---

## 13. Prioritised remediation plan (no code until approval)

### P1-A - Deep link allowlist (AUDIT-001)

1. Defects: AUDIT-001  
2. Root cause: Incomplete `KNOWN_ROUTES`  
3. Files: `src/hooks/useDeepLinks.ts`, new/extended unit tests  
4. Implementation: Add all first-path segments from `App.tsx` (at least `explore`, `book`, `services`, `discovery`, `subscriptions`, `directory`, `disputes`, `workforce`, `group-buys`, `checkouts`, `festival-collection`, …). Prefer generating allowlist from a shared route-constants module. Unknown segments → `/` or soft inbox, **not** `/orders`, unless order-shaped.  
5. Regression risk: Low if tests cover share + explore  
6. Tests: resolveDeepLinkPath cases; optional Capacitor mock  
7. Acceptance: Native open of explore/book/services lands on correct hash route  
8. Rollback: Revert allowlist PR  

### P0/P1 - Storage INSERT ownership (AUDIT-011)

1. Defects: AUDIT-011  
2. Root cause: Migration dropped folder-bound CHECK  
3. Files: new migration on `storage.objects` policy for `app-images`  
4. Implementation: `WITH CHECK (bucket_id = 'app-images' AND auth.uid() IS NOT NULL AND (storage.foldername(name))[1] = auth.uid()::text)` (or equivalent). Deploy carefully; verify seller/buyer uploads still work.  
5. Regression risk: Medium (upload breakage if path shape differs)  
6. Tests: cross-user upload denied; same-user upload OK  
7. Acceptance: User A cannot write under User B prefix  

### P1-A2 - Campaign deep-link picker (AUDIT-007)

1. Defects: AUDIT-007 (interacts with AUDIT-001 for `/offers`)  
2. Root cause: Stale `SCREEN_OPTIONS` vs HashRouter  
3. Files: `src/components/admin/campaign/CampaignDeepLinkPicker.tsx`, campaign send path if it persists raw paths  
4. Implementation: Options → `/`, `/community`, `/book`, `/services`, `/orders`, `/profile`, plus store/product; remap legacy `/home`→`/`, `/bulletin`→`/community`, drop `/marketplace`/`/offers` or redirect  
5. Tests: picker contract + send payload snapshot  
6. Acceptance: Admin cannot select a path that 404s or lands on wrong tab  

### P1-B - Sub-1s shell loads (AUDIT-002) - **your performance ask**

1. Defects: AUDIT-002  
2. Evidence: Marketplace waterfall  
3. Files likely: `useMarketplaceData.ts`, sellers/products RPCs, `CommerceModePage`, `HomePage`/`MarketplaceSection`, Orders/Profile query shaping, optional edge RPC  
4. Implementation steps:  
   - Measure baseline TTU (web + Android).  
   - Merge seller enrichment into sellers RPC (remove third round-trip).  
   - Parallelise where still needed; raise staleTime for stable society marketplace.  
   - Keep lazy tabs but ensure prefetch completes &lt;1s after home paint on native.  
   - Orders/Account: audit queries for over-fetch; skeleton first paint.  
5. Regression risk: Medium (marketplace correctness)  
6. Dependencies: RPC deploy if schema/RPC changes  
7. Tests: marketplace mapping unit tests; optional Playwright timing budget  
8. Acceptance: Documented median TTU &lt;1s for five shell destinations with warm cache; no functional regression in cart/order  
9. Rollback: Feature-flag enrichment RPC  

### P2 - Auth, schedule, notification path (AUDIT-003, AUDIT-004, AUDIT-008, AUDIT-009, AUDIT-012)

- Protect `/seller/orders/:id`.  
- Refine pending deep-link consume for public routes; preserve `returnTo` on session expiry.  
- Block Place Order when optional schedule is on without a valid slot.  
- Ignore vague `reference_path` values for order/chat types.  
- Tests: ProtectedRoute parity; schedule gate; pickNotificationRoute vague path.

### P3 - Promotion default, images, hygiene (AUDIT-005, AUDIT-010, AUDIT-006)

- Align promotion fallback to `/`.  
- Image error → placeholder, not blank.  
- Split/commit discovery UI separately from perf/deeplink fixes after approval.

---

## 14. Regression test plan (post-approval)

| ID | Scenario |
| --- | --- |
| R1 | `resolveDeepLinkPath` for explore/book/services/share product/store |
| R2 | Unknown segment does not hijack to `/orders` |
| R3 | Marketplace snapshot still maps rating/reviews/prep correctly after RPC merge |
| R4 | Book/Contact mode filters still resolve actions |
| R5 | Orders list + order detail auth redirect |
| R6 | Promotion pickNotificationRoute default `/` |
| R7 | Focused Vitest suites: guest-location, guided-discovery, notification-routes, share |
| R8 | Manual device: App Link dinner hub, product share, seller order push tap |

---

## 15. Explicit limitations and areas not inspected

- No physical iOS/Android session this pass (push sound, App Link live verify, WhatsApp send).  
- No paid Razorpay sandbox order / refund / inventory mutation.  
- No full Vitest (2605) re-run; only 41 focused tests.  
- No Supabase RLS advisor dump / SQL policy proof for orders.  
- No exhaustive UI clipping pass on admin/society/workforce.  
- Production deploy SHA vs local dirty tree may differ; findings about GuidedDiscovery polish apply to local work-in-progress, not necessarily live `sociva.in`.  
- Inventory: [Inventory routes and features](446a4090-1711-426e-a908-368f0598e6ba).  
- Silent-defect static scan: [Scan silent defect risks](6c59d044-9946-4194-a2f6-7e8b9c5eb08e) - findings 1–8 merged/verified against source above.  
- Cross-user `app-images` upload and sandbox scheduled-vs-instant place still need live verification.

---

## Wait state

**No application source, schema, or production settings were modified for remediation.**  
Only this audit document was created/updated.

Awaiting your explicit approval to start P1-A (deep links) and/or P1-B (&lt;1s shell performance) in sequence.
