# SOCIVA - Production migration readiness (membership architecture)

| Field | Value |
|---|---|
| Report ID | `SOCIVA-PMR-2026-11-23` |
| Mode | **Plan only. Not executed.** No production writes, deploys, or schema changes. |
| Staging (source of new model) | `wwuanzbusxoyzixuprxs` / branch `sociva-integration` |
| Production (current live) | `kkzkuyhgdvyecmxtmkpy` |
| Companion | `docs/audits/SOCIVA_STAGING_SECURITY_VALIDATION.md` |
| Date (UTC) | 2026-11-23 |

**Update 2026-11-24:** SSV-017 membership table + JWT-pinned helper is now live on production (`20261124008000_ssv017_production_cutover.sql`). 233 active memberships backfilled from `profiles.society_id`. Staging CAF, visitor RPCs, and request/decide RPCs were not copied. Remaining production holes (marketplace SELECT, visitor OTP, remaining SSV) are unchanged.

**Original decision (2026-11-23):** NO-GO to clone the full staging membership architecture onto production. Staging SSV-017 cutover was closed on `wwuanzbusxoyzixuprxs` only (`20261124004000_ssv017_staging_cutover_backfill_membership.sql`). Dual-read was skipped there so pending `profiles.society_id` cannot open hub SELECT.

Do not merge because staging "works". Staging SSV-001/002/003 are now closed on staging only. Production still uses `profiles.society_id` as membership, still has a live `user_roles` self-grant INSERT, and still exposes DEFINER helpers to `anon`. Promoting the membership architecture now would mix an unproven cutover with those live holes.

## Production exposure (read-only, 2026-11-23 evening)

SELECT only against `kkzkuyhgdvyecmxtmkpy`. No production writes, deploys, or secret reads.

### CRITICAL: `user_roles` self-grant is live

```
policy "Users can insert default buyer role" INSERT authenticated
  WITH CHECK (user_id = auth.uid() AND role = 'buyer')

policy "Users can insert default role" INSERT authenticated
  WITH CHECK (user_id = auth.uid())
```

Postgres PERMISSIVE policies OR. The second policy has **no role limit**. Any logged-in production user can INSERT `admin` (or `seller`) for themselves. Staging already dropped this pattern (`user_roles_insert_self_buyer` only).

`user_roles.role = admin` row count: **3**. Count only; no identities.

This hotfix should happen **before** marketplace work or membership promotion. Not applied in this pass.

### Other production SELECT findings (not changed)

| Check | Production |
|---|---|
| `get_user_society_id` | `SELECT society_id FROM profiles WHERE id = _user_id` |
| `profiles.society_id` / `verification_status` / `phone` / `email` | authenticated INSERT+UPDATE granted |
| Profiles SELECT | `Users can view all approved profiles` (global) |
| `seller_profiles` UPDATE | own row, no WITH CHECK (self-approve class) |
| `is_admin` / `get_user_society_id` / `get_user_auth_context` EXECUTE | anon **and** authenticated |
| Membership table / join RPCs | still absent |

---

## Scores (subset)

| Score | Value |
|---|---|
| Functional completeness of the new model on staging | 6.5 / 10 |
| Security assurance of the new model on staging | 3.5 / 10 |
| Production migration readiness | **2 / 10** |

---

## 1. Why production cannot inherit staging results

Production `get_user_society_id` (live read-only snapshot):

```sql
SELECT society_id FROM public.profiles WHERE id = _user_id LIMIT 1
```

Staging `get_user_society_id`:

```sql
SELECT m.society_id
FROM public.society_memberships m
WHERE m.user_id = _user_id AND m.status = 'active'
LIMIT 1
```

Every hub RLS policy that calls `get_user_society_id` therefore means **different things** in the two projects.

App code already branches on `IS_STAGING_SUPABASE` (`SUPABASE_URL` contains `wwuanzbusxoyzixuprxs`). Production builds keep client writes to `profiles.society_id` and client updates to `visitor_entries` (see `src/components/guard/GuardVisitorOTPTab.tsx` production branch).

---

## 2. Inventory of differences (read-only)

Production figures below are from a read-only snapshot taken at the start of this audit. After the staging-only constraint, production was not queried again and was never written.

