# Cleaner City - Phase 1 Production Acceptance Results

**Executed:** 2026-11-01  
**Project:** `kkzkuyhgdvyecmxtmkpy`  
**Rule:** No inferred PASS. Service-role checks are labelled as such.

---

## 1. Migration history (executed)

Query:

```sql
SELECT version, name
FROM supabase_migrations.schema_migrations
WHERE version >= '20261101100000'
ORDER BY version;
```

### Exact finding

There is **no** row with version `20261102230000` and **no** row whose name is `cleaner_city_phase1_remediation`.

The repository file `supabase/migrations/20261102230000_cleaner_city_phase1_remediation.sql` was applied as **separate** `apply_migration` chunks. Recorded production versions (apply clock, 2026-11-01):

| version | name |
|---------|------|
| 20261101141155 | cleaner_city_phase1_remediation_security |
| 20261101141401 | cleaner_city_phase1_01_waitlist_and_release_seat |
| 20261101141430 | cleaner_city_phase1_02_publish_commute |
| 20261101141504 | cleaner_city_phase1_03_cancel_cascade_and_seat_release |
| 20261101141524 | cleaner_city_phase1_04_request_ride_double_book |
| 20261101141556 | cleaner_city_phase1_05a_set_autopilot_run |
| 20261101141609 | cleaner_city_phase1_05b_confirm_respond |
| 20261101141637 | cleaner_city_phase1_00_early_pubs_circles_leave |
| 20261101141643 | cleaner_city_phase1_06b_resolve_phone |
| 20261101141644 | cleaner_city_phase1_07_unique_index |
| 20261101141705 | cleaner_city_phase1_06a_circle_helpers |
| 20261101141721 | cleaner_city_phase1_06c_report_incident |
| 20261101141728 | cleaner_city_phase1_08_privacy_selftest |
| 20261101142526 | fix_can_access_feature_feature_id |

Earlier Cleaner City repo files named `20261102...` are likewise stored under `20261101...` apply versions (example: repo `20261102220000_cleaner_city_domain_check_request.sql` is production `20261101133702` / `cleaner_city_domain_check_and_request`).

### Date discrepancy (evidence, not a guess)

- Acceptance and remediation reports are dated **1 November 2026** because that is the calendar day the work ran (IST evening, still 1 Nov UTC as well: phase1 chunks are `2026110114....`).
- The filename `20261102230000` is a **repository sort key** chosen so the file orders after `20261102220000_...domain_check_request.sql`. It is not the `schema_migrations.version` Supabase assigned when `apply_migration` ran.
- Therefore the 2 November stamp in the filename and the 1 November report are consistent with how this repo names files versus how production records apply time. It is a **version-identity mismatch**, not evidence that the SQL was applied on 2 November.

### Contents match (spot checks, service role)

| Object | Production evidence | Matches repo intent |
|--------|---------------------|---------------------|
| `commute_publications_select` | `is_admin OR is_society_admin OR host_user_id = auth.uid()` | Yes. Society-peer published SELECT removed |
| `commute_circles_read` | admin OR circle member exists | Yes. Society-wide invite SELECT removed |
| Unique index `uq_commute_publications_host_date_dir_active` | partial unique on `(host_user_id, travel_date, direction)` where status in draft/published/full | Yes |
| `cleaner_city_leave_circle` | present | Yes |
| `cleaner_city_cancel_publication(uuid, text)` | present | Yes |
| `cleaner_city_request_ride` (guest-pin overload) | body contains the double-book exception text; `FOR UPDATE` on the target publication; **no** `pg_advisory` | Yes to the RPC guard; **no** guest-level unique index |
| `cleaner_city_phase1_privacy_selftest()` | all six flags true | Service-role only. Not a resident test |
| Later change | `fix_can_access_feature_feature_id` (`20261101142526`) replaces `can_access_feature` to call `is_feature_enabled_for_society` | Does not revert the policies above |

### Rollback file

`supabase/rollbacks/20261102230000_cleaner_city_phase1_remediation.rollback.sql` is a **best-effort** script. It drops some Phase 1 functions and **restores the old, weaker** publication and circle SELECT policies. It does not restore prior function bodies and it does not name the chunked production versions. It is not a byte-for-byte inverse of what production recorded.

**Classification:** migration presence **PASS** as chunked apply. Single-version identity `20261102230000` **FAIL** (not recorded). Policy/index intent **PASS** by catalog inspection (not by resident session).

---

## 2. Authenticated RLS (A/B/C)

**BLOCKED.** This session has no three resident JWTs (publication owner, same-society peer, other society). Service-role policy text is not accepted as the penetration test. See `CLEANER_CITY_PHASE1_RLS_PENETRATION_RESULTS.md`.

---

## 3. Double-booking concurrency

**NOT RUN** as a concurrent pair of authenticated requests. Static review of the live function: lock is `FOR UPDATE` on the publication being requested, not on the guest's other rides. Two requests against two different publications can both pass the `EXISTS` check. See concurrency report. Not fixed in this gate.

---

## 4. Cancel / waitlist / SOS / Autopilot runtime

**NOT RUN.** Would create rides and notifications on production. Refused under the safety rule.

---

## 5. OTP

**FAIL** for real delivery. Function log at `2026-11-01T14:27:53.928Z`:

```text
[cleaner-city-work-email-otp] resend 403
You can only send testing emails to your own email address (...).
To send emails to other recipients, please verify a domain at resend.com/domains
```

HTTP result for that call: **502**. `admin_settings` has `resend_api_key` and does **not** have `resend_from_email`. Fallback From is `onboarding@resend.dev`.

Wrong OTP, expired OTP, reuse, and Autopilot-after-revoke: **NOT RUN** (no delivered code).

---

## 6. Typecheck and vitest (STATIC ONLY)

```text
npx tsc --noEmit -p tsconfig.json
```

**Result:** exit 0. TypeScript: no errors found.

```text
npx vitest run src/test/cleaner-city-phase0.test.ts src/test/cleaner-city-phase1-4.test.ts src/test/cleaner-city-phase1-remediation.test.ts src/test/cleaner-city-security.test.ts src/test/cleaner-city-unit9-12.test.ts
```

**Result:** 5 files, **87 passed**. These are source-string and helper tests, not production journeys.

---

## 7. Meetup points

```sql
SELECT count(*) FROM public.society_meetup_points;
```

**Result:** `0`. No Greenfield points exist. None were seeded. No authoritative coordinate list was supplied in this session.

---

## 8. Device dogfood

**BLOCKED.** No supervised iOS or Android session was run.
