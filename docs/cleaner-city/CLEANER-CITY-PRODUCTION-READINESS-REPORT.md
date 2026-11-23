# Cleaner City - Production Readiness Report

**Audit ID:** CC-UX-PROD-20261110  
**Decision:** **NOT PRODUCTION READY**  
**UTC / local stamp:** 2026-11-10T14:13:52Z / 2026-11-10 19:43 IST  
**Git HEAD (committed):** `c1dadd0d2098377a4b684165e5ea4192a1dff1e5` (`main`)  
**Workspace note:** Large **uncommitted** Cleaner City UX redesign vs `origin/main`. Production www is **not** identical to this tree.  
**Environments:** Local Vite `http://127.0.0.1:5188` (browser UI) + Supabase project `kkzkuyhgdvyecmxtmkpy` (SQL/schema/edge inventory).  
**Safety:** Mockup preview (`?mockup=1`) used for layout compare only. No real SOS blast, no real Razorpay charge, no destructive production writes.

---

## Executive summary

| Metric | Value |
|--------|------:|
| Features inventoried | 42 |
| Features exercised this run (UI and/or automated) | 28 |
| Automated Cleaner City vitest | **221 / 221 PASS** (after redesign regression fixes) |
| Dual-account live host/guest lifecycle E2E | **NOT TESTED** (blocked: no second authenticated resident session this run) |
| Device push / locked / killed app | **NOT TESTED** |
| Android / iOS device | **NOT TESTED** (browser only) |
| Critical defects remaining | 0 newly introduced security blockers confirmed; **multiple HIGH product blockers remain** |
| Defects found this run | 12 |
| Defects fixed this run | 9 (UI honesty / match card / Find swap / test IA drift) |
| Defects remaining open | 3+ HIGH product/ops (orphaned YourRidesBoard, dual-account E2E gap, push/device) |

**Release decision:** **NOT PRODUCTION READY** for resident pilot or public launch.

**Why not “with conditions” as the primary label:** Mandatory acceptance items from the audit brief (host/guest OTP lifecycle on real accounts, seat concurrency retest, push delivery, unauthorized access with two JWTs) were **not** completed with PASS evidence in this run. Prior audits already documented CONDITIONAL GO for limited pilot scopes; this redesign audit **does not upgrade** that status.

Internal UI dogfood of the redesign on local builds is acceptable **only** with mockup flag off for live RPC checks and with known orphaned surfaces documented below.

---

## Feature inventory (condensed)

| Feature | Previous | Current redesign | Audit status |
|---------|----------|------------------|--------------|
| Auth / work-email setup | Existing | Still gates Home/Find | PARTIAL (setup not re-OTP’d this run) |
| Find a seat | Existing | Restyled + swap control | PASS UI (mockup + swap); live match inventory depends on pins |
| Offer a seat | Multi-tab host flow | Same RPCs; mockup header | PARTIAL (UI only this run) |
| Matching | Corridor RPCs | Unchanged backend | NOT RETESTED live this run |
| Booking request/accept | RPCs | Wired on Home/Find/Match/Ride | NOT TESTED dual-account |
| Trip OTP lifecycle | Server-owned | Ride hero + OTP + quick actions | NOT TESTED live OTP |
| My rides | YourRidesBoard HOPR | Filter chips page | **HIGH regression risk** (board orphaned) |
| Profile hub | Existing | Restyled list | PASS UI structure |
| Safety / SOS honesty | Existing | Restyled; 112 dialer honesty restored | PARTIAL (no live SOS) |
| Fuel / Razorpay | Edges present | UI paths remain | NOT TESTED (no real money) |
| Notifications | Queue/edge | Unchanged | NOT TESTED device delivery |
| Circles / chat | Tables + RLS on | Pages mounted | PARTIAL (no dual-user chat) |
| Share token | Existing | Still public route | NOT RETESTED |
| Match details | New | `/cleaner-city/match` | PASS UI (mockup navigation) |
| Discover | Browse UI | Redirect only | Intentional IA change |
| Mockup seed | New | `?mockup=1` overlay | PASS (static preview only) |
| Find direction swap | Missing | Arrow control | **PASS** (browser evidence) |

Full matrix: `CLEANER-CITY-FUNCTIONAL-TEST-MATRIX.md`.

---

## What was fixed this run

1. Find pickup/destination **swap** control.  
2. Match card: seats a11y string, plate, stars, Why this ride, reason chips, mid-route badge.  
3. Ride OTP honesty copy; Safety “not a 112 dialer”.  
4. Find: pickup-code CTA, emergency tip, empty/missing-pin honesty.  
5. Route/Vehicle honesty strings; hub testids re-homed to Home.  
6. Vitest suite restored to **221/221**.

Details: `CLEANER-CITY-REGRESSION-DEFECT-LOG.md`.

---

## Hard blockers before PRODUCTION READY

1. **Commit + deploy** redesign intentionally; do not ship dirty tree by accident.  
2. **Dual-identity E2E** (host + guest) through publish → request → accept → OTP → start → complete on non-production fixtures.  
3. Restore or deliberately replace **YourRidesBoard** Going/Not Going / ensure-host behaviours with equivalent reachable UI.  
4. Device evidence for **push** (background/closed) and Android commute tracking.  
5. Reconfirm seat **concurrency** and RLS A/B outsider JWT on current schema.  
6. Confirm SOS SMS / relay call ops config honestly in UI when missing.

---

## Environment evidence

| Item | Value |
|------|-------|
| Browser | Cursor IDE browser / Chromium automation against `127.0.0.1:5188` |
| Backend | Sociva prod project `kkzkuyhgdvyecmxtmkpy` (read-only inventory) |
| RPCs `cleaner_city_%` | 153 |
| Meetup points | 3 (improved vs earlier “0” audits) |
| Feature flag | `platform_features.cleaner_city` active, society-gated |
| Edge (CC) | `cleaner-city-work-email-otp`, `dispatch-alerts`, `fuel-order`, `confirm-fuel`, `settle-fuel` ACTIVE |
| Vitest | `npx vitest run src/test/cleaner-city` → 36 files, 221 tests PASS |
| Screenshots | `qa-evidence/cleaner-city-audit-20261110/` (+ IDE screenshot find-swap) |

---

## Release recommendation

### NOT PRODUCTION READY

Do **not** declare the redesigned Cleaner City ready for resident pilot or public release on the strength of this audit. Automated contracts are green again after redesign drift fixes, and key UI shells render, but mandatory live dual-user lifecycle, device push, and orphaned host-board functionality remain unverified or incomplete.
