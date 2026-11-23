# Cleaner City B3 regression results

Date: 2026-11-01.

B3 files added:

- `supabase/migrations/20261102233000_cleaner_city_guest_booking_lock.sql`
- `supabase/rollbacks/20261102233000_cleaner_city_guest_booking_lock.rollback.sql`
- `src/test/sql/b3-harness.sql`
- `src/test/sql/b3-concurrency-runner.mjs`
- the five `docs/cleaner-city/CLEANER_CITY_B3_*.md` reports

No Book, Orders, Contact, or delivery source file was edited for this fix. `useRequestRide` was not changed. It already calls the 6-argument RPC, which now takes the lock inside the database.

## Executable concurrency suite

Command: `node src/test/sql/b3-concurrency-runner.mjs`

Database: local PostgreSQL 17.5, `ccb3` on `127.0.0.1:54329`. Not production.

| Scenario | Result |
| --- | --- |
| A two publications, same guest/date/direction | PASS, 1 active ride |
| B different dates | PASS, both succeed |
| C opposite direction | PASS, both succeed |
| D rebook after cancel | PASS, 1 active ride |
| E one seat, two guests | PASS, 1 ride, 0 seats |
| F rollback then a new request | PASS, 1 active ride |
| Control with the lock removed | PASS, 2 active rides |

Exit code 0. Full timings and ride ids are in `CLEANER_CITY_B3_CONCURRENCY_TEST_RESULTS.md`.

## TypeScript

Command: `npx tsc --noEmit -p tsconfig.json`

Exit code 0. No type errors.

## Existing Cleaner City vitest files

Command: `npx vitest run` with these files:

- `src/test/cleaner-city-phase1-remediation.test.ts`
- `src/test/cleaner-city-phase0.test.ts`
- `src/test/cleaner-city-setup-otp.test.ts`
- `src/test/cleaner-city-phase1-4.test.ts`
- `src/test/cleaner-city-unit9-12.test.ts`
- `src/test/cleaner-city-unit10-11.test.ts`
- `src/test/cleaner-city-unit3.test.ts`
- `src/test/cleaner-city-unit4.test.ts`
- `src/test/cleaner-city-routing.test.ts`
- `src/test/cleaner-city-unit6-8.test.ts`
- `src/test/cleaner-city-unit5.test.ts`
- `src/test/cleaner-city-security.test.ts`
- `src/test/cleaner-city-unit2.test.ts`

Result: PASS 113, FAIL 0.

These vitest files are static source assertions. They read SQL and UI files and check that expected strings are present. They do not open a database and they are not the proof of B3. The proof is the PostgreSQL run above.

Ride lifecycle and publication-cancellation behavior covered by those files was not rewritten. The new function keeps the same status list, the same cancel-does-not-block rule, and the same seat update. Scenario D and scenario E executed that behavior on PostgreSQL.

## Not claimed

- No production apply.
- No resident RLS penetration test (B2).
- No Resend OTP send (B1).
- No device dogfood (B5).
- No end-to-end browser booking.
- Cleaner City is not ready for pilot.
