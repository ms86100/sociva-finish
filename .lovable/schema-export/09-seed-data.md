# Seed Data Reference

The test data seeding is handled by the `seed-test-data` edge function at `supabase/functions/seed-test-data/index.ts`.

## What It Creates

| Entity | Count | Details |
|---|---|---|
| Societies | 3 | Green Valley (Bangalore), Lakeside Towers (Indiranagar), Hilltop Heights (Whitefield) |
| Users | 4 | 2 buyers (User A, User D), 2 sellers (Seller C, Seller E) |
| Seller Profiles | 2 | Seller C Kitchen (food+bakery), Seller E Cafe (food) |
| Products | 5 | Butter Chicken, Paneer Tikka, Fresh Naan, Masala Dosa, Filter Coffee |

## Test Credentials

- Email: `usera@test.sociva.com`, `userd@test.sociva.com`, `sellerc@test.sociva.com`, `sellere@test.sociva.com`
- Password: `Test@12345`

## How to Run

The function is rate-limited (5/hour) and requires `ALLOW_TEST_FUNCTIONS` env var. Call via:
```
POST /functions/v1/seed-test-data
```
