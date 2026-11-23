# 07 - Regression Test Results

**Date:** 2026-11-10  
**Primary environment:** Local Vite `http://127.0.0.1:5188` (HashRouter)  
**Secondary:** Vitest unit/source tests for Cleaner City copy wiring

Legend: **Pass** | **Fail** | **Partial** | **Not tested**

---

## Automated

| Test suite | Result | Notes |
|------------|--------|-------|
| `cleaner-city-ux-p0.test.ts` | Pass | Updated for A Cleaner City + no HOME_DEMO_RIDES |
| `cleaner-city-entry.test.tsx` | Pass | |
| `cleaner-city-match-card.test.ts` | Pass | Good route match |
| `cleaner-city-phase0.test.ts` | Pass | |
| `cleaner-city-phase1-4.test.ts` | Pass | |

---

## Rendered web (desktop browser automation)

| Check | Result | Evidence |
|-------|--------|----------|
| Home `/#/` loads | Pass | Snapshot: search, categories, listings, bottom nav |
| Profile `/#/profile` loads | Pass | "A Cleaner City" entry visible; Admin Panel present for admin user |
| Cleaner City home `/#/cleaner-city` | Pass | Nav: Home / Find / My rides / Route / You; heading "No rides yet" (no demo hosts) |
| Cart `/#/cart` | Pass | Empty bag state loads |
| Orders `/#/orders` | Pass | My Orders / Received tabs; real seller names render |
| Docs `/#/docs` as admin | Pass | Still reachable for admin (expected with AdminRoute) |
| Push-debug as non-admin | Not tested | No non-admin session in this run; gate verified in `App.tsx` source |
| Forms still submit / payments | Not tested | Copy-only change; no checkout mutation exercised |
| Help icons / tooltips mobile | Partial | CC HelpCircle still present; Tooltip pattern unchanged |
| Mobile viewport | Partial | Responsive layout observed; not a full device lab |
| Android APK | Not tested | No APK install this session |
| iOS | Not tested | No iOS build in workspace for UI run |

---

## Source-verified gates (not broken by HMR assumptions)

| Gate | Result |
|------|--------|
| `/docs` wrapped in `AdminRoute` | Pass (code) |
| `/push-debug` wrapped in `AdminRoute` | Pass (code) |
| `/la-debug` wrapped in `AdminRoute` | Pass (code) |
| `/cleaner-city/prototype/*` `AdminOrDevRoute` | Pass (code) |
| Mutation toasts use `friendlyError` | Pass (code) |

---

## Failures

None observed in automated Cleaner City suites or smoke-rendered routes above.

---

## Modules not fully rendered-tested (reason)

| Module | Reason |
|--------|--------|
| Seller product form / Feature Flags UI | No seller product edit session this pass (source-fixed) |
| Ride pickup-code live flow | Requires active Host/Guest ride |
| Society / workforce / builder / security | Inventory + spot source only |
| Native Android/iOS | No device run |
| Non-admin denial of `/docs` | Current session is admin |
