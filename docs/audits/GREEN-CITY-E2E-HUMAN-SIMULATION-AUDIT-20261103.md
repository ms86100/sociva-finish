# Green City E2E human-simulation audit (2026-11-03)

**Verdict: not ready for real residents on intelligent route matching.** Full dual-account UI journeys were **BLOCKED** (no authenticated resident session / phone OTP in this environment). Work-email verification was **not** bypassed. Evidence: prod SQL, live RPC definitions, Vitest, offer/match/OTP code paths, browser against `www.sociva.in`.

Canvas: `green-city-e2e-audit.canvas.tsx`

## A. Rider results

| Scenario | Status | Notes |
|---|---|---|
| A1 2-wheeler | BLOCKED / FAIL inventory | Zero non-car vehicles in prod (`vehicles.vehicle_type` = `car` only, n=6). |
| A2 4-wheeler | PARTIAL | 22 `published` commute publications exist (car). Offer UI can request Google alternatives and call `storeRoute` with polyline - **live data: only 2/22 have polyline**. |

Onboarding fields, invalid-input UX, refresh persistence: **UNVERIFIED** (auth blocked). Company-email bypass: **not used**.

## B. Passenger results

Onboarding + search UI: **BLOCKED** (unauthenticated `/cleaner-city` shows marketing landing; first load hit ErrorBoundary - screenshot `qa-evidence/green-city-e2e-20261103/prod-cleaner-city-error-boundary.png`).

Matching scenarios: see section C (algorithm + SQL probes; not live dual-account search).

## C. Route matching audit

**Function:** `public.cleaner_city_find_matches` (live).

**Settings (society):** pickup 1.5km, dest 2km, depart +/-30m, max detour 15m, min overlap 65%, `hard_route_overlap=true`.

**How it works today**

1. Filter published same date/direction/society/seats.
2. **Hard gate:** guest pickup haversine to **host origin** <= 1.5km (labeled `pickup_within_corridor`).
3. Soft: dest near host end / extra stop.
4. Haversine detour minutes vs max; overlap proxy from detour geometry.
5. Optional: `cleaner_city_polyline_overlap_pct` samples <=80 polyline points; proximity score (not along-route index / order).

**Does it use Google route geometry as primary?** No. Client may store a Google polyline; server matching does not require it. **2/22** published rows have polyline.

**SQL probe:** mid-route offset ~3.3km from a live origin -> `REJECTED_by_pickup_origin_gate`.

| Scenario | Verdict |
|---|---|
| S1 Perfect mid-route | FAIL predicted (origin gate) |
| S2 Pickup near route | FAIL predicted unless near origin |
| S3 Drop near route | PARTIAL |
| S4 Same dest, different road | FAIL risk without polyline |
| S5 Opposite direction | PARTIAL (enum only) |
| S6 Pickup after drop | NOT IMPLEMENTED |
| S7 Excessive detour | PARTIAL (haversine minutes) |
| S8 Multi-driver rank | PARTIAL (score exists; weak geometry) |

**Recommended change:** require polyline on publish; project pickup/drop onto path; enforce pickup index < drop index; configurable corridor meters + detour; use Directions via-points for detour time when online. Do not ship corridor marketing copy until GC-01/GC-02 fixed.

## D. Lifecycle / OTP

Live defs confirm:

- `cleaner_city_generate_ride_otp` - host only; hash; 30m; plaintext once.
- `cleaner_city_start_ride` - OTP check; attempt cap; clears hash.
- `cleaner_city_complete_ride` - host only; **no end OTP**.

Product brief passenger-holds-OTP vs implementation host-generates: **GC-05**. Dual-account booking/OTP start/complete E2E: **UNVERIFIED**. Ride status inventory: no_show/cancelled/disputed only in sampled statuses (no completed rows seen).

## E. Defect register (summary)

| ID | Sev | Issue |
|---|---|---|
| GC-01 | Critical | Pickup gated to host origin, not route corridor |
| GC-02 | Critical | 20/22 pubs missing polyline |
| GC-03 | High | No sequence / geographic opposite-path reject |
| GC-04 | High | No 2W vehicles in prod |
| GC-05 | High | Host-held pickup OTP |
| GC-06 | Medium | Prod cleaner-city ErrorBoundary once |
| GC-07 | Medium | No end-ride OTP; zero completed rides observed |
| GC-08 | Low | Misleading `pickup_within_corridor` reason |

## F. Feature readiness

See canvas matrix. Headline: matching **FAIL**, 2W **BLOCKED**, OTP **PARTIAL**, lifecycle E2E **UNVERIFIED**, VoIP binary **PARTIAL** (build in flight).

## G. PO recommendations

1. Fix GC-01/GC-02 before any resident launch claim of "smart matching".
2. Flip OTP so passenger receives code; host enters it.
3. Enforce polyline + Google alternatives on publish; fail closed if Maps down (or mark approximate explicitly).
4. Provide isolated **test-only** work-email verify fixture (not prod weaken) and finish device E2E.
5. Defer gamified polish until matching + OTP proof work.

## VoIP / Codemagic

- Pushed: `517cb74`, `cac09fe` (PushKit/CallKit native, Codemagic voip/audio, CallButton, livekit-client).
- `voip_runtime_config.enabled=true`.
- Build: https://codemagic.io/app/6aca798428fe2869cf7cbce4/build/6ae9dceb8ea51405368be847  
  Install that IPA for lock-screen rings. Old binaries: Call may start session without PushKit ring.

## Unit evidence

`npm run test -- src/test/cleaner-city-phase1-4.test.ts src/test/cleaner-city-trust-hardening.test.ts src/test/sociva-voip-platform.test.ts` -> **57 passed**.
