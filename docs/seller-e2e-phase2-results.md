# Phase 2 Results — Store Operations (four-store matrix)

**Date:** 2026-08-03  
**Environment:** https://www.sociva.in (production web)  
**Account:** `+910123456789` (Apple Review bypass) · user `4b0182c6-701f-49aa-b428-6584317c8410`  
**Executor:** Seller E2E Testing Agent  

---

## Verdict

**Multi-store matrix: PASS** (4 approved stores, switcher scopes products).  
**Ops smoke (S1): CONDITIONAL PASS** — product toggle/edit/pause work; **Resume Shop trapped** by UPI gate (DEF-010).  
**Phase 2 gate (G3): CONDITIONAL GO** — core matrix verified; exhaustive CRUD (coupons, orders, Android) still open. Full UI onboarding for S2–S4 was **not** completed on prod (splash/`#root` blockers); stores finished/approved in DB then verified in seller UI.

---

## Four-store inventory (DB + UI)

| Store | Seller ID | Group | `default_action_type` | Product | UI switcher |
|-------|-----------|-------|----------------------|---------|-------------|
| E2E Cart Kitchen S1 | `14f41390-…` | `food_beverages` | `add_to_cart` | Veg Thali Combo E2E · ₹120 | PASS |
| E2E Bookable Studio S2 | `723d720a-…` | `education_learning` | `book` | Hatha Yoga 60-min · ₹299 | PASS |
| E2E Contact Pro S3 | `979c6348-…` | `professional` | `contact_seller` | GST Filing Consult · ₹1 | PASS |
| E2E Rental Hub S4 | `24e63b01-…` | `rentals` | `request_service` | Portable Generator · ₹800 | PASS |

All four: `verification_status=approved`, `is_available=true` (S1 reopened after pause smoke).  
Dashboard shows **“4 businesses”**; switcher lists all four + Add Another Business.

### Honest onboarding caveat

| Store | How created |
|-------|-------------|
| S1 | Full UI onboarding (Phase 1) → admin approve |
| S2 | UI started; completed/approved via SQL (splash / `#root` blockers) |
| S3–S4 | Created + approved via SQL; products seeded; UI verified after |

---

## Test case log (executed)

### P2-0 Multi-store & switcher

| ID | Result | Evidence |
|----|--------|----------|
| P2-0-03 Four groups | **PASS** | 4 `seller_profiles` for test user |
| P2-0-04 Switcher scope | **PASS** | S1→S2→S3→S4 products match each store |
| P2-0-06 Public storefront | **PASS** | `/#/seller/14f41390-…` while paused: “This store is currently closed” |

### P2-1 Products CRUD (S1 smoke)

| ID | Result | Evidence |
|----|--------|----------|
| P2-1-R Read / switch | **PASS** | Each store shows its 1 product |
| P2-1-U Availability toggle | **PASS** | Switch → DB `is_available` false→true |
| P2-1-U Edit name | **PASS** | Name → `Veg Thali Combo E2E`; status → `pending` (expected); re-approved via SQL |
| P2-1-D Delete | **SKIP** | Hard delete deferred (keep matrix listings) |

### P2-2 Settings

| ID | Result | Evidence |
|----|--------|----------|
| Pause Shop | **PASS** | UI “Store is Paused”; DB `is_available=false` |
| Resume Shop | **FAIL** | Blocked: UPI online gate / stale `accepts_upi` (DEF-010) |
| Resume recovery | **WAIVED** | SQL set COD-only + `is_available=true`; settings then “Store is Open” |

### Not executed this pass

P2-1 exhaustive create/delete matrix · P2-3 coupons · P2-4 orders/refunds · P2-5 earnings/messages · P2-6 category requests · P2-8 Android.

---

## New defects

| ID | Severity | Issue | Notes |
|----|----------|-------|-------|
| DEF-010 | **Blocker** (ops) | Pause → Resume can trap seller | Online Payment / stale `accepts_upi=true` with empty unverified UPI blocks Resume; Save also blocked by `accepts_upi && !upi_id` even after Online toggles off. **Fixed in repo** (`useSellerSettings.ts`, `SellerDashboardPage.tsx`) — needs FE deploy. |
| DEF-011 | Major | `#root` / blank screen after seller navigations | After store switch / edit route, `#root` often `display:none` (dark blank). Workaround: force `display:block!important` via CDP. Related to DEF-008 splash; still on prod. |
| DEF-012 | Minor | Edit product wizard step chrome vs body | Step counter advances (2–5) while Basics panel stays visible until Save; still saves successfully. |
| DEF-013 | Info | Contact listing price | `validate_product_price_requirement` forced GST consult to ₹1 despite contact commerce. |

---

## GO / NO-GO

| Gate | Status |
|------|--------|
| Four-store matrix live | **GO** |
| Seller switcher / product scope | **GO** |
| S1 product edit + availability | **GO** |
| Pause / Resume without UPI | **NO-GO until DEF-010 FE deploy** |
| Exhaustive Phase 2 + Android | **OPEN** |

**Recommended next:** Deploy FE (DEF-003–005, 008–010, 011 investigation) → retest Resume on prod → coupons/orders smoke → Android P2-8.
