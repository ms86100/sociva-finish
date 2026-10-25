# Sociva complete E2E regression audit

Date: 2026-10-26 (IST)
Authority: Master directive (complete E2E audit, remediation, GitHub push, web deploy, Codemagic iOS)

## Executive summary

| Gate | Status |
| --- | --- |
| Closed-store multi-size cart UX | **PASS** (browser + Vitest + live JS) |
| GitHub `main` | **PASS** at `d635741` |
| `sociva.in` production deploy | **PASS** (Vercel Ready `dpl_BkLYSUPxQK7qsdLx4oPTnMNpsxDc`) |
| Codemagic iOS | **PASS** build `#26` / `6ade5b79a8d27c51f44cdbc0` (App.ipa produced) |
| Paid instant / scheduled / pre-order place | **BLOCKED** (no live paid orders) |
| Device push matrix (killed app sound) | **NOT TESTED** |
| App Store / Play release verdict | **CONDITIONAL GO for web + IPA artifact; NO-GO for store submission** until paid sandbox + device notify gates |

This document does **not** claim 100% feature coverage. Unexecuted cases stay `NOT TESTED` or `BLOCKED`.

Companion detail: `docs/audits/SOCIVA-E2E-REGRESSION-AUDIT.md` (earlier matrix). This file is the master release record for the closed-store size-sheet remediation and the subsequent sync/deploy/build.

---

## 1. Baseline

| Item | Value |
| --- | --- |
| Repo | `https://github.com/ms86100/sociva-finish.git` |
| Branch | `main` |
| Local HEAD | `d635741e500ef0fb8045b09d3d2ad1f6c9ee12b3` |
| `origin/main` | identical SHA |
| Working tree | Product source clean. Local-only leftovers: `.env`, `.claude/settings.local.json`, `supabase/config.toml`, `.tmp-*`, ads/artifacts (not committed) |
| App under test | Local `http://localhost:3000` + production `https://www.sociva.in` |
| Supabase | Production `kkzkuyhgdvyecmxtmkpy` |
| Payment | No live charges. No sandbox checkout this pass |
| Mobile devices | No physical device / emulator for push sound this pass |
| Authored store | Biryani and Kebab `95d88378-b998-4f9b-b3f6-ff788aa2b81f` (settings not changed this release wave) |

### Baseline commands (this wave)

| Command | Result |
| --- | --- |
| Focused Vitest (closed-store, schedule, empty cart, placeholders, guided discovery, selling-well) | **71 passed** / 7 files |
| `seller-manual-complete.test.ts` | **13 passed** (live RPC cases skipped: integration users not seeded) |
| `npx tsc --noEmit` | **PASS** (0 errors) |
| `npm run build` | **PASS** |
| Full `npx vitest run` | Prior audit: 2590 passed, 326 skipped. Not fully re-run this wave after `d635741` |
| Playwright `test:e2e` | **NOT TESTED** this wave |

---

## 2. Phase 2 - Closed-store multi-size cart (primary defect)

### Symptom

Toast said the item was in cart while size rows still showed **ADD**, no steppers, buyer stuck in modal with no clear schedule path.

### Root cause

1. Silent `addItem(..., true)` + floating schedule toast left the size sheet visually unchanged.
2. Sheet did not own optimistic qty / schedule CTA.
3. Stuck per-line add locks could make later taps fail with no UI change until reload.

### Fix (shipped)

| File | Change |
| --- | --- |
| `src/components/product/VariantPickerSheet.tsx` | Optimistic qty steppers; closed-store banner; in-sheet schedule hint; **Schedule in cart** primary CTA; **Keep browsing this store** |
| `src/hooks/useCart.tsx` | Silent closed-store adds skip confusing toast; add-lock TTL so hung requests cannot block forever |
| `src/lib/store-schedule.ts` | `formatClosedStoreAddPopupCopy` rewritten for multi-size + cart scheduling |
| `src/test/closed-store-schedule.test.ts` / `store-schedule.test.ts` | Regression contracts |

### Required UX verification

| Case | Result | Evidence |
| --- | --- | --- |
| CS01 Closed store opens size sheet with schedule guidance | PASS | Banner: store closed; add sizes here; pick time in cart/checkout |
| CS02 First ADD flips row to `[−] N [+]` | PASS | Amla Pickle 250 g stepper |
| CS03 Increase same size | PASS | 250 g -> qty 2; line total ₹370 |
| CS04 Add second size | PASS | 500 g qty 1; footer `Schedule in cart - 3 items - ₹720` |
| CS05 Cart CTA navigates to `/cart` | PASS | `http://localhost:3000/#/cart` with Amla + schedule copy |
| CS06 DB cart lines | PASS | `cart_items`: 250 g×2, 500 g×1 for product `8fffea57-5ddf-4d29-b442-d9a6c26f2835` |
| CS07 Live production JS contains new copy | PASS | `VariantPickerSheet-*.js` on sociva.in contains `Schedule in cart` / `Keep browsing this store` |
| CS08 Open-store instant path | NOT REGRESSED (code path preserved; open-store paid place BLOCKED) | |
| CS09 Production guest UI walk of Amla | NOT TESTED | Production session landed on marketing `#/landing` without society session in automation |

### Regression tests

Focused schedule suites: **71 PASS** including closed-store contracts requiring `Schedule in cart`, `needsSchedule`, and popup copy shape.

---

## 3. Feature inventory (executed this wave + prior audit)

Result key: PASS / FAIL / BLOCKED / NOT TESTED.

Counts below merge prior audit matrix with this wave. Do not treat as coverage %.

