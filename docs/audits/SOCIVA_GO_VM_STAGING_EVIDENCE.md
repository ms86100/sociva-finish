# SOCIVA GO-VM staging evidence

| Field | Value |
|---|---|
| Date (UTC) | 2026-11-23 |
| Staging project | `wwuanzbusxoyzixuprxs` |
| Production project | `kkzkuyhgdvyecmxtmkpy` (not migrated) |
| Probe | `SELECT public.sociva_go_vm_isolation_probe()` |

## Verdict

**GO for Visitor Management on staging.**

**NO-GO for production launch** until these staging migrations are reviewed, applied to production, and the two-society matrix is re-run there.

## Production isolation (verified)

| Check | Production |
|---|---|
| `society_memberships` | does not exist |
| `visitor_create_entry` | does not exist |
| `get_user_society_id` | still `SELECT society_id FROM profiles` |

App code uses `IS_STAGING_SUPABASE` (`SUPABASE_URL` contains `wwuanzbusxoyzixuprxs`). Production builds keep the previous join and visitor insert paths.

## Staging controls now live

1. `society_memberships` with pending/active/rejected/suspended/removed
2. `request_society_membership` - approved+verified societies only, invite checked in RPC
3. `profiles.society_id` locked for authenticated clients (even first assign) unless RPC sets `app.allow_society_change`
4. `get_user_society_id` returns only **active** membership
5. Visitor writes via `visitor_create_entry` / `visitor_set_status` / `visitor_guard_redeem_otp` (server OTP)
6. `visitor_entries` SELECT society-scoped; no client INSERT/UPDATE
7. Restrictive gate_entries feature policy
8. Product SELECT: home society or `sell_beyond_community`
9. Profile SELECT: own or same-society approved (dropped `merged_profiles_select`)
10. Maps nearest-society auto-join disabled on staging

## Isolation probe result

```
ok: true
society_a != society_b
policy_would_allow_b_to_read_a_visitor: false
pending_has_no_active_society: true
memberships_active: 17
```

## Remaining before production GO

1. Review this branch and staging SQL
2. Apply the same migrations to `kkzkuyhgdvyecmxtmkpy` with a rollback plan
3. Deploy Edge `validate-society` to production after staging soak
4. Re-run probe + `e2e/cross-society-rls.spec.ts` against production credentials
5. Then enable Visitor Management for the first customer tenant
