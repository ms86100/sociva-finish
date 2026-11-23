# Cleaner City - Phase 1 Regression Results

**Date:** 2026-11-01

---

## Commands executed

### 1. Vitest - Phase remediation focus

```text
npx vitest run src/test/cleaner-city-phase0.test.ts src/test/cleaner-city-phase1-4.test.ts src/test/cleaner-city-phase1-remediation.test.ts --reporter=default
```

**Result:** PASS - 3 files, **73** tests

### 2. Vitest - Full Cleaner City suite

```text
npx vitest run src/test/cleaner-city-*.test.ts (13 explicit files including phase1-remediation)
```

**Result:** PASS - 13 files, **113** tests  
(Previous audit baseline was 101; +12 remediation tests)

### 3. Production privacy selftest

```sql
SELECT public.cleaner_city_phase1_privacy_selftest();
```

**Actual output:**

```json
{
  "leave_circle_rpc": true,
  "publish_pin_guard": true,
  "invite_expires_column": true,
  "circles_read_members_only": true,
  "unique_active_publication_index": true,
  "publications_select_blocks_society_peers": true
}
```

### 4. TypeScript

Not re-run as a dedicated gate this report; prior Phase sessions were green. Recommend `npx tsc --noEmit` before release cut.

---

## Scenario matrix

| Required scenario | Status | Notes |
|-------------------|--------|-------|
| RLS coordinate access | PARTIAL VERIFY | Policy + selftest verified; dual JWT live SELECT BLOCKED |
| Circle invite-code access | PARTIAL VERIFY | Policy + RPC verified; 3-account live BLOCKED |
| Publish pin validation | PARTIAL VERIFY | Function body + selftest; authenticated RPC fixture BLOCKED |
| RoutePage saved coords | CODE VERIFY | Source proof + vitest; device UI BLOCKED |
| SOS fan-out | PARTIAL VERIFY | Function returns counts; live notify delivery BLOCKED |
| Publication cancel guests | CODE VERIFY | SQL cascade present; multi-guest live BLOCKED |
| Waitlist on seat release | CODE VERIFY | Helper wired; live waitlist notify BLOCKED |
| Blocked-user exclusion | CODE VERIFY | SQL present |
| Autopilot duplicate concurrency | PARTIAL | Unique index present; stress test not run |
| Work-email revocation | CODE VERIFY | Filter in autopilot_run |
| Cross-publication double-book | CODE VERIFY | RPC guard |
| Society isolation | PARTIAL | Circles join gate; broader suite BLOCKED |
| Ride location auth | UNCHANGED | Prior unit9 contracts still pass |
| Book/Contact/Orders/delivery | STATIC | Routes unchanged; no e2e this phase |

---

## BLOCKED (environment)

- Dual/triple authenticated Supabase sessions for live RLS penetration  
- Device lock-screen / Maps switch / iOS+Android background GPS  
- Resend/SMS provider failure injection  
- Concurrent cron/manual autopilot race under load  

Never mark these as passed.
