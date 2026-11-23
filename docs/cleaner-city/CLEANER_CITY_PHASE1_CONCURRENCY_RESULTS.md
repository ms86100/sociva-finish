# Cleaner City - Phase 1 Concurrency Results

**Date:** 2026-11-01  
**Project:** `kkzkuyhgdvyecmxtmkpy`

## Executed concurrent test

**NOT RUN.**

Required shape:

- One guest session
- Two host publications
- Same `travel_date`
- Same `direction`
- Both `cleaner_city_request_ride` calls in flight together

Creating those publications and rides on production was refused (no approved test accounts; rule against real resident rides). No staging project with a copied schema was available in this session.

## What the live function actually locks (catalog, STATIC ONLY)

`cleaner_city_request_ride` (overload with guest pickup arguments):

- `uses_advisory`: false
- `locks_publication`: true (`SELECT ... FROM commute_publications WHERE id = p_publication_id FOR UPDATE`)
- Raises `You already have an active ride for this date and direction` after an `EXISTS` on the guest's other rides joined to publications

The `FOR UPDATE` row is the **target publication**, which is different for host 1 and host 2. The guest's existing rides are read without a lock that both transactions share. Two transactions can both observe "no active ride" and both insert.

There is a partial unique index on **host** publications:

```text
UNIQUE (host_user_id, travel_date, direction)
WHERE status IN ('draft','published','full')
```

There is **no** equivalent constraint on guest rides for `(guest_user_id, travel_date, direction)`.

## Classification

| Check | Status |
|-------|--------|
| Concurrent double-book executed | NOT RUN |
| Sequential double-book executed | NOT RUN |
| Different date / opposite direction executed | NOT RUN |
| Race possible from the locking design | STATIC ONLY - treated as an open release blocker until a concurrent test shows one winner |

No correction was applied in this gate. A safe fix, if approved later, is a transaction-scoped advisory lock on `(guest_user_id, travel_date, direction)` inside `cleaner_city_request_ride`, or a uniqueness constraint that includes direction (the `rides` row does not store direction today; it must be derived from the publication or stored). Re-run the concurrent pair after that change.

## Other lifecycle races

Host cancel with multiple guests, duplicate cancel, waitlist notify, blocked-user exclusion, no-show / reject / guest cancel seat release, and two guests claiming one seat: **NOT RUN**.
