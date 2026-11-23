# SSV-017: production membership cutover (closed 2026-11-24)

Staging `wwuanzbusxoyzixuprxs` uses `society_memberships` + `sociva_private` wrappers.
Production `kkzkuyhgdvyecmxtmkpy` still uses `profiles.society_id`.

Read-only checks on production (2026-11-23):

- `get_user_society_id` is `SELECT society_id FROM public.profiles WHERE id = _user_id LIMIT 1`
- `to_regclass('public.society_memberships')` is null
- `parking_slots` policies `soc_read_parking` / `soc_insert_parking` have no `can_access_feature`

Staging SSV-015/016 CAF must not be copied here until a production-copy test is authorized.

Traffic architecture: production schema changes need explicit authorization. This file is a hold, not a migrate-now plan.

## Do not apply on production

- `society_memberships` cutover
- `get_user_society_id` rewrite to memberships
- `profiles.society_id` write lock
- anon helper GRANT/REVOKE wrappers that already broke logged-out browse on staging

The authorized production hotfix remains `user_roles` DROP POLICY only.

## Production-copy test before any later cutover

1. Restore a production backup or branch. Do not use live production.
2. Apply membership migrations there only.
3. Prove with JWTs: first login, join, society hub SELECT, marketplace search, visitor redeem.
4. If logged-out marketplace 401s, stop. Do not copy the staging GRANT set blindly.

SSV-017 stays open until that copy test is authorized and passes.

## Phase A snapshot (live production, read-only, 2026-11-23)

| Metric | Count |
|---|---|
| `profiles` | 249 |
| `society_id` set | 233 |
| `society_id` null | 16 |
| `verification_status=pending` | 230 |
| `verification_status=approved` | 19 |
| approved with society | 19 |
| pending with society | 214 |
| society_id pointing at missing society | 0 |

Suggested backfill on a copy only: 19 `active`, 214 `pending`. One-active unique index stays. Do not infer admin from membership.

Expand-only schema file (copy only): `supabase/migrations/20261124003000_ssv017_membership_expand_only_copy.sql`

## Phase B copy (2026-11-23) - ran then deleted

Authorized `$0.01344/hour` branch `ssv017-membership-copy` (`btxrfylfvqqwikvtusqt`), parent production. Empty data (schema copy only). Applied `20261124003000_ssv017_membership_expand_only_copy.sql` there only.

Copy JWT evidence:

| Check | Result |
|---|---|
| Table + FORCE RLS + `society_memberships_one_active_user` | present |
| `authenticated` INSERT/UPDATE/DELETE | revoked |
| `anon` SELECT | 401 permission denied |
| Non-admin JWT GET | 200 `[]` |
| Non-admin JWT POST `{status: active}` | 403 INSERT denied |
| `get_user_society_id` | still `profiles.society_id` (Phase B: not replaced) |

Live production `kkzkuyhgdvyecmxtmkpy`: `society_memberships` still null. Branch deleted after the test so the hourly charge stops.

SSV-017 live production cutover closed 2026-11-24 after explicit authorization.

Applied `20261124008000_ssv017_production_cutover.sql` on `kkzkuyhgdvyecmxtmkpy`:

- `society_memberships` created, FORCE RLS, writes revoked from `authenticated` / `anon`
- Unique one-active index kept
- Backfill: every profile with a valid `society_id` became **active** (matches live helper behavior; pending `verification_status` is not membership pending)
- `sociva_private.get_user_society_id` + public wrapper pins `auth.uid()` for authenticated, null for anon
- Staging CAF (SSV-015/016) and visitor RPCs were not copied

Do not treat this as a full staging-to-production clone. Marketplace SELECT, visitor OTP, and remaining SSV items are separate.

## Staging cutover closed (2026-11-23, `wwuanzbusxoyzixuprxs` only)

File: `supabase/migrations/20261124004000_ssv017_staging_cutover_backfill_membership.sql`

| Check | Result |
|---|---|
| Missing membership rows for `profiles.society_id` | 0 |
| Pending memberships (keep pending, do not activate) | 5 |
| Dual-read (`profiles.society_id` fallback) | Not enabled. Pending rows still have `profiles.society_id`; fallback would open hub SELECT |
| `sociva_private.get_user_society_id` | Active membership only |
| Pending helper (`variant-gate-*`, phone pending) | `null` |
| Stage2 A JWT spoofed `_user_id` | 200 `"a1111111-0001-4000-8000-00000000000a"` |
| Stage2 B JWT spoofed A id | 200 `"a1111111-0002-4000-8000-00000000000b"` |
| A parking / notices | 200 own society only |
| B parking | 200 `[]` |
| B notices | 200 own society only |
| A PATCH `profiles.society_id` | 403 |
| Anon `get_user_society_id` | 200 `null` |
| Live production | Unchanged: no `society_memberships`; helper still `profiles.society_id` |