| Area | Staging | Production |
|---|---|---|
| Societies | Test + Greenfield Tower H + Lakeview + Palm + Test Residencies | 242 total, 8 `is_active` |
| Membership table | `society_memberships` FORCE RLS, 32 active / 4 pending | **Table missing** |
| Profile society | `profiles.society_id` still present as cache; JWT can still PATCH it (SSV-001) | `profiles.society_id` is the membership source. 215 distinct non-null values |
| Join RPC | `request_society_membership` (registry + invite + one-active + rate limit) | **Missing**. Client/onboarding writes `profiles.society_id` |
| Decide RPC | `decide_society_membership` (admin or society admin) | **Missing** |
| Package RPC | `admin_assign_society_package` | **Missing** |
| Visitor write RPCs | `visitor_create_entry`, `visitor_set_status`, `visitor_guard_redeem_otp` | **Missing** |
| Visitor RLS | SELECT society-scoped + feature; INSERT/UPDATE revoked | **SELECT only** (`Society members can view visitor entries`). 0 visitor rows |
| Profiles SELECT | Same-society policy only | **`Users can view all approved profiles` still live** (`verification_status = approved` globally) |
| Parking RLS | `soc_read_parking` / `soc_insert_parking` via `get_user_society_id` (membership) | Same policy **names**, different helper body (profile column) |
| Public policy count | 583 | 593 |
| One-active unique index | `society_memberships_one_active_user` | N/A (no table) |
| Edge Functions | Staging project ref only | Separate deploy. `config.toml` points at production - do not default-CLI-deploy |
| Env / OTP bypass | QA phones + `ALLOW_OTP_BYPASS` on staging | Must **not** copy bypass flags |
| Feature packages | Core vs Pilot Ops assigned on Greenfield, Lakeview, Test A/B. Palm Core-only | Not this catalog on production |
| Auth | Same GoTrue pattern; production users already have sessions bound to `profiles.society_id` | Existing sessions remain valid after a naive helper swap, but **see different societies** if backfill is wrong |

Missing on production (confirmed `information_schema.routines`): `request_society_membership`, `decide_society_membership`, `admin_assign_society_package`, `visitor_create_entry`, `visitor_guard_redeem_otp`. Present on both: `get_user_auth_context`, `search_products_v2`.

---

## 3. What a safe migration must not do

| Hazard | How it happens | Result |
|---|---|---|
| Lose existing resident memberships | Swap `get_user_society_id` before backfill | Hub RLS returns NULL society. Residents see empty parking, chat, notices, visitors |
| Duplicate memberships | Backfill plus a second job, or profile + RPC both insert | Unique `(user_id, society_id)` helps; **one-active** unique index rejects a second `active` row |
| Wrong society assignment | Backfill from stale `profiles.society_id` or from inactive Google-Maps societies | Cross-society data exposure on day one |
| Revoke legitimate access | Require `is_verified` / `verification_status=approved` without mapping old pending users | 230 production profiles were pending in the earlier multi-tenant audit snapshot |
| Expose society data | Keep production global profile SELECT while adding membership RPCs | Directory leak remains even if hub tables are scoped |
| Break features | Visitor RPCs deployed without `IS_STAGING` removal, or kiosk still client-updates | Mixed write paths |
| Break sessions | Forcing re-login or deleting `refresh_token` | Unnecessary. Sessions can stay; helper swap is enough **if** backfill is correct |
| Copy staging holes | Ship SSV-001 (`profiles.society_id` PATCH) and SSV-002 (`user_roles` admin INSERT) | Privilege escalation on real users |

Keep `society_memberships_one_active_user`. It is a product limit, not a bug. Do not drop it to "support multiple societies" on the platform.

---

## 4. Migration plan (do not execute)

Run this on a **production-like copy** first (branch database or restored backup). Never on `kkzkuyhgdvyecmxtmkpy` until the copy passes the same adversarial JWT matrix as staging, **after** SSV-001 and SSV-002 are fixed.

### Phase A - Freeze and snapshot

1. Announce a write freeze for society join / profile society changes.
2. Snapshot production: `profiles (id, society_id, verification_status)`, `societies`, `user_roles`, `society_admins`, `security_staff`.
3. Count: users with `society_id` null; users pointing at inactive societies; duplicate phone/email; admins.

### Phase B - Schema add (expand only)

1. Create `society_memberships` (status check constraint, FORCE RLS, SELECT own/admin, **REVOKE** client INSERT/UPDATE/DELETE).
2. Create indexes including `society_memberships_one_active_user`.
3. Install RPCs `request_society_membership`, `decide_society_membership` with `sociva_assert_rate_limit` and **VOLATILE**.
4. Do **not** yet replace `get_user_society_id`.

### Phase C - Backfill (idempotent)

Suggested mapping (must be reviewed against live production rows before use):

| `profiles.verification_status` | `profiles.society_id` | Membership `status` |
|---|---|---|
| `approved` | non-null, society `is_active` | `active` |
| `pending` | non-null | `pending` |
| `approved` | society inactive / unverified | `pending` or skip - **decision required** |
| any | null | no row |

Rules:

