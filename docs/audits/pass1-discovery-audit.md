# Sociva Independent Audit - Pass 1 Discovery Report

**Date:** 2026-11-01  
**Scope:** Pass 1 Discovery only (read-only). No application code changes.  
**Release recommendation:** **INSUFFICIENT EVIDENCE**

Interactive summary: open canvas `sociva-pass1-discovery-audit.canvas.tsx` beside chat.

---

## 1. Executive summary

Sociva is a substantial Capacitor + React + Supabase marketplace with OTP auth, multi-rail payments, queue-based push, and broad buyer/seller surfaces. Pass 1 inspected source, ran focused Vitest, queried production settings read-only, and attempted Playwright.

**Critical constraints on this pass:**

- No Android/iOS device or emulator session.
- Playwright default `BASE_URL` is `https://sociva.lovable.app` (remote), not this workspace build.
- Payment and seller push journeys were not executed end-to-end here.

**Verdict:** Do not treat a green local unit subset as marketplace rollout readiness. Recent UX unit contracts are healthy. Operational and E2E gaps block a READY call.

---

## 2. Architecture findings

| Area | Evidence | Status |
|------|----------|--------|
| Frontend | React 18.3, Vite 8, HashRouter (`package.json`, `App.tsx`) | Implemented not verified |
| Backend | Supabase; ~72 edge function folders | Implemented not verified |
| Auth | Supabase Auth + MSG91 OTP; no Google/Apple OAuth handlers found | Partial |
| Payments | Razorpay / UPI / COD in source + e2e payment specs | Implemented not verified |
| Push | `notification_queue`, FCM/APNs, client lifecycle | Implemented not verified |
| Native | Capacitor 8, `app.sociva.community` | Not accessible (this pass) |
| PWA | vite-plugin-pwa; disabled for native builds | Partial |
| CI/CD | Codemagic + `.github/workflows/e2e.yml` | Implemented not verified |
| Tests | ~201 unit files; 22 e2e specs | Partial coverage of journeys |
| Observability | Amplitude + optional Sentry | Partial (env-gated) |

**Reliability concern:** Production `system_settings` currently has **no** `min_supported_app_version` / android / ios keys (read-only SQL). Mandatory update gate is inert until configured.

**Security:** Pass 1 did not run a dedicated security review; do not score security.

---

## 3. Confirmed bug / evidence register

### AUD-001 - Mandatory update mins absent in production

- **Severity:** P2  
- **Confidence:** Confirmed  
- **Evidence:** SQL on project `kkzkuyhgdvyecmxtmkpy`: `system_settings` keys listed; no `min_supported_*`. `MinVersionGate` + `minimumVersionFor` treat empty minimum as non-blocking.  
- **Expected:** Ops can force outdated installs to update when mins are set.  
- **Actual:** Force-update cannot engage with current prod settings.  
- **Suggested correction:** Set mins via Platform Settings (or document intentional empty).  
- **Regression risk:** Incorrect mins can lock all users out of the app.

### AUD-002 - Soft update visible while installed version unknown

- **Severity:** P3  
- **Confidence:** Confirmed (source)  
- **Evidence:** `src/lib/app-update-policy.ts` `shouldShowSoftUpdate`: when `latest` set, native, and `installed` empty → `return true`.  
- **Suggested correction:** Return false until `App.getInfo()` resolves.  
- **Runtime flash:** Suspected; needs Pass 2 on device.

### AUD-003 - OS deny after Enable dismisses Stay in the Loop card

- **Severity:** P2  
- **Confidence:** Confirmed (source) vs product requirement that denied → Settings CTA  
- **Evidence:** `HomePushEnableCard.tsx` non-grant path calls `dismissNotifCard()` → `card_dismissed`. Card then hidden by `shouldShowHomePushEnableCard`.  
- **Expected (per UX plan):** Denied → Stay in the Loop with Open Settings.  
- **Actual:** Card dismissed; Settings path lost until `reopenNotificationAsk`.  
- **Suggested correction:** On OS deny, keep card visible with `settingsRequired` (do not write `card_dismissed`).  
- **Regression risk:** Over-prompting if deny is treated as soft defer incorrectly.

### AUD-004 - E2E expects removed guest notification copy

- **Severity:** P2 (CI / regression signal)  
- **Confidence:** Confirmed  
- **Evidence:** `e2e/tests/today/today-home-prompts.spec.ts` expects `Hear it when your order moves` / `Turn on notifications`. Grep of `src/` finds no such title string. `HomePushEnableCard` requires `hasUser`.  
- **Suggested correction:** Update E2E to Stay in the Loop signed-in flow, or restore intentional guest soft-ask if product still wants it.

### AUD-005 - Playwright Pass 1 did not validate local workspace

