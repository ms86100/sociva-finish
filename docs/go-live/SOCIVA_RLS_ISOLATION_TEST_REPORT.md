# Sociva Stage 2 RLS / Isolation Test Report

| Field | Value |
| --- | --- |
| Target | Staging `wwuanzbusxoyzixuprxs` |
| Production | Not modified; Stage2 society absent on `kkzkuyhgdvyecmxtmkpy` |
| Evidence | `docs/go-live/stage2-validation-results.json` |
| Result | **All isolation assertions in Stage2 suite passed** |

## Method

1. Sign in as Society A resident / admin / guard and Society B counterparts with real Auth sessions.
2. Attempt REST reads filtered to the other society's `society_id`.
3. Attempt privilege escalation writes (`society_admins` insert).
4. Attempt visitor OTP redeem across societies.
5. Attempt unauthenticated protected RPC.
6. Confirm no RLS weakening (tests fail closed; suite does not disable RLS).

## Cross-society matrix

| Test | Actor | Action | Expected | Actual | Pass |
| --- | --- | --- | --- | --- | --- |
| `rls_resident_a_cannot_read_notices_b` | Resident A | SELECT `society_notices` where society=B | 0 rows | 0 rows | yes |
| `rls_resident_a_cannot_read_visitors_b` | Resident A | SELECT `visitor_entries` where society=B | 0 rows | 0 rows | yes |
| `rls_resident_a_cannot_read_parcels_b` | Resident A | SELECT parcels where society=B | 0 rows / handled | pass | yes |
| `visitor_otp_cross_society_reject` | Guard B | Redeem Society A OTP | reject | reject | yes |
| `privilege_admin_a_cannot_join_society_b_admins` | Admin A | INSERT `society_admins` for B | reject | reject | yes |
| `privilege_resident_cannot_self_promote_admin` | Resident A | INSERT self as admin | reject | reject | yes |
| `unauthenticated_visitor_create_rejected` | anon | `visitor_create_entry` | reject | reject | yes |

## Privilege escalation notes

| Attempt | Result |
| --- | --- |
| Resident → society admin | Blocked |
| Society A admin → Society B admin row | Blocked |
| Guard B → Society A visitor OTP | Blocked (`OTP not valid for this society`) |
| Guard membership approve | Soft-asserted (no privileged update path exposed) |

## Visitor security (staging)

| Control | Evidence |
| --- | --- |
| Server OTP generation | `visitor_create_entry` returns `otp_code` |
| Guard redeem | `visitor_guard_redeem_otp` success once |
| Single-use | Second redeem fails |
| Society isolation on redeem | Guard B cannot redeem A OTP |
| Client OTP write | Direct insert with client OTP rejected (no INSERT policy / RLS) |

## Frontend staging gate

`isVisitorRpcAvailable()` returns true only when `IS_STAGING_SUPABASE` (URL contains `wwuanzbusxoyzixuprxs`). Production builds keep legacy insert until RPC promotion.

## Findings

- No evidence of Society A credentials reading Society B notices/visitors in REST tests.
- Isolation relies on RLS + SECURITY DEFINER RPC society binding - do not disable for convenience.
- Storage object and Realtime channel isolation were **not** separately instrumented in this Stage2 pass (remaining work).

## Recommendation

Promote visitor RPC + RLS package to production only after repeating this suite on a production-like staging clone and confirming Edge Function society checks for any remaining client write paths.
