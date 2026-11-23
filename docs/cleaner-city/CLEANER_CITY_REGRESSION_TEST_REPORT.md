# Cleaner City - Regression Test Report

**Audit date:** 2026-11-01  
**Environment:** Local Windows workspace + Supabase prod project `kkzkuyhgdvyecmxtmkpy`  
**No application code modified.**

---

## Commands executed and results

### 1. Cleaner City vitest (all 12 files)

```text
npx vitest run src/test/cleaner-city-setup-otp.test.ts src/test/cleaner-city-phase1-4.test.ts src/test/cleaner-city-phase0.test.ts src/test/cleaner-city-unit9-12.test.ts src/test/cleaner-city-unit10-11.test.ts src/test/cleaner-city-unit3.test.ts src/test/cleaner-city-unit4.test.ts src/test/cleaner-city-routing.test.ts src/test/cleaner-city-unit6-8.test.ts src/test/cleaner-city-unit5.test.ts src/test/cleaner-city-security.test.ts src/test/cleaner-city-unit2.test.ts --reporter=default
```

**Result:** PASS  
**Test Files:** 12 passed  
**Tests:** 101 passed  
**Duration:** ~10.7s  

**Nature of tests:** Almost entirely `fs.readFileSync` + `expect(content).toContain(...)` source/migration contracts. Exception: `matchCopy` / phase0 helper unit tests that execute pure TS helpers. **Zero RPC, RLS, edge HTTP, or UI e2e executions.**

### 2. Phase subset (earlier in audit)

```text
npx vitest run src/test/cleaner-city-phase0.test.ts src/test/cleaner-city-phase1-4.test.ts src/test/cleaner-city-unit9-12.test.ts --reporter=verbose
```

**Result:** PASS - 66 tests  

### 3. TypeScript check

```text
npx tsc --noEmit -p tsconfig.json
```

**Result:** Exit code 0. Filtered for Cleaner City paths - no matches (no Cleaner City type errors reported).

### 4. Production SQL smoke

```sql
SELECT jobname, schedule, active FROM cron.job WHERE jobname ILIKE '%cleaner%';
```

**Result:**

| jobname | schedule | active |
|---------|----------|--------|
| cleaner-city-autopilot | 15 20 * * * | true |
| cleaner-city-reminders | 10 * * * * | true |
| cleaner-city-timeouts | */15 * * * * | true |

```sql
-- table/RPC presence and seed counts
```

**Result:** waitlist/circles/emergency/meetup tables present; meetup_rows=0; circle_rows=0; `cleaner_city_leave_circle` absent; autopilot column present; expected RPCs for autopilot/waitlist/circles create-join/meeting/no_show/timeouts present.

### 5. Not executed (BLOCKED - ENVIRONMENT)

| Suite | Reason |
|-------|--------|
| Playwright / Capgo e2e for Cleaner City | No Cleaner City e2e specs found under audit |
| pgTAP / SQL RPC assertion suite | Not present in repo |
| Live RLS penetration as two users | Requires seeded dual auth sessions; not run |
| Edge function OTP send with Resend | Ops: From domain historically missing; not re-invoked this audit |
| iOS Simulator lock-screen tracking | No simulator run |
| Android background minimize | No device run |
| Codemagic iOS build this audit | Not triggered (audit-only) |
| Book / Orders / Contact full regression UI | Not automated here |
| Google Directions live API failure injection | Not run |

---

## Coverage map vs five features

| Feature area | Automated coverage today | Gap |
|--------------|--------------------------|-----|
| Autopilot | String: hooks, schedule toggle, hub drafts, cron migration text | No call to `cleaner_city_autopilot_run`; no duplicate race test |
| Matching | String: Find/Offer gates, matchCopy helper tests, routing helper | No find_matches against DB; RoutePage Bangalore not grepped |
| Waitlist / timeouts / no-show | String: hooks + UI buttons | No timeout clock simulation; no waitlist notify on cancel |
| Circles | String: create/join page | No leave (missing); no RLS invite leak test |
| Safety / SOS / tracking | String: SOS copy, BG helper export, quick phrases | No SOS fan-out assert; no BG device test |
| Security | Foundation migration strings only | No live SELECT abuse tests for coords/invite_code |

---

## Misleading green tests (audit notes)

1. **phase0/phase1-4 "never hardcodes Bangalore"** - greps Find/Offer/Ride map center; **fails to catch** `CleanerCityRoutePage.tsx` pickup default `12.9716, 77.5946`.
2. **phase1-4 "documents background location"** - asserts helper name + copy, not that background tracking works.
3. **phase1-4 SOS explainer** - asserts marketing of contact notify; UI cannot link `notify_user_id`.
4. **security.test** - does not assert coordinate column exposure after Unit 5.

Passing 101/101 does **not** mean the five features are complete.

---

## Five-feature scenario suite status

Of the mandatory scenario lists in the audit brief:

| Bucket | Executed end-to-end? |
|--------|----------------------|
| Autopilot scenarios (WFH, pause, double cron, etc.) | NO - static reasoning only |
| Matching scenarios (opposite direction, Maps failure, etc.) | NO |
| Reliability scenarios (cancel 30/5 min, race seat claim) | NO |
| Circles scenarios | NO |
| Pocket-Safe device scenarios | NO - BLOCKED |

**Percentage of the full five-feature test suite that passed:**  
There is no executable five-feature scenario suite. Proxy metric:

- Available Cleaner City vitest: **101/101 passed (100%)** but these are contract tests, not the audit scenario suite.
- Audit scenario suite: **0% executed** → treat as **0% of required scenarios verified**.

Recommended reporting line for executives: **Contract tests 100% green; functional/scenario verification ~0%.**

---

## Recommended tests to add (do not add in this audit unless approved)

1. pgTAP or SQL integration: autopilot idempotency under concurrent invoke  
2. RLS tests: publications lat leak; circles invite_code leak  
3. RPC: publish with null coords must fail  
4. Waitlist notify after cancel_ride seat free  
5. SOS with phone-only contact must not claim success for contact notify  
6. RoutePage must not write Bangalore when template has lat/lng  
7. Device: lock screen + Maps switch during active ride  
8. Dual-guest race on same seat  

---

## Non-Cleaner City regression (static)

| Area | Static check | Runtime |
|------|--------------|---------|
| Book tab route | Still `/book` CommerceModePage | BLOCKED |
| Cleaner City routes | Isolated under `/cleaner-city` | BLOCKED |
| Delivery BG hook | Unrelated import graph | BLOCKED |
| tsc | Green | Done |