- **Severity:** P1 (audit integrity)  
- **Confidence:** Confirmed  
- **Evidence:** `e2e/playwright.config.ts` `BASE_URL = process.env.BASE_URL || 'https://sociva.lovable.app'`. Run result: 6 failed (Home button not found under `pretendNativeApp`), 1 flaky.  
- **Implication:** Failures do **not** prove local UX broken; passes would not prove local UX shipped.

---

## 4. Potential bug register (Suspected)

| ID | Title | Pass 2 need |
|----|-------|-------------|
| SUS-001 | Search page-scroll dismiss does not set `dismissedQuery` | Re-focus reopen behaviour |
| SUS-002 | Single `latest_version` for Android semver and iOS date builds | Cross-platform soft targeting |
| SUS-003 | Dual `markPostLoginPermissionSheet` (SIGNED_IN + OTP) | Cold login timing |

---

## 5. Regression report (recent four)

| Area | Do not disturb | Regression risk |
|------|----------------|-----------------|
| Update | Gate vs soft banner split | AUD-001/002; SUS-002 |
| Search | pointer-events-auto + geometry dismiss (unit green) | SUS-001; native WebView unverified |
| Notifications | Onboarding gate; resume refresh; seller channels | AUD-003/004; no Google/Apple |
| Onboarding | Zero `requestPermissions` in walkthrough | Post-login sheet timing on device |

---

## 6. Top 15 Product Owner recommendations

1. Align E2E + run against local/preview build  
2. Configure or document prod min versions  
3. Keep Settings CTA after OS deny  
4. Buyer typo / did-you-mean search  
5. Distinct Placed vs Accepted on order rail  
6. Reorder Playwright coverage  
7. Use `mockNetworkDropAfterPayment` in a recovery E2E  
8. Decide guest vs signed-in notification prompt  
9. Hide soft banner until version known  
10. Listing-level availability consistency  
11. Platform-specific latest_version  
12. Device checkout interrupt recovery  
13. Native permission matrix Pass 2  
14. A11y on update + notification CTAs  
15. Protect seller alert channels / payment RPCs from drive-by refactors  

---

## 7. Buyer experience scorecard (audited only)

| Journey | Score | Justification |
|---------|-------|---------------|
| OTP auth (source) | 7/10 | Implemented; local E2E not proven |
| Search contracts | 8/10 | Unit scroll fix green; typo discovery partial |
| Reorder | 8/10 | Exists in source + unit; no e2e |
| Order clarity | 6/10 | Rail collapses early statuses |
| Checkout/payment | n/a | Not executed |

## 8. Seller experience scorecard (audited only)

| Journey | Score | Justification |
|---------|-------|---------------|
| First product onboarding | 8/10 | 4-step BecomeSeller + tests |
| Availability controls | 8/10 | Pause/vacation/hours + unit |
| Order alerts / accept | n/a | No device verification |
| Wallet/payouts | n/a | Not executed |

## 9. Technical quality scorecard (tested dimensions)

| Dimension | Score | Basis |
|-----------|-------|-------|
| Testability (UX contracts) | 8/10 | 79 focused Vitest passed |
| Maintainability (permissions) | 7/10 | Central hook; UI path helper unused |
| Reliability (update ops) | 5/10 | Prod mins unset; remote E2E red |
| Security / native perf | n/a | Not tested |

---

## 10. Regression test results (executed)

| Suite | Result | Notes |
|-------|--------|-------|
| Vitest focused (8 files) | **79 passed** | update, consent, permission rules/lifecycle, cart-empty, order-progress, listing-trust, closed-store |
| Vitest home-order-strip | Harness failures | `localStorage` undefined in Node - **not** product bug |
| Playwright today-home-prompts | **6 failed**, 1 flaky | Remote Lovable; Home not found |
| Android/iOS device | **Blocked** | No session |
| Payment sandbox E2E | **Blocked** | Not run |

Prod SQL (read-only): `app_update_notices` enabled=false, latest_version=null; no min_supported_* settings keys.

---

## 11. Remediation roadmap

**Immediate (after approval):** AUD-003, AUD-004, AUD-002, document AUD-001.  
**Next release:** Typo search, order rail labels, reorder + network-drop E2E, Pass 2 native matrix.  
**Product:** Guest notification strategy; listing availability consistency; per-platform latest_version.  
**Long-term:** Wire `resolveNotificationUiPath` into UI; local CI preview gates; optional social auth.

---

## 12. Final release recommendation

**INSUFFICIENT EVIDENCE**

Buyer/seller money paths and native push were not proven on this build. Focused unit evidence for the recent UX work is positive, but remote Playwright and missing device runs prevent READY or READY WITH CONDITIONS for full marketplace rollout.

**Pass 2 gate:** Reproduce AUD-003 and search scroll on device; run Playwright against local preview; execute payment sandbox and seller alert smoke with controlled accounts.

**Pass 3:** Only after you approve specific findings for remediation.
