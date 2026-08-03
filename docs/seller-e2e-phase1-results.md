# Phase 1 Results — Seller Onboarding (S1)

**Date:** 2026-08-03  
**Environment:** https://www.sociva.in (production web)  
**Account:** `+910123456789` (Apple Review bypass, OTP `1234`)  
**Executor:** Seller E2E Testing Agent  

---

## Verdict

**Phase 1 functional path: PASS** for S1 Cart Kitchen (submit → `pending`).  
**Phase 1 production-quality gate: CONDITIONAL GO** — onboarding completes, but **catalog / taxonomy hygiene blockers** must be fixed before calling onboarding production-ready. Phase 2 store ops can proceed after admin approval of S1 (and subsequent stores).

---

## S1 store created

| Field | Value |
|-------|--------|
| Business | `E2E Cart Kitchen S1` |
| Seller ID | `14f41390-be21-4fa9-bd0d-f41653dd6c93` |
| Primary group | `food` (Food & Groceries — not `food_beverages`) |
| Category path | Home Food → Daily Tiffin |
| Commerce | Add to Cart → product `action_type=add_to_cart` |
| Fulfillment | Pickup + I Deliver |
| Payments | COD |
| Hours | 09:00–21:00 · 2 operating days |
| Location | Koramangala, Bengaluru (set) |
| Product | Veg Thali Combo · ₹120 · stock 20 · AI image |
| Status | Profile `pending` · Product `pending` |

---

## Test case log (executed)

| ID | Result | Evidence |
|----|--------|----------|
| P1-A02 Age gate | **PASS** | Send OTP disabled until age checkbox |
| P1-A03 Send OTP | **PASS** | Advanced to Verify OTP for `+91 0123456789` |
| P1-A04 Wrong OTP | **PASS** | Stayed on OTP after `0000`; toast ephemeral (UX note) |
| P1-A05 Correct OTP | **PASS** | Landed `/#/` as Sociva Demo User |
| P1-A07 Become Seller CTA | **PASS** | Home + Profile “Start Selling” → `/#/become-seller` |
| P1-D category select | **PASS** | Daily Tiffin specialty + seller title “Tiffin Provider” |
| P1-E store details | **PASS** | Name, desc, hours, location confirm |
| P1-F delivery/pay | **PASS** | Pickup+Deliver, COD; UPI left off |
| P1-F operating days | **PASS** | Continue blocked at 0 days; enabled after Mon/Tue |
| P1-F photos skip | **PASS** | Explicit skip allowed |
| P1-G create product | **PASS** | DB draft→pending; image required; AI Generate worked |
| P1-H declaration gate | **PASS** | Submit disabled until checkbox |
| P1-H submit | **PASS** | Success UI + DB `pending` |

---

## Production vs plan drift (critical)

Live prod onboarding is **taxonomy-first, 5 progress steps**:

`What to Sell → Store Details → Configure → Products → Review`

Configure includes: commerce model → delivery/payments → days → photos.

Repo/local plan described **intent-first 7-step**. **Do not use the 7-step plan as live UI map** until that code is deployed. Soft tags (rental/appointment/digital) were **not** visible on this Configure commerce screen.

Commerce options live: **Add to Cart · Book Now · Contact Seller · Make an Offer** (Enquire maps to “Make an Offer”).

---

## UX / quality defects (Phase 1)

| ID | Severity | Finding | Recommendation |
|----|----------|---------|----------------|
| DEF-001 | **Blocker** | Parent groups **Test** and **hello section** visible to sellers | Hide non-prod groups (`is_active=false` or filter) |
| DEF-002 | **Major** | Duplicate/overlapping groups: Food & Groceries vs Food & Beverages; Personal Care×2; Home Services×2; Classes vs Education | Consolidate or hide aliases; one clear food group |
| DEF-003 | **Major** | Home shows **Set location** / Profile 67% while profile shows unit A-101; DB `society_id` was null at plan time | Unify society + delivery location; block sell CTA until address complete if required |
| DEF-004 | **Minor** | Wrong OTP error toast disappears quickly | Persist inline error under OTP boxes |
| DEF-005 | **Minor** | “Open every day” is non-interactive copy (not a control) | Make it a real toggle button |
| DEF-006 | **Info** | Product image required; AI Generate is a good escape hatch | Keep; ensure failure messaging if AI key missing |
| DEF-007 | **Info** | Plan group `food_beverages` vs live `food` for Daily Tiffin | Update four-store matrix to use live groups |

---

## Four-store matrix (updated for live taxonomy)

| Store | Commerce UI | Live `primary_group` |
|-------|-------------|----------------------|
| S1 Cart Kitchen | Add to Cart | `food` ✅ submitted |
| S2 Bookable Studio | Book Now | `education_learning` or `classes` |
| S3 Contact Pro | Contact Seller | `professional` |
| S4 Rental Hub | Make an Offer (or Contact) | `rentals` |

---

## Next steps

1. Admin approve S1 (`14f41390-be21-4fa9-bd0d-f41653dd6c93`).  
2. Fix DEF-001 / DEF-002 before production marketing of onboarding.  
3. On your go-ahead: Phase 2 ops on S1 + onboard S2–S4.  
4. Android emulator suite after Phase 1 catalog fixes preferred (or parallel smoke).
