---
name: seller-e2e-testing
description: >-
  Run Sociva seller end-to-end production readiness testing through the real UI.
  Use when the user asks to run seller E2E tests, seller onboarding audit, store CRUD
  audit, multi-store listing model tests, Phase 1/Phase 2 seller testing, or invokes
  the seller testing agent.
---

# Sociva Seller E2E Testing Agent

## When invoked

1. Read `docs/seller-e2e-test-plan.md` in the workspace (source of truth for cases).
2. Do **not** skip Phase gates. Default start = Phase 1 unless user explicitly continues Phase 2.
3. Drive the app **as a human** via Cursor browser tools (web) or Android emulator after the plan’s Android gate. Prefer UI over SQL/API. Use SQL only to **verify** integrity after UI actions or for admin approval when no seller UI exists.
4. Log every result with evidence (screenshot path, URL, toast text, DB assertion).

## Credentials (iOS / Apple Review bypass)

| Field | Value |
|-------|--------|
| Phone | `0123456789` |
| OTP | `1234` |
| Country | `+91` / send `country_code: '91'` |
| Login | `/#/auth` (HashRouter) |

Never invent other OTPs for this phone. If bypass fails, stop and report MSG91 / edge function issue.

## Four-store matrix (one seller account)

| Store | Commerce | Group | Intent seed |
|-------|----------|-------|-------------|
| S1 Cart Kitchen | `cart` / `add_to_cart` | `food_beverages` | Home-cooked tiffin |
| S2 Bookable Studio | `book` / `book` | `education_learning` | Yoga classes |
| S3 Contact Pro | `contact` / `contact_seller` | `professional` | Tax filing help |
| S4 Rental Hub | soft tag `rental` → enquire | `rentals` | Generator rental |

`UNIQUE(user_id, primary_group)` — never reuse a group. Fallbacks documented in the test plan.

## Journey spine

1. `/#/auth` → OTP → society if required  
2. `/#/become-seller` steps 1→7 (intent → commerce → category → store → configure → products → review)  
3. Admin approve (`approveSeller` / admin UI) — seller **cannot** self-approve  
4. `/#/seller` go-live, products, settings, tools  
5. SellerSwitcher → Add Business → repeat for S2–S4  

## Hard rules

- Hash routes only (`/#/seller`, not `/seller` alone in browser URL bar assumptions).
- Products: **hard delete** (no soft restore). Pause store via `is_available`.
- False success toasts without DB write = **FAIL**.
- Document UX friction in Phase 1 with severity + recommendation before calling Phase 1 production-quality.
- After Phase 1 gate pass, run Android emulator suite from the plan (`P2-8`).
- Do not commit, push, or change production schema unless the user asks.

## Evidence & defect format

Use the defect template in `docs/seller-e2e-test-plan.md`. Maintain a running results checklist in chat:

`[PASS|FAIL|BLOCKED] TC-ID — one-line — evidence`

## Platforms

1. **Web (Cursor browser):** `https://www.sociva.in/#/auth` (or local Vite if user specifies).  
2. **Android:** After Phase 1 gate — emulator + Capacitor/APK; re-run auth + onboarding smoke + native edges (keyboard, image picker, safe-area).

## Completion

End with: Phase status, open blockers, four-store status table, and whether production readiness is **GO / NO-GO**.
