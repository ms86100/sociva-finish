# Green City GC-01 / GC-02 / passenger OTP fix (2026-11-03)

## Shipped

### GC-01 Corridor matching
- New `cleaner_city_project_point_on_polyline` (distance + along-route index).
- `cleaner_city_find_matches` now:
  - Requires stored route polyline
  - Gates pickup/drop by configurable corridor km to the **route**, not host origin
  - Rejects when pickup index >= drop index
  - Sets `matching_mode=polyline_corridor`
- Live probe on a published Google polyline: origin/dest ~0.6m from path; opposite ~12.4km (reject).

### GC-02 Require polyline
- `cleaner_city_publish_commute` raises if polyline missing/short.
- Offer UI refuses non-Google / empty polyline before RPC.
- Soft-cancelled **20** published rides without geometry. **2** remain published with polyline.

### Passenger-held OTP
- Guest generates OTP; host/rider enters to start.
- UI: `RidePrimaryActions`, Find hosting/guest panels, mission copy updated.

### Test-only work-email fixture
- `cleaner_city_test_verify_work_email(user_id, email)` 
- `@sociva.test` only; **not** granted to `authenticated`/`anon` (`auth_can_execute_fixture=false`).
- Probed on seed users then **restored** their `seed.*@airbus.com` verified rows (fixture rows revoked).

## Evidence
- Migrations applied via Supabase MCP (`cleaner_city_corridor_*`, `cleaner_city_passenger_otp_and_test_fixture`).
- Repo migration: `supabase/migrations/20261103170000_cleaner_city_corridor_match_otp_fixture.sql`
- Vitest: `src/test/cleaner-city-corridor-otp-fix.test.ts` - **5/5 PASS**

## Authenticated device E2E
**BLOCKED** for full dual-account phone UI this session (no resident device session / phone OTP). Backend contracts verified in SQL + unit tests. Next: sign in two devices, use fixture only on dedicated `@sociva.test` accounts (not seed Airbus users), publish with Google alternatives, search mid-corridor pickup, book, passenger OTP, host start, complete.

## Note on polyline density
One live pub only scanned **2** path points (sparse overview). Dense Google encodings are required for true mid-corridor matches; publish now rejects haversine fallback.
