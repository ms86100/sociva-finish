# Sociva Stage 2 Implementation Report

| Field | Value |
| --- | --- |
| Date | 2026-11-23 |
| Scope | Staging Supabase only |
| Staging project | `wwuanzbusxoyzixuprxs` |
| Production project | `kkzkuyhgdvyecmxtmkpy` (off-limits; verified no Stage2 seed society) |
| Verdict | **CONDITIONAL GO** for controlled pilot on staging |

## Environment safety

- `.env.local` / staging frontend point at `https://wwuanzbusxoyzixuprxs.supabase.co`.
- `sociva-integration.vercel.app` shows banner: `STAGING BUILD · wwuanzbusxoyzixuprxs.supabase.co · not production`.
- All Stage2 migrations and seed SQL were applied via Supabase MCP with `project_id=wwuanzbusxoyzixuprxs` only.
- Production check: `EXISTS(society a1111111-0001-...)` = **false**.
- `supabase/config.toml` still lists production project_id for CLI defaults; Stage2 work did not use CLI migrate against prod.

## Changes made (code)

| Area | Change |
| --- | --- |
| RPC types | `src/integrations/supabase/types.ts` - `get_effective_society_features` returns 7 columns including `society_configurable`, `description`, `icon_name` |
| Society entry | `src/hooks/useSocietyEntryVisible.ts` - uses `society_configurable` when present; safe fallback if older RPC omits it |
| Visitor UX | `src/pages/VisitorManagementPage.tsx` - clearer empty-state copy for today / upcoming / history |
| Visitor security | Staging already gates create/check-in/out/cancel through server RPCs via `isVisitorRpcAvailable()` (`IS_STAGING_SUPABASE`). Legacy client OTP insert remains production-only compatibility path |
| Validation suite | `scripts/stage2-staging-validation.cjs` + `npm run test:stage2:staging` |
| Unit tests | `vitest` feature-gate suite: **193 passed** |

## Migrations applied to staging

| Migration name (staging) | Purpose |
| --- | --- |
| `go_vm_visitor_rls_rpcs_staging` | Server visitor OTP create / status / guard redeem |
| `stage2_features_rpc_pilot_package` | Recreate features RPC (7-col contract) + catalog + `sociva_pilot_ops` package |
| `stage2_staging_seed_core_v4` | Auth users, 3 societies, roles, memberships, visitors, parcels, parking, notices, bulletin, dues |
| `stage2_seed_ops_extended_v3` | Help, conversations, seller+product, pending COD order, dispute, Society B notice, service provider |

Repo files:

- `supabase/migrations/20261123230000_stage2_features_rpc_pilot_package.sql`
- `supabase/migrations/20261123231000_stage2_staging_seed_societies_users_ops.sql`
- `supabase/migrations/20261123232000_stage2_seed_ops_extended.sql`

## Feature / package verification

| Society | Enabled features (RPC) | `guard_kiosk` | `parcel_management` |
| --- | --- | --- | --- |
| Sociva Test Residency A (pilot builder) | 26 | yes | yes |
| Sociva Test Residency B (pilot builder) | 26 | yes | yes |
| Sociva Test Residency C (default only) | 11 | no | no |

Pilot package `sociva_pilot_ops` is assigned via builder link to A/B only - not globally enabled for all societies.

## Seed summary

Synthetic marker: emails `*@stage2.sociva.test`, IDs `a1111111-*` / `a2222222-*` / `a3333333-*`.

Society A: memberships, admins, guards, visitors, parcels, parking, notices, bulletin, dues, help, conversation, seller store, pending order, dispute.

Society B: separate admin/guard/resident + isolation visitor + B-only notice.

Society C: single resident for empty-state / first-time paths.

Seller onboarding credit seeded at **500** (workspace rule).

## Automated evidence

- `npm run test:stage2:staging` → **31/31 passed**, 0 skipped (see `docs/go-live/stage2-validation-results.json`).
- Focused unit tests: **193/193 passed**.
- Production Stage2 society probe: absent.

## Features still broken / incomplete

- Full browser login as every Stage2 persona on `sociva-integration` was not exhaustively walked (deployed session was Apple Review QA user). API-level persona auth + journeys are covered by the Stage2 suite.
- Maintenance **sandbox payment capture** not executed end-to-end against Razorpay; dues exist as `payment_status=pending` only (no fabricated paid gateway txn).
- Workforce attendance / domestic-help attendance seed deferred (schema needs help_entry linkage).
- Smart Groups as a dedicated product surface: bulletin + conversations seeded; full Smart Groups UX not separately automated.
- Production visitor path still allows legacy client OTP insert until RPC is promoted (intentional staging-first hardening).

## External integrations not tested as real sandbox

| Integration | Status |
| --- | --- |
| Razorpay maintenance / marketplace capture | Not run (pending dues/order only) |
| SMS OTP delivery | Not required; server generates OTP codes in DB |
| Push notifications | Not asserted in Stage2 suite |
| Realtime subscriptions | Not separately instrumented |
| Storage object ACL | Not separately instrumented |

## Security findings

- Staging: `visitor_entries` has SELECT policy; client OTP insert is rejected (validated).
- Guard OTP redeem is society-scoped; cross-society redeem rejected.
- OTP single-use after check-in enforced.
- Resident cannot self-promote to `society_admins`; Society A admin cannot insert into Society B admins.
- Resident A cannot read Society B notices/visitors via REST.
- Unauthenticated `visitor_create_entry` rejected.

## Remaining blockers for production pilot

1. Promote visitor RPC + RLS package to production with rollback plan (do not leave client OTP path).
2. Promote features RPC 7-col contract + pilot package assignment process (not global enable).
3. Execute Razorpay sandbox payment for maintenance on staging before calling payment-ready.
4. Deploy frontend changes (types / society entry / visitor empty states) to `sociva-integration` if not already on the build under test.
5. Manual tablet Guard Kiosk walkthrough with Stage2 guard account on device.

## Production writes

**None.** No migrations, seeds, or data modifications were applied to `kkzkuyhgdvyecmxtmkpy`.