- One row per `(user_id, society_id)`.
- At most one `active` per `user_id`. If a user somehow has two profile pointers (should not), fail the job, do not pick silently.
- After insert, optionally set `profiles.society_id` from the active membership so cache matches. Do not take the reverse direction after cutover.
- Platform admins: keep `user_roles`. Do not infer admin from membership.
- Do not copy staging QA phones or `ALLOW_OTP_BYPASS`.

Dry-run queries (copy only):

```sql
-- duplicates that would violate one-active
SELECT society_id, count(*) FROM profiles WHERE society_id IS NOT NULL GROUP BY 1;

SELECT verification_status, count(*) FROM profiles GROUP BY 1;

-- profiles whose society no longer exists
SELECT count(*) FROM profiles p
LEFT JOIN societies s ON s.id = p.society_id
WHERE p.society_id IS NOT NULL AND s.id IS NULL;
```

### Phase D - Dual-read window

1. Replace `get_user_society_id` with: active membership if present, else `profiles.society_id`.
2. Keep `guard_profile_privileged_columns` but fix it so PostgREST cannot PATCH `society_id` (SSV-001). Verify with a real user JWT on the copy, not service role.
3. Point join UI at `request_society_membership` behind a flag.
4. Compare row counts: hub SELECT as a sampled resident before vs after.

### Phase E - Cutover

1. `get_user_society_id` reads **only** active memberships (staging body).
2. Revoke any remaining client write on `society_memberships`.
3. Deploy visitor RPCs only after SSV-006 (OTP) and kiosk Authorized Persons are done. Until then, keep visitor **off** for real residents.
4. Remove production global profile SELECT (`Users can view all approved profiles`).
5. Drop production policy `Users can insert default role`. Keep only self-insert `role = buyer` (SSV-002) **before** any other production security work.
6. Remove `IS_STAGING_SUPABASE` branches that skip production-safe paths, only after copy tests pass.

### Phase F - Verification on the copy (required)

Repeat the staging adversarial matrix with **non-admin** JWTs from two real production societies (anonymized copy). Service-role SQL is not evidence.

Minimum gates: M1-M4, C1-C4, MK1-MK6, V1-V5, P1-P3, A1-A9 from `SOCIVA_STAGING_SECURITY_VALIDATION.md`.

---

## 5. Rollback plan (do not execute)

Rollback must not require restoring the whole cluster if only the helper and flag moved.

| Step | Action | Effect |
|---|---|---|
| R1 | Set feature flag / `IS_STAGING` equivalent off in production app | UI uses `profiles.society_id` join path again |
| R2 | `CREATE OR REPLACE FUNCTION get_user_society_id` back to `SELECT society_id FROM profiles` | Hub RLS returns to pre-migration meaning |
| R3 | Leave `society_memberships` in place (expand-only). Do not DROP on rollback | Data preserved for a later retry |
| R4 | Do not delete backfill rows | Re-cutover can reuse them |
| R5 | If visitor RPCs were enabled, `REVOKE EXECUTE` on `visitor_*` from `authenticated` and keep table writes revoked | Fail-closed visitors |
| R6 | If `user_roles` were corrupted (SSV-002 class bug), restore `user_roles` from the Phase A snapshot | Admin lockout / escalation recovery |

Sessions: users do not need to re-login for R2. They will see whatever `profiles.society_id` still holds. If Phase E cleared that column, **restore it from the snapshot or from `society_memberships`** before R2, or residents will have NULL societies.

---

## 6. Blockers before any production migration attempt

0. **LIVE production** - drop `Users can insert default role` on `user_roles`. Staging SSV-002 is not applied here.
1. **SSV-001** - `profiles.society_id` lock must actually fire for JWT `PATCH`. Closed on staging; production still grants UPDATE on that column.
2. **SSV-002** - `user_roles` self-grant `admin` must be impossible. Closed on staging; **open on production** (item 0).
3. DEFINER IDOR: `get_user_auth_context`, `get_user_society_id`, `is_admin` still EXECUTE for anon on production.
4. Marketplace SELECT / `search_products_v2` spoof (SSV-012 to SSV-014). Production already had a weaker `search_products_v2` / global products story in `SOCIVA_MULTI_TENANT_SECURITY_AUDIT.md`.
5. Backfill rules for 200+ pending production profiles signed off by an owner.
6. Adversarial retest on a production-like copy with two real societies.
7. Visitor Management stays staging-only until guard JWTs, OTP hash/rate-limit, and Authorized Persons are proven.

---

## 7. FINAL GO / NO-GO

**NO-GO**

Do not apply staging membership migrations to `kkzkuyhgdvyecmxtmkpy`. Do not merge the new membership architecture into the production app binary as the source of truth.

When work resumes, keep it on staging (`wwuanzbusxoyzixuprxs`) until SSV-001 and SSV-002 are closed and the copy-database migration has been tested with rollback R1-R6 rehearsed once.
