# Cleaner City B3 concurrency test results

Official run: 2026-11-01, after the final migration text (lock helper not granted to `authenticated`).

Result: A through F and the no-op control all PASS.

This is a real two-connection test. It is not a source-text search for `pg_advisory_xact_lock`.

## Environment

- Engine: PostgreSQL 17.5, x86_64-windows, compiled by msvc-19.44.35209.
- Cluster: throwaway `initdb` at `%TEMP%\cc-b3-data`, trust auth, started with `pg_ctl -o "-p 54329 -h 127.0.0.1"`.
- Database: `ccb3` on `127.0.0.1:54329`, user `postgres`.
- Docker Desktop was not running, so the test used the local PostgreSQL 17 binaries at `C:\Program Files\PostgreSQL\17\bin`.
- Production project `kkzkuyhgdvyecmxtmkpy` was not used and was not migrated.

Harness: `src/test/sql/b3-harness.sql`, then `supabase/migrations/20261102233000_cleaner_city_guest_booking_lock.sql`.

The harness creates minimal `commute_publications`, `rides`, and `commute_blocks`, plus stubs for `auth.uid()` (from `request.jwt.claim.sub`), verified-commuter, haversine, fuel, ride events, and notify. A test-only `BEFORE INSERT` trigger sleeps 2 seconds when the transaction sets `b3.delay=1`. That trigger is not in the migration. It exists so the two calls overlap inside the critical section.

Runner: `node src/test/sql/b3-concurrency-runner.mjs`.

Each attempt is its own `psql` process:

```sql
BEGIN;
SELECT set_config('request.jwt.claim.sub', '<guest>', true);
SELECT set_config('b3.delay', '1' or '', true);
SELECT id FROM public.cleaner_city_request_ride('<publication>', 'b3', NULL, NULL, NULL, NULL);
COMMIT;
```

Before each scenario the runner truncates rides, publications, and blocks, then inserts five published publications.

| Id | Host | Date | Direction | Seats |
| --- | --- | --- | --- | --- |
| `d1000000-0000-4000-8000-000000000001` | host A | 2026-12-01 | to_office | 2 |
| `d1000000-0000-4000-8000-000000000002` | host B | 2026-12-01 | to_office | 2 |
| `d1000000-0000-4000-8000-000000000003` | host A | 2026-12-02 | to_office | 2 |
| `d1000000-0000-4000-8000-000000000004` | host B | 2026-12-01 | to_home | 2 |
| `d1000000-0000-4000-8000-000000000005` | host A | 2026-12-01 | to_office | 1 |

Guest: `11111111-1111-4111-8111-111111111111`. Second guest for E: `22222222-2222-4222-8222-222222222222`.

Active count is rides in `requested`, `confirmed`, `pickup_pending`, or `started` for that guest, date, and publication direction.

## A. Same guest, date, and direction, two publications

Connections: 2, started together with `Promise.all`. Delay trigger on.

- Publication 1: error `You already have an active ride for this date and direction` at 2129 ms.
- Publication 2: success, ride `718f3912-603b-44b8-bcdf-83450e289939`, at 2117 ms.
- Wall clock for the pair: 2189 ms, which covers the 2 second overlap sleep.
- Active rides for guest / 2026-12-01 / `to_office`: 1.

PASS.

## B. Same guest, different dates, same direction

Connections: 2, started together. Delay off.

- 2026-12-01 publication: success, ride `78ebd371-fcb7-47ad-b6af-6702bdd8159b`, 68 ms. Active count 1.
- 2026-12-02 publication: success, ride `c86468d6-e455-401c-adba-bd0230de132f`, 69 ms. Active count 1.

PASS.

## C. Same guest and date, opposite direction

Connections: 2, started together. Delay off.

- `to_office`: success, ride `e847dbd1-3a97-432a-aa1f-71c503b44e3e`, 176 ms. Active count 1.
- `to_home`: success, ride `cd66abf1-80eb-4f0a-95a6-7051fb3f4104`, 135 ms. Active count 1.

Existing rules allow this. PASS.

## D. Rebook after cancel

One connection booked publication 1. Ride `8eaefe5a-810e-4f2d-84ce-b70fad07f004`, 81 ms.

The runner then set that ride's status to `cancelled` and booked publication 2 (same date and direction). Ride `7b5372aa-2391-425e-af5f-51819343b0c5`, 72 ms.

Active count after the second booking: 1. The cancelled row stayed cancelled and did not count.

PASS. This matches the existing active-status list. Cancelled is not active.

## E. Two guests, one publication, one seat

Connections: 2, started together, delay on, publication `...0005` with `seats_available = 1`.

- Guest 1: error `Publication not open` at 2184 ms.
- Guest 2: success, ride `09a42314-a1b3-42ff-8134-904c452beae1`, 2141 ms.
- `seats_available`: 0.
- Requested rides on that publication: 1.

PASS. The loser message is `Publication not open` because the winner's update sets status to `full` when the last seat is taken, and the function checks status before it checks `No seats left`. The waiter re-reads the locked row after the winner commits. No second ride was inserted.

## F. Failure after the lock, then a valid request

Connections: 2.

- Connection 1: book publication 1, `pg_sleep(2)`, then `ROLLBACK`.
- Connection 2 starts 400 ms later and books publication 2 for the same guest, date, and direction, then commits.

Connection 2 succeeded after 1982 ms. Ride `e8a29d6b-ba2f-47c5-8e9d-e0de294d6511`. Active count: 1. The rolled-back insert is gone, and the advisory lock did not remain held.

PASS.

## Control. Same race with the lock removed

On this local database only, the runner replaced `cleaner_city_lock_guest_booking` with a no-op, reset the rows, and repeated scenario A with the 2 second delay.

- Both calls succeeded.
- Rides `af9a2021-44d8-433a-bf6e-34a5314df193` and `3dc58d6a-e9a0-43a9-b819-3166f50ada36`.
- Active count: 2.

PASS as a negative control. The same harness double-books when the shared lock is absent, and books once when it is present.

The runner then reapplied the migration. A follow-up catalog check showed both `cleaner_city_request_ride` overloads as `SECURITY DEFINER`, the 6-argument body still calling `cleaner_city_lock_guest_booking`, and execute on the helper granted to `postgres` and `service_role` only.

## Reproduce

```powershell
$bin = "C:\Program Files\PostgreSQL\17\bin"
$data = "$env:TEMP\cc-b3-data"
& "$bin\initdb.exe" -D $data -U postgres --auth=trust --no-instructions
& "$bin\pg_ctl.exe" -D $data -o "-p 54329 -h 127.0.0.1" -l "$env:TEMP\cc-b3.log" start
$env:Path = "$bin;" + $env:Path
$env:PGHOST = "127.0.0.1"
$env:PGPORT = "54329"
$env:PGUSER = "postgres"
$env:PGDATABASE = "ccb3"
psql -d postgres -c "CREATE DATABASE ccb3;"
node src/test/sql/b3-concurrency-runner.mjs
```

Exit code 0 means every recorded scenario passed.