| Domain | PASS | FAIL | BLOCKED | NOT TESTED |
| --- | --- | --- | --- | --- |
| Buyer discovery / search / cart UI (prior + CS*) | 35+ | 0 open in executed | several paid | guest/native |
| Instant paid lifecycle | 0 | 0 | all paid steps | - |
| Scheduled paid lifecycle | cart/UI only | 0 | paid + notify | - |
| Pre-order | 0 | 0 | - | all |
| Multi-vendor | 0 | 0 | - | all |
| Book / Contact submit | UI only | 0 | - | submit |
| Payments | 0 | 0 | live forbidden | sandbox |
| Seller board / Action needed | prior PASS | 0 | - | accept/reject live |
| Admin | 0 | 0 | - | panel |
| Notifications device matrix | server accept prior | 0 | - | device |
| Seller complete without OTP | contracts PASS | 0 | live RPC seed | - |

Prior open P3 (₹1 Book placeholders) was addressed in `8516109` via marketplace description + `isPlaceholderBookListing` (see prior audit remediations). Live catalogue re-sweep **NOT TESTED** this wave.

---

## 4. Order lifecycle

| Mode | Result | Notes |
| --- | --- | --- |
| Instant | BLOCKED | Would create real orders / charges |
| Scheduled | PARTIAL PASS | Closed-store multi-size add + cart schedule path PASS. Paid place BLOCKED |
| Pre-order | NOT TESTED | Biryani/Kebab `accepts_preorders=false`; no other listing forced |
| Multi-vendor | NOT TESTED | |
| Seller complete without OTP | PARTIAL | Unit/contract PASS. Live RPC needs `seed-integration-test-users` |

Biryani and Kebab: inspected earlier; **settings not changed** this wave. Snapshot: `docs/audits/biryani-kebab-settings-snapshot-2026-10-26.json`.

---

## 5. Notifications

| Layer | Result |
| --- | --- |
| Code / channel / PNQ architecture | Documented in prior notification audits |
| PNQ last-24h accept (prior) | Observed processed rows |
| Android/iOS killed-app audible delivery | **NOT TESTED** this wave |
| Codemagic IPA includes push entitlements | Build scripts succeeded; device proof still required |

---

## 6. Defects fixed in this release lineage

| Sev | Defect | Fix commits |
| --- | --- | --- |
| P1 | Closed-store size sheet ADD stuck / buyer lost | `5ddd721` |
| P1 | GuidedDiscovery modules missing from git (CI build fail) | `d635741` |
| P2 | Search overlay swallow first tap; cart vanish on seller; Action needed overdue; dual Clear | `8516109` |
| P2 | Empty cart UX; Book placeholders | `8516109` |

No new P0 observed in executed web paths.

---

## 7. Release pipeline

### GitHub

| Step | Result |
| --- | --- |
| Commit closed-store size sheet | `5ddd721` |
| Commit guided discovery + local product sync | `d635741` |
| Push `main` | SUCCESS (`origin/main` == local) |

### sociva.in

| Step | Result |
| --- | --- |
| Mechanism | Vercel project `sociva-finish`, team scope, `--prod` |
| Deployment | `dpl_BkLYSUPxQK7qsdLx4oPTnMNpsxDc` Ready |
| Alias | `https://sociva.in` / `https://www.sociva.in` |
| Smoke | Landing loads; production JS includes closed-store size-sheet strings |
| Auth marketplace smoke | BLOCKED in automation (landing without society session) |

### Codemagic iOS

| Step | Result |
| --- | --- |
| App | `6aca798428fe2869cf7cbce4` (sociva-finish) |
| Workflow | `ios-release` |
| Branch | `main` |
| Build | `#26` / `6ade5b79a8d27c51f44cdbc0` |
| Web build step | **SUCCESS** (GuidedDiscovery resolve fixed) |
| Final | **SUCCESS** - App.ipa artifact (~18 MB) |
| TestFlight / App Store submit | **NOT AUTHORISED / NOT DONE** |

Earlier failed build was due to missing `GuidedDiscoveryOverlayTile` on remote only; fixed by `d635741`.

---

## 8. Test data and cleanup

| Record | Status |
| --- | --- |
| Amla Pickle cart lines (250 g×2, 500 g×1) for buyer `f28747e8-...` | Left in cart after retest; no order placed. Clear manually if unwanted |
| Biryani and Kebab settings | Unchanged |
| Payments / refunds | None |
| Push blasts | None |

---

## 9. Remaining blockers (honest)

1. **Paid sandbox E2E** for instant + scheduled (and optionally pre-order) with DB + seller board + PNQ asserts.
2. **Device notification matrix** (Android + iOS, killed app, sound, navigate-to-order).
3. **Integration user seed** for live `seller_complete_order_without_otp` RPC tests.
4. **Full Vitest re-run** after `d635741` (focused suites green; full suite not re-executed this wave).
5. **Playwright smoke** on production authenticated session.

Until (1) and (2) are evidence-backed, do **not** treat the product as App Store / Play regression-free.

---

## 10. Final summary

- **Code:** Closed-store size steppers + schedule-in-cart; guided discovery sync; prior cart/search/schedule remediations. SHA `d635741`.
- **Regression:** Focused suites 71 PASS; OTP contracts 13 PASS; tsc PASS; vite build PASS.
- **Closed-store cart:** Multi-size qty + schedule CTA PASS locally; live JS PASS.
- **Ordering:** Instant/scheduled/pre-order paid E2E BLOCKED / NOT TESTED.
- **Notifications:** Device matrix NOT TESTED.
- **GitHub:** Pushed to `main`.
- **sociva.in:** Deployed Ready.
- **Codemagic:** Build `#26` SUCCESS with App.ipa.
- **Outstanding:** Paid sandbox lifecycle, device push proof, integration seed users, full suite re-run.
