# Cleaner City B3 atomic fix

Migration: `supabase/migrations/20261102233000_cleaner_city_guest_booking_lock.sql`

Not applied to production.

## Mechanism

`cleaner_city_lock_guest_booking(guest, travel_date, direction)` takes one transaction-scoped advisory lock:

```sql
v_key := hashtextextended(
  'cc-guest-booking|' || p_guest::text || '|' || p_travel_date::text || '|' || p_direction,
  0
);
PERFORM pg_advisory_xact_lock(v_key);
```

The key does not include the publication id. Every request for the same guest, date, and direction, including requests aimed at different hosts, hashes to the same key and must take the same lock.

`pg_advisory_xact_lock` is held until the current transaction commits or rolls back. There is no session-level lock and no row left behind. A failed statement that aborts the transaction releases it. Scenario F confirmed a later booking proceeds after `ROLLBACK`.

The prefix `cc-guest-booking|` keeps this key distinct from other advisory locks in the product, such as wallet locks. A 64-bit hash collision would make two unrelated guest/date/direction triples wait on each other. It cannot let two requests with the same triple both pass the check. A collision adds waiting. It does not open a second booking.

## Where the lock sits

Inside the 6-argument `cleaner_city_request_ride`, after the publication `FOR UPDATE` and the open/self/seat/pin checks, and before both `EXISTS` checks:

1. Rate-limit count.
2. `SELECT` the publication `FOR UPDATE`.
3. Reject missing, unpublished, self-request, empty seats, or missing pins.
4. `PERFORM cleaner_city_lock_guest_booking(v_uid, v_pub.travel_date, v_pub.direction)`.
5. Same-publication `EXISTS`.
6. Cross-publication `EXISTS` on guest, travel date, and publication direction.
7. Block check, fuel estimate, seat decrement, insert, event, notify.

The check and the insert stay in the same database transaction as the lock. The second transaction cannot evaluate `EXISTS` until the first transaction ends. Under read committed, it then sees the committed ride and raises the existing error: `You already have an active ride for this date and direction`.

The 2-argument overload does not insert. It calls the 6-argument function, so it uses the same lock.

## What did not change

- Active statuses remain `requested`, `confirmed`, `pickup_pending`, `started`.
- Opposite directions still use different keys and can both succeed.
- Different dates still use different keys and can both succeed.
- Cancellation still leaves the ride outside the active set, so a later booking is allowed.
- Publication seat locking is unchanged. Two guests on one last seat still serialize on `FOR UPDATE`. The winner sets status to `full`. The waiter then hits the existing `Publication not open` check, which runs before `No seats left`.
- No publication or circle RLS policy is edited.
- Authentication is unchanged. `auth.uid()` is still the guest identity.

## Why this shape

A unique index was not added. `rides` does not store direction, and a unique `(guest_user_id, travel_date)` index would reject the opposite-direction booking the product already allows. Adding a direction column would be a wider schema change than this defect needs. The advisory lock matches the existing join (`rides` to `commute_publications.direction`) without changing that rule.

No other current function inserts into `rides`. A future direct `INSERT` would bypass this lock. That path does not exist today. The lock helper is not granted to `anon` or `authenticated`, so a resident session cannot call it to stall another guest. `cleaner_city_request_ride` is `SECURITY DEFINER` and calls the helper as its owner. `service_role` retains execute.

## Deadlock

Two different publications and the same guest/date/direction: each transaction locks its own publication row, then both want the same advisory key. Only one waits. The holder does not need the other publication row. There is no cycle.

Two guests and one publication: the publication `FOR UPDATE` runs first, then each guest takes a different advisory key. There is no cycle.

The concurrent runs completed with either one success or the existing duplicate error. None failed with a deadlock.
