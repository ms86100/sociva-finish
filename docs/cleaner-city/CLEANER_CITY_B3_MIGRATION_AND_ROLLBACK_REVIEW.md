# Cleaner City B3 migration and rollback review

## Migration

File: `supabase/migrations/20261102233000_cleaner_city_guest_booking_lock.sql`

Version `20261102233000` is new. It sorts after `20261102231000_fix_can_access_feature_feature_id.sql`. It does not rewrite `20261102230000_cleaner_city_phase1_remediation.sql` or any migration already applied to production.

It creates `cleaner_city_lock_guest_booking` and replaces both `cleaner_city_request_ride` overloads. It does not create or replace policies on `commute_publications` or `commute_circles`. It does not change coordinate visibility or invite-code visibility.

Applied to production: no.

The local verification cluster applied this file. That cluster is `ccb3` on `127.0.0.1:54329` and is not the Supabase project.

## Rollback

File: `supabase/rollbacks/20261102233000_cleaner_city_guest_booking_lock.rollback.sql`

What it does:

- Drops `cleaner_city_lock_guest_booking`.
- Restores the 6-argument `cleaner_city_request_ride` without the advisory lock.
- Leaves the 2-argument overload as a delegate to that restored function.

What it does not do:

- It does not restore the older publication `SELECT` policy.
- It does not restore the older circle `SELECT` policy.
- It does not put coordinates or invite codes back into a wider read policy.
- It does not edit RLS.

The Phase 1 rollback file `supabase/rollbacks/20261102230000_cleaner_city_phase1_remediation.rollback.sql` is a different file. It was documented as restoring weaker publication and circle `SELECT` policies. Do not run that file as part of a B3 rollback.

## Should the B3 rollback be executed?

No, unless the explicit goal is to return to the old booking race.

Executing `20261102233000_cleaner_city_guest_booking_lock.rollback.sql` is privacy-safe relative to the Phase 1 policies, and it is booking-unsafe. The local control showed that without the lock, two overlapping requests for the same guest, date, and direction both commit. After a rollback, production would be in that state again.

There is no second rollback that keeps the guest lock and also reverts something else. This migration's only behavior change is the lock. A safe "undo the lock but keep the invariant" script does not exist, because removing the lock removes the invariant.

Recommendation: do not execute the rollback. Do not execute the Phase 1 rollback either.

## Production

Wait for approval before applying `20261102233000`. Until that apply, production `cleaner_city_request_ride` still locks only the publication row.
