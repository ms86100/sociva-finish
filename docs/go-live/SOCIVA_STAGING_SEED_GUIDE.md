# Sociva Staging Seed Guide (Stage 2)

Staging only: Supabase project `wwuanzbusxoyzixuprxs`.

Never run against production `kkzkuyhgdvyecmxtmkpy`.

## Purpose

Idempotent synthetic data for multi-society role testing, visitor OTP, parcels, notices, marketplace pending order, and RLS isolation.

## Prerequisites

1. Confirm target project ref is `wwuanzbusxoyzixuprxs`.
2. Apply (if missing):
   - `go_vm_visitor_rls_rpcs_staging` (visitor server RPCs)
   - `stage2_features_rpc_pilot_package` (RPC contract + pilot package)
3. Then seed:
   - `stage2_staging_seed_core_v4` / file `20261123231000_stage2_staging_seed_societies_users_ops.sql`
   - `stage2_seed_ops_extended_v3` / file `20261123232000_stage2_seed_ops_extended.sql`

Prefer Supabase MCP `apply_migration` with `project_id=wwuanzbusxoyzixuprxs`, or a CLI that is explicitly linked to staging.

## Deterministic identifiers

| Kind | Pattern |
| --- | --- |
| Societies | `a1111111-0001/0002/0003-...` |
| Builder | `a1111111-00bb-...` |
| Users | `a2222222-0001` ... `a2222222-0014` |
| Ops rows | `a3333333-...` |
| Email domain | `@stage2.sociva.test` |
| Phones | `+91990000xxxx` |

## Test accounts (emails only)

Password is stored in operator secrets / local env as `STAGE2_SEED_PASSWORD` (default used by seed SQL). Do not commit passwords into docs beyond the seed SQL that creates them for staging.

| Email | Role | Society |
| --- | --- | --- |
| `platform.admin@stage2.sociva.test` | Platform admin | A (membership) |
| `admin.a@stage2.sociva.test` | Society admin | A |
| `mod.a@stage2.sociva.test` | Moderator / committee | A |
| `guard.a@stage2.sociva.test` | Guard | A |
| `guard.sup.a@stage2.sociva.test` | Security supervisor | A |
| `resident.a1@stage2.sociva.test` | Resident | A |
| `resident.a2@stage2.sociva.test` | Resident | A |
| `seller.a@stage2.sociva.test` | Seller | A |
| `service.a@stage2.sociva.test` | Service provider | A |
| `admin.b@stage2.sociva.test` | Society admin | B |
| `guard.b@stage2.sociva.test` | Guard | B |
| `resident.b1@stage2.sociva.test` | Resident | B |
| `resident.c1@stage2.sociva.test` | Resident (minimal) | C |

Invite codes: `STAGE2A`, `STAGE2B`, `STAGE2C`.

## Societies

| Name | Slug | Package | Intent |
| --- | --- | --- | --- |
| Sociva Test Residency A | `sociva-test-residency-a` | Pilot (`sociva_pilot_ops`) | Rich operational dashboard |
| Sociva Test Residency B | `sociva-test-residency-b` | Pilot | Isolation counterpart |
| Sociva Test Residency C | `sociva-test-residency-c` | Default only | Empty / first-time states |

## Seeded data coverage

- Residents / flats / memberships / admins / guards
- Authorized person (A)
- Visitors with OTP (A + B isolation visitor)
- Parcel awaiting pickup (A)
- Parking slot + vehicle (A)
- Society notices (A + B-only)
- Bulletin post (A)
- Maintenance due pending (A) - not paid via gateway
- Help request (A)
- Conversation + message (A)
- Seller profile (approved, lat/lng, radius) + product
- Pending COD order + order-linked dispute (A)
- Seller credit account available **500** (onboarding rule)

## Idempotency

Re-running seed migrations upserts on deterministic IDs (`ON CONFLICT`). Existing non-seed staging rows are not deleted.

## Cleanup (seed-owned only)

Function: `public.stage2_cleanup_seed()`

- Deletes ops rows with ids matching `a3333333-%` (visitors, parcels, parking, notices, bulletin, dues, authorized persons as implemented).
- Restricted to service_role / platform admin.
- Does **not** auto-delete auth users or societies (safe reuse).
- Does **not** touch non-seed staging data.

Extended marketplace rows (`a3333333-0008`+) should be added to cleanup before a full wipe if needed.

## Validation

```bash
npm run test:stage2:staging
```

Requires `.env.local` (or env) with staging `VITE_SUPABASE_URL` + publishable key. Aborts if production ref detected.

## Safety rules

- Do not seed real resident PII.
- Do not fabricate completed external payment transactions.
- Do not enable pilot package for all societies.
- Do not run cleanup or seed against production.
