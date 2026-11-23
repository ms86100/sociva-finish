# Cleaner City B3 root cause

Status of this defect in the repository: fixed by `supabase/migrations/20261102233000_cleaner_city_guest_booking_lock.sql` and executably verified on a local PostgreSQL 17.5 cluster.

Status in production (`kkzkuyhgdvyecmxtmkpy`): unchanged. This migration was not applied. The live function still has no guest-level lock.

Cleaner City is not ready for pilot. This document covers B3 only.

## What fails

`cleaner_city_request_ride` locks the requested publication with `SELECT ... FOR UPDATE`. It then checks the guest's existing rides with `EXISTS`. Two requests for the same guest, travel date, and direction, aimed at two different publications, lock two different rows. Both transactions can pass the `EXISTS` check before either inserts. The guest can end up with two active rides for one date and direction.

The host unique index `uq_commute_publications_host_date_dir_active` covers `(host_user_id, travel_date, direction)` for draft, published, and full publications. It does not cover guests.

`public.rides` has no `direction` column. Direction lives on `commute_publications`. A unique index on `(guest_user_id, travel_date)` would also reject the allowed opposite-direction booking. The current schema cannot express the guest/date/direction invariant as a uniqueness constraint without a new column.

## Active booking statuses

The ride status check in `20261102090000_cleaner_city_foundation.sql` allows:

`requested`, `rejected`, `confirmed`, `pickup_pending`, `started`, `completed`, `cancelled`, `no_show`, `disputed`, `safety_incident`, `verification_failed`.

The booking `EXISTS` checks, from unit 7 through the Phase 1 function, treat only these four as active:

- `requested`
- `confirmed`
- `pickup_pending`
- `started`

These are not active for the double-book check, and this fix does not change that:

- `rejected` (host decline and request expiry)
- `cancelled` (guest cancel, publication cancel cascade)
- `completed`
- `no_show`
- `disputed`
- `safety_incident`
- `verification_failed`

A cancelled ride therefore does not block a later booking for the same date and direction. That is the existing policy. Scenario D confirmed it.

## Callers and insert paths

Frontend caller: `useRequestRide` in `src/hooks/queries/useCleanerCity.ts`. It calls the 6-argument RPC `cleaner_city_request_ride` with `p_publication_id`, `p_note`, and the four guest pin arguments.

Overloads before this fix:

- 6-argument body in `20261102230000_cleaner_city_phase1_remediation.sql`. This is the live logic: publication `FOR UPDATE`, both `EXISTS` checks, seat decrement, insert.
- 2-argument overload in `20261102211000_cleaner_city_gaps_part2_matching_safety_circles.sql`. It only calls the 6-argument function with null pins.

`INSERT INTO public.rides` appears only inside historical and current definitions of `cleaner_city_request_ride`. No other RPC inserts a ride. The new migration replaces both overloads. The 2-argument function still only delegates.

RLS and `SECURITY DEFINER` were not weakened. The 6-argument and 2-argument functions stay `SECURITY DEFINER` with `search_path = public`. No publication or circle policy is in this migration.

## Why the old lock cannot close the race

`FOR UPDATE` serializes requests that target the same publication. It does not serialize requests that target different publications. The guest check is a plain `EXISTS`, not a lock on a shared guest/date/direction row. There was no `pg_advisory_xact_lock` in the live function (`uses_advisory=false` in the acceptance review).

A same-database control reproduced the race. With the lock function replaced by a no-op, two overlapping calls for one guest, one date, one direction, and two publications both committed. Active ride count was 2. Details are in `CLEANER_CITY_B3_CONCURRENCY_TEST_RESULTS.md`.
