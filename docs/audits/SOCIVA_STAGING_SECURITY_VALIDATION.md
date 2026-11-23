# SOCIVA - Staging adversarial security validation

| Field | Value |
|---|---|
| Report ID | `SOCIVA-SSV-2026-11-23` |
| Git branch | `sociva-integration` |
| Staging Supabase | `wwuanzbusxoyzixuprxs` |
| Staging app | `https://sociva-integration.vercel.app` |
| Production Supabase | `kkzkuyhgdvyecmxtmkpy` |
| Date (UTC) | 2026-11-23 |

**Classification:** CRITICAL | HIGH | MEDIUM | LOW | PASS | NOT TESTED

## Correction (same day, after SSV-001 / 002 / 003 on staging)

The original body below is the morning adversarial pass. It is still the inventory. These items are **closed on staging only** (non-admin JWT evidence):

| ID | Original finding | Staging now |
|---|---|---|
| SSV-001 | Resident could PATCH `profiles.society_id` | Column UPDATE revoked; PATCH 403 |
| SSV-002 | Self-insert `user_roles.admin` | Insert WITH CHECK is self-`buyer` only; admin insert 403 |
| SSV-003 / 004 / 005 | DEFINER helpers accepted another user's id | Public wrappers pin `auth.uid()`; other-user `get_user_auth_context` 403 |
| SSV-010 | `conversations_is_member` EXECUTE missing | Granted to authenticated |
| Anon RLS | After helper REVOKE, logged-out marketplace 401 | Anon EXECUTE restored on false-returning wrappers; products/sellers/categories return rows |
| Seller self-approve | POST/PATCH `verification_status=approved` 201 | Trigger 403; draft/pending still allowed |

Still **open on staging:** marketplace SSV-012/013/014, visitor OTP/Authorized Persons, guard/suspended/society-admin/Palm JWTs (NOT TESTED).

**Production is not this model.** Do not treat staging closures as live. Production `user_roles` still has an INSERT policy `Users can insert default role` with `with_check = (user_id = auth.uid())` and **no role limit**. That is a live privilege-escalation hole. See `SOCIVA_PRODUCTION_MIGRATION_READINESS.md`.

**Final decision: NO-GO** for production promotion of the staging membership architecture, and **NO-GO** for exposing Visitor Management to real residents, until the production `user_roles` insert is hotfixed and the remaining SSV items are closed.

This is not a UI audit. Several hub modules **work**. That is not the same as being correctly restricted, safe under malicious requests, or production-ready.

---

## Scores

| Score | Value | Meaning |
|---|---|---|
| 1. Functional completeness | **6.5 / 10** | Approved registry, membership RPCs, Core vs Pilot Ops catalog, and several hub SELECTs behave in the happy path. Visitor kiosk, Authorized Persons, guards, pending/suspended sessions, and Core-only entitlement at the API were not fully exercised. |
| 2. Security assurance | **3.5 / 10** | Cross-society SELECT on parking / parcels / notices / visitors held for the Lakeview JWT. Privilege escalation, `profiles.society_id` self-write, DEFINER IDOR RPCs, and marketplace catalog leakage did **not** hold. |
| 3. Production migration readiness | **2 / 10** | See `docs/audits/SOCIVA_PRODUCTION_MIGRATION_READINESS.md`. Production still uses `profiles.society_id`. Staging security behavior does not exist there. |

Release gates from the assessment:

| Gate | Result |
|---|---|
| Society onboarding | **PASS** (approved registry; `request_society_membership` requires `is_active` and `is_verified`) |
| Membership authorization | **FAIL** |
| Cross-society RLS | **FAIL** (hub tables isolated; profile cache, DEFINER oracles, marketplace not isolated) |
| Chat and Smart Groups isolation | **PASS** with MEDIUM grant defect (fail-closed) |
| Marketplace visibility | **FAIL** |
| Visitor Management isolation | **PASS** for tested SELECT + redeem; **NOT TESTED** create/replay/kiosk Authorized Persons |
| Feature entitlement enforcement | **FAIL** (parking has no `can_access_feature`; admin UI bypass; feature catalog RPC is world-readable to any JWT) |
| Production migration and rollback | **NOT VERIFIED** (plan only; not executed; not tested on a production-like copy) |

---

## How this was tested (and what was not)

### Identities that were actually authenticated

| Label | Staging identity | How | Usable as |
|---|---|---|---|
| Resident B | QA phone `****2907` | Staging QA OTP bypass, server-minted JWT | Active Lakeview member. `is_admin` false. |
| Platform admin | QA phone `****3201`, user `ee4a9985-...` | Same OTP path | `user_roles.role = admin`. **Not** a Resident A stand-in. |
| Unauthenticated | anon key only | No JWT | Public/anon grants |

Society A for attacks: Shriram Greenfield Phase-2, Tower H (`327fb699-542e-4ab6-b0b1-97022604bb88`), Pilot Ops.
Society B: Lakeview Proof Residency, Pilot Ops.
Core-only catalog target: Palm Breeze Apartments (`c9dbcc17-7833-44e2-80d8-c4809a6026ec`) - visitors/parking **false**, marketplace **true**.

### Identities NOT tested (no disposable JWT)

| Label | Why |
|---|---|
| Resident A (non-admin Greenfield) | Live Greenfield members exist (`****3832`, `****3802`) but they are not QA phones. Using them would mint sessions for real residents. Aditi is platform admin and would **false-pass** RLS via `is_admin`. |
| Pending resident | Four `pending` rows exist, all on Variant Gate Society, synthetic UUIDs, not loginable. |
| Suspended resident | Zero `suspended` memberships on staging. |
| Society A/B security guard | `security_staff` rows are synthetic UUIDs on Test Residency A/B only. |
| Society B administrator | No non-platform society_admin on Lakeview. |

Do not treat those rows as PASS.

### Execution safety

- No production writes, deploys, or schema changes.
- No staging schema / RLS / migration changes.
- Expected-deny writes that **failed** left no rows.
- Two expected-deny writes **succeeded** on the QA Lakeview account and were reverted:
  1. `profiles.society_id` was changed to Greenfield, then restored to Lakeview.
  2. `user_roles (role=admin)` inserted (`4a5876e7-...`) then deleted (HTTP 204). Live check after: roles = `buyer` only.
- No Visitor OTP was redeemed. Test A expected OTP was submitted and rejected (`Not a guard for this society`).
- PII in this report is redacted. Raw JWT and OTP values are not published.

---

## Phase 1 - Security inventory (staging live)

### 1.1 Database shape

| Metric | Staging live |
|---|---|
| `public` tables | 323 |
| RLS enabled | **all** listed public tables (`relrowsecurity = true`) |
| FORCE RLS | `visitor_entries`, `society_memberships`, `gate_entries`, plus seller-credit tables |
| `pg_policies` (public) | 583 |
| Unique one-active-society index | `society_memberships_one_active_user` on `user_id` WHERE `status = 'active'` **present** (product limit, not a vulnerability) |
| Memberships | 32 active, 4 pending, 0 suspended |
| Helper `get_user_society_id(uuid)` | `SECURITY DEFINER` `STABLE` `search_path = public`. Body: active row in `society_memberships`, `LIMIT 1`. **No `auth.uid()` check.** |

Source (live):

```sql
CREATE FUNCTION public.get_user_society_id(_user_id uuid)
RETURNS uuid
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT m.society_id
  FROM public.society_memberships m
  WHERE m.user_id = _user_id AND m.status = 'active'
  LIMIT 1
$$;
```

`is_admin(uuid)` is `has_role(_user_id, 'admin')` against `public.user_roles`. It is **not** JWT `user_metadata` or `app_metadata`. Frontend `isAdmin` in `src/contexts/auth/AuthProvider.tsx` reads roles from `get_user_auth_context` / `user_roles`.

### 1.2 Tables with RLS on and zero policies

Fail-closed for `authenticated` (no policy = no rows), mostly finance / payments / reconciliation:

`_pnq_wakeup_gate`, `bank_statement_rows`, `chargeback_allocations`, `chargeback_cases`, `financial_*` (several), `notification_failures`, `order_acceptance_expiry`, `payment_attempts`, `payment_capture_allocations`, `payment_captures`, `payment_provider_events`, `payout_attempts`, `payout_limit_policies`, `provider_statement_row*`, `reconciliation_*`, `refund_allocation_snapshots`, `refund_attempts`, `seller_alert_android_config`, `seller_credit_contact_debits`, `seller_liability_entries`, `seller_return_reserves`.

Supabase advisor: `rls_enabled_no_policy` count **35** (includes `finance` schema). Classification: **PASS** (deny by default) unless a DEFINER RPC grants a back door. Not individually pentested.

### 1.3 High-risk table policy matrix (live `pg_policies`)

Legend: `GUS` = `get_user_society_id`; `CAF` = `can_access_feature`; `ADM` = `is_admin` bypass.

| Table | PK | Society ownership | SELECT | INSERT | UPDATE | DELETE | GUS | CAF | ADM bypass | Authenticated grants |
|---|---|---|---|---|---|---|---|---|---|---|
| `society_memberships` | `id` | `society_id` | own OR admin OR society_admin (`society_memberships_select_own`) | none | none | none | no | no | yes | **INSERT/UPDATE/DELETE revoked** (`has_table_privilege insert = false`) |
| `profiles` | `id` | `society_id` cache | `Users can view own or same-society approved profiles` only (global approved SELECT **absent** on staging) | own id | own OR admin | none named | yes on SELECT | no | yes | UPDATE granted |
| `visitor_entries` | `id` | `society_id` | `visitor_entries_select_society` | none (RPC) | none (RPC) | leftover own-delete, table DELETE revoked | yes | visitor_management OR gate_entry | yes | INSERT false |
| `parking_slots` | `id` | `society_id` | `soc_read_parking` | `soc_insert_parking` | admin ALL (named in migrations; live dump showed insert+select) | admin | yes | **NO** | some policies | INSERT true |
| `parking_violations` | `id` | `society_id` | `soc_read_violations` | `soc_insert_violations` | admin | | yes | **NO** | yes | |
| `parcel_entries` | `id` | `society_id` | `soc_read_parcels` | `soc_insert_parcels` | `soc_update_parcels` | | yes | parcel_management | yes | |
| `society_notices` | `id` | `society_id` | members + CAF | admin/society_admin + CAF | can_write | can_write | yes | yes | yes | |
| `bulletin_posts` | `id` | `society_id` | members + admin | author + own society | author OR admin | author OR admin | yes | restrictive in migrations; live SELECT has **no CAF** | yes | |
| `conversations` | `id` | inherited via members | member OR admin | none (RPC) | none | none | via `conversations_is_member` | RPC checks `conversations` | yes | |
| `conversation_members` | composite | inherited | member OR self OR admin | none | self read cursor | none | no | no | yes | |
| `conversation_messages` | `id` | inherited | member OR admin | none (RPC) | none | none | no | no | yes | |
| `seller_profiles` | `id` | `society_id` | **`Anyone can view approved sellers`** (`verification_status = approved` OR own OR admin) | own user_id | own OR admin | | **NO** | no | yes | |
| `products` | `id` | via seller | approved catalog (live name: home society or opted-in radius) | own seller | own seller | own seller | mixed | no | yes | |
| `orders` | `id` | commerce | buyer OR seller OR admin | buyer_id = uid | buyer/seller/admin | | no | no | yes | |
| `delivery_addresses` | `id` | `user_id` | own | own | own | own | no | no | no | |
| `authorized_persons` | `id` | `society_id` + resident | own resident_id | own | own | restrictive CAF visitor_management | **NO on own_* policies** | restrictive writes | `auth_persons_policy` ALL includes admin | |
| `manual_entry_requests` | `id` | `society_id` | GUS | GUS | GUS | | yes | leftover PERMISSIVE gates in migrations | | |
| `gate_entries` | `id` | `society_id` | GUS | GUS + CAF restrictive | | | yes | visitor OR gate | | FORCE RLS |
| `security_staff` | | `society_id` | GUS | GUS | GUS | | yes | no | **no admin on these three** | |
| `society_admins` | | `society_id` | members OR admin | `is_society_admin` ALL | same | same | yes on SELECT | no | yes SELECT | |
| `user_roles` | `id` | n/a | own OR admin | **Closed on staging:** `user_roles_insert_self_buyer` (`user_id = uid AND role = buyer` only). Original `merged_user_roles_insert` tautology is gone here. **Still live on production** (`Users can insert default role`). | admin ALL | admin ALL | no | no | yes | INSERT true (buyer only) |
| `builder_societies` | | `society_id` | **`USING (true)`** | admin ALL | admin | admin | no | no | yes | |
| `feature_packages` | | n/a | `USING (true)` for authenticated | admin | admin | admin | no | no | yes | |
| `society_feature_overrides` | | `society_id` | GUS | GUS | GUS | | yes | no | no | |
| `society_workers` | | `society_id` | GUS | GUS | GUS | | yes | no on soc_* | | |
| `worker_job_requests` | | `society_id` | own OR GUS | resident_id = uid | own OR GUS | | yes | | | |

Inherited society (no `society_id` on the row): `conversation_*` via DEFINER RPCs that require same-society approved membership; `bulletin_votes` via parent post; `conversation_message_attachments` via message membership.

### 1.4 Trigger that was supposed to lock `profiles.society_id`

Trigger `trg_guard_profile_privileged_columns` is **enabled** (`tgenabled = O`) on `public.profiles`. Function `guard_profile_privileged_columns` (`SECURITY DEFINER`, `search_path = public`) raises `42501` when `NEW.society_id IS DISTINCT FROM OLD.society_id` unless `is_admin(auth.uid())` or `app.allow_society_change = true`.

The lock only runs when `current_user IN ('authenticated', 'anon')`. If PostgREST executes as another role (typical: `authenticator` then `SET ROLE`), this `IF` is skipped and the lock is a no-op.

**Live result:** a non-admin Lakeview JWT `PATCH /rest/v1/profiles?id=eq.<self>` with `{ "society_id": "<Greenfield>" }` returned **200** and persisted Greenfield on `profiles.society_id` while `society_memberships` stayed Lakeview. See SSV-001.

### 1.5 DEFINER RPCs that bypass table RLS

Granted to `authenticated` (advisor: **360** signed-in executable DEFINER functions). Highest-risk, live-tested or source-reviewed:

| RPC | Definer | Authz | Caller can pass other user/society | Live JWT result |
|---|---|---|---|---|
| `get_user_society_id` | yes | none | **yes** user_id | **FAIL** returned Greenfield id for a Greenfield resident UUID |
| `get_user_auth_context` | yes | none | **yes** user_id | **FAIL** returned platform-admin profile JSON + roles |
| `has_active_society_membership` | yes | none | **yes** | **FAIL** returned `true` for a Greenfield resident |
| `is_admin` | yes | none | **yes** | **FAIL** anon and resident both got `true` for the platform-admin UUID |
| `can_access_feature(uuid,text)` | yes | none | **yes** society | **INFO** Palm visitors = `false` (oracle, not a write) |
| `get_effective_society_features` | yes | none | **yes** society | **FAIL** as probe: Lakeview JWT received Greenfield Pilot Ops catalog |
| `request_society_membership` | yes VOLATILE | `auth.uid()`, registry, rate limit 8/hour | society_id of join target | **PASS** `Already an active member of another society` |
| `decide_society_membership` | yes VOLATILE | platform or society admin + rate limit 30/60s | membership id | **PASS** `Not authorized` on a real pending id; row stayed pending |
| `admin_assign_society_package` | yes VOLATILE | `is_admin(auth.uid())` only + RL | society/package/builder | **PASS** resident `not authorized`; admin with bogus ids `package not found` (authz passed, validation failed) |
| `visitor_create_entry` | yes | membership + CAF visitor_management | no | **NOT TESTED** (would insert) |
| `visitor_guard_redeem_otp` | yes | guard/admin + same society OTP | OTP only | **PASS** `Not a guard for this society` |
| `visitor_set_status` | yes | owner or admin | visitor id | **PASS** 403 on Test A visitor |
| `conversations_open_or_request` | yes | same-society verified residents | target user | **PASS** `Recipient must be a verified resident in your society` |
| `conversations_send_message` | yes | member | conversation id | **PASS** 400 on Test A conversation |
| `search_products_v2` | yes VOLATILE | none (commerce) | `_buyer_society_id` | **FAIL** spoofed Greenfield, `is_same_society: true` |
| `search_nearby_sellers` | yes | | `_buyer_society_id` | **PASS** `permission denied for function` (EXECUTE revoked) |

Anon-executable DEFINER (advisor, 12): `is_admin`, `is_society_admin`, `has_role`, `search_products_v2`, `search_sellers_paginated`, `get_products_for_sellers`, plus banner helpers and `fn_check_rate_limit`.

### 1.6 Storage

`vehicle-documents` list as Resident B: `NoSuchBucket`. Public SELECT buckets still exist in SQL (`app-images`, `banner-images`, category images). Authenticated INSERT on banner/category buckets with no admin check remains in migrations (`20260412054525`, `20260320065631`). **NOT TESTED** live beyond the missing vehicle-documents bucket.

---

## Phase 2 - Cross-society penetration tests

Transport: `https://wwuanzbusxoyzixuprxs.supabase.co/rest/v1/...` and `/functions/v1/msg91-*`. Header: user access token (or anon). **Not** service role.

Heuristic note: a first-pass script marked some 200 JSON scalars as PASS. The table below is **reclassified from the actual HTTP body**, not from that heuristic.

### 2.1 Membership

| ID | Identity | Operation | Expected | Actual | Verdict |
|---|---|---|---|---|---|
| M1 | Resident B | `PATCH profiles` `society_id` = Greenfield | deny | **200**, row returned with Greenfield `society_id`. Membership row still Lakeview. | **FAIL** CRITICAL |
| M2 | Resident B | `POST society_memberships` active for Greenfield | deny | 403 `permission denied for table society_memberships` | **PASS** |
| M3 | Resident B | `POST rpc/request_society_membership` Greenfield | deny (one-active) | 400 `Already an active member of another society` | **PASS** |
| M4 | Resident B | `POST rpc/decide_society_membership` pending `aa00eec7-...` `active` | deny | 403 `Not authorized`. SQL after: still pending. | **PASS** |
| M5 | Pending resident private hub | | deny | no loginable pending JWT | **NOT TESTED** |
| M6 | Suspended session reuse | | deny | zero suspended rows | **NOT TESTED** |
| M7 | Bypass one-active unique index | second active insert | deny | table INSERT revoked; RPC enforces one-active | **PASS** (keep the unique index) |

### 2.2 Chat and Smart Groups

| ID | Identity | Operation | Expected | Actual | Verdict |
|---|---|---|---|---|---|
| C1 | Resident B | `GET conversation_messages` Test A id `a3333333-0014-...` | empty/deny | 403 `permission denied for function conversations_is_member` | **PASS** isolation (fail-closed). **MEDIUM** grant bug |
| C2 | Resident B | `GET conversation_members` Test A conv `a3333333-0011-...` | empty/deny | same 403 | **PASS** isolation / **MEDIUM** grant |
| C3 | Resident B | `rpc/conversations_open_or_request` Greenfield resident `104103c8-...` | deny | 400 `Recipient must be a verified resident in your society` | **PASS** |
| C4 | Resident B | `rpc/conversations_send_message` Test A conv | deny | 400 | **PASS** |
| C5 | Resident B | `GET bulletin_posts` | no Greenfield posts | 200 `[]` | **PASS** (Lakeview also has 0 posts; no Greenfield leak) |
| C6 | Platform admin | `GET` Test A message | allow if admin bypass | 403 same `conversations_is_member` EXECUTE denial | **FAIL** as admin-read; **PASS** as non-leak |
| C7 | Attachments storage path traversal | | deny | | **NOT TESTED** |
| C8 | Unauthenticated messages | | deny | 200 empty | **PASS** |

There is no `smart_groups` table. Smart Groups are `bulletin_posts` + categories (`20261123120000_smart_groups_phase1.sql`).

### 2.3 Marketplace

| ID | Identity | Operation | Expected | Actual | Verdict |
|---|---|---|---|---|---|
| MK1 | Unauthenticated | `GET seller_profiles?id=eq.73a46c8c-...` (`sell_beyond_community=false`) | deny | **200** row | **FAIL** HIGH |
| MK2 | Resident B | same + `bank_account_number,upi_id,bank_ifsc_code` | deny | **200** row (bank/UPI null on this seller, **columns allowed**) | **FAIL** HIGH |
| MK3 | Resident B | list approved Greenfield sellers | deny private community sellers | **200**, 5 rows including `sell_beyond=false` | **FAIL** HIGH |
| MK4 | Resident B | `GET products?seller_id=eq.73a46c8c-...` | deny | 200 `[]` | **PASS** for that seller (credits/approval path) |
| MK5 | Resident B | `GET products?limit=3` | own-society only | **200** three products including Greenfield sellers (`95d88378-...`, `0a670c2b-...`) | **FAIL** HIGH |
| MK6 | Resident B | `rpc/search_products_v2` `_buyer_society_id` = Greenfield | must not spoof home society | **200** `is_same_society: true`, `society_name: Shriram Greenfield Phase-2, Tower H` | **FAIL** HIGH |
| MK7 | Resident B | `PATCH seller_profiles` Greenfield `society_id` / `sell_beyond` | deny | 200 empty (0 rows) | **PASS** |
| MK8 | Resident B | `GET orders` | own only | 200 `[]` | **PASS** |
| MK9 | Resident B | `GET delivery_addresses` | own only | 200 own address id only | **PASS** (own row, not a leak) |
| MK10 | Radius bypass `search_nearby_sellers` | | | 403 function EXECUTE denied | **PASS** (grant) |

`sell_beyond_community` is not a hard gate on current `search_products_v2` (core from `20260923193000_search_products_v2_drop_society_exclusion.sql`). Client `_buyer_society_id` only affects `is_same_society` ranking - and that spoof **worked**.

### 2.4 Visitor Management

| ID | Identity | Operation | Expected | Actual | Verdict |
|---|---|---|---|---|---|
| V1 | Unauthenticated | `GET visitor_entries` Test A | deny/empty | 200 empty | **PASS** |
| V2 | Resident B | `GET visitor_entries` no filter | no other society | 200 `[]` (22 rows exist in other societies) | **PASS** |
| V3 | Resident B | `GET` Test A visitor `a3333333-0002-...` | empty | 200 `[]` | **PASS** |
| V4 | Resident B | `rpc/visitor_guard_redeem_otp` Test A unexpired OTP | deny | 403 `Not a guard for this society` | **PASS** |
| V5 | Resident B | `rpc/visitor_set_status` Test A `checked_in` | deny | 403 | **PASS** |
| V6 | Guard B redeeming Society A | | deny | no guard JWT | **NOT TESTED** |
| V7 | Replay / expiry | | deny | not executed (would need create + redeem) | **NOT TESTED** |
| V8 | Manipulate visitor `society_id` | | deny | table INSERT revoked | **PASS** (grant); RPC create **NOT TESTED** |
| V9 | Platform admin SELECT Test A visitor | allow | 200 | **PASS** (intended admin bypass, server-side `is_admin`) |

Greenfield Tower H has **0** visitor rows. Cross-society visitor data used Test Residency A (synthetic) and the older `Shriram Greenfield` society (7 expected, all expired).

### 2.5 Parking and other Pilot Ops

| ID | Identity | Operation | Expected | Actual | Verdict |
|---|---|---|---|---|---|
| P1 | Resident B | `GET parking_slots` no filter | not Greenfield | 200 `[]` (Greenfield has 2 slots: `80efb6fd-...`, `f00e7c2b-...`) | **PASS** cross-society SELECT |
| P2 | Resident B | `GET parking_slots?id=eq.80efb6fd-...` | empty | 200 `[]` | **PASS** |
| P3 | Resident B | `POST parking_slots` `{society_id: Greenfield, slot_number: PENTST-B1}` | deny | 403 `new row violates row-level security policy` | **PASS** |
| P4 | Resident B | `PATCH` Greenfield parking | deny | 200 empty | **PASS** |
| P5 | Direct query when feature disabled | | deny | Lakeview **has** `vehicle_parking`. Palm is disabled but has no resident JWT. Live policies have **no CAF** | **FAIL** by policy review (frontend-only entitlement). Cross-society still GUS-scoped |
| P6 | Parcels `e5092629-...` | empty | 200 `[]` | **PASS** |
| P7 | Notice `ea448671-...` | empty | 200 `[]` | **PASS** |
| P8 | `society_workers` / `gate_entries` / `manual_entry_requests` | empty | 200 `[]` | **PASS** |
| P9 | Platform admin GET Greenfield parking | allow | 200 with row | **PASS** intended bypass |

### 2.6 Administrative privileges

| ID | Identity | Operation | Expected | Actual | Verdict |
|---|---|---|---|---|---|
| A1 | Resident B | `POST user_roles {role: admin}` | deny | **201** row `4a5876e7-...` `role=admin`. Deleted immediately (204). | **FAIL** CRITICAL |
| A2 | Resident B | `PUT /auth/v1/user` `user_metadata.role=admin` `society_id=Greenfield` | metadata may change; backend must ignore | 200 metadata written; JWT `role` stayed `authenticated` | **INFO** |
| A3 | Resident B | `rpc/is_admin(self)` after metadata spoof (after role delete) | false | `false` | **PASS** vs JWT claims. Does **not** excuse A1 |
| A4 | Resident B | GET Greenfield parking after metadata spoof | empty | 200 `[]` | **PASS** (membership still Lakeview) |
| A5 | Resident B | `POST society_admins` Greenfield | deny | 403 | **PASS** |
| A6 | Resident B | `POST security_staff` Greenfield | deny | 403 | **PASS** |
| A7 | Resident B | `POST society_feature_overrides` Greenfield | deny | 400 | **PASS** |
| A8 | Resident B | `POST builder_societies` | deny | 403 | **PASS** |
| A9 | Resident B | `rpc/admin_assign_society_package` | deny | 400 `not authorized` | **PASS** |
| A10 | Unauthenticated | `rpc/is_admin(platform admin uuid)` | deny | **200 `true`** | **FAIL** HIGH (oracle) |
| A11 | Platform admin | `rpc/admin_assign_society_package` bogus ids | authorized then validate | 400 `package not found` | **PASS** server-side `is_admin` (not frontend) |

`merged_user_roles_insert` WITH CHECK:

```text
((user_id = auth.uid() AND role = 'buyer') OR (user_id = auth.uid()))
```

The second clause allows **any** `user_role` enum value (`buyer`, `seller`, `admin`) for self. PERMISSIVE OR with `Only admins can manage roles` does not block that INSERT.

---

## Phase 3 - RPC and Edge Function security

### 3.1 Confirmed live issues

**SSV-001 CRITICAL** - `profiles.society_id` client write. Trigger present, lock not enforced for this JWT path. Split brain: membership Lakeview, profile Greenfield until reverted. Marketplace RPCs that `COALESCE(_buyer_society_id, profiles.society_id)` will treat the attacker as a Greenfield buyer.

**SSV-002 CRITICAL** - `user_roles` self-insert `admin`. Backend `is_admin()` is exactly this table. Frontend `isAdmin` is not required.

**SSV-003 HIGH** - `get_user_auth_context(_user_id)` IDOR. Resident B received platform-admin profile fields (phone, email, `society_id`, roles `[admin, buyer, seller]`). File: `supabase/migrations/20260225060535_0921a057-f9fd-47b0-8c45-5f9b63dd0618.sql`.

**SSV-004 HIGH** - `get_user_society_id` / `has_active_society_membership` callable as oracles. Returned Greenfield society id / `true`.

**SSV-005 HIGH** - `is_admin` executable by `anon`. Confirmed `true` without a user JWT.

**SSV-006 HIGH** - `visitor_guard_redeem_otp` has **no rate limit**, 6-digit numeric OTP stored in plaintext, SELECT policy exposes `otp_code` to any member of that society. Guard UI still does client lookup:

```43:50:src/components/guard/GuardVisitorOTPTab.tsx
    const { data, error } = await supabase
      .from('visitor_entries')
      .select('*, resident:profiles!visitor_entries_resident_id_fkey(name)')
      .eq('society_id', societyId)
      .eq('otp_code', otpInput.trim())
```

`societyId` is a prop (frontend-controlled). Cross-society SELECT still failed for Lakeview, so this is intra-society OTP dump + kiosk prop spoof, not a cross-tenant read in this test.

**SSV-007 MEDIUM** - `visitor_set_status` allows the resident to mark their own entry `checked_in` without guard OTP (source). Cross-society call denied. Intra-society skip-OTP **NOT TESTED** (would mutate).

**SSV-008 HIGH** - `notify-help-request` Edge Function takes `societyId` / `authorId` from body, **no JWT** (source review). **NOT TESTED** live (would fan out pushes).

**SSV-009 MEDIUM** - `convert_bulletin_post_to_snag(..., _auto := true)` skips author/admin (source). **NOT TESTED** live.

**SSV-010 MEDIUM** - `conversations_is_member` EXECUTE missing for `authenticated`, so table SELECT errors instead of returning empty. Isolation holds; admin cannot read via PostgREST either. Chat RPCs are DEFINER and still run for members.

**SSV-011 LOW** - `get_effective_society_features` / `can_access_feature` have no membership check. Feature catalog of any society is readable.

Search path on reviewed DEFINER functions is `public` (not `pg_catalog, public` in all cases, but `SET search_path TO 'public'` is present on the membership/visitor set). Rate limit RPCs that write `rate_limits` are VOLATILE as required (`request_society_membership`, `decide_society_membership`, `admin_assign_society_package`).

`gate-token` still uses `profiles.society_id` for generate (source). **NOT TESTED** live.

Production visitor path in the same kiosk file still `update visitor_entries` from the client when `IS_STAGING_SUPABASE` is false. That is a production concern, not a staging JWT result.

---

## Phase 4 - Feature entitlement

### 4.1 Package contents (staging live)

Sociva Core: `marketplace`, `bulletin`, `smart_groups`, `conversations`, `disputes`, `finances`, `maintenance`, `domestic_help`, `helphub`, `cleaner_city`.

Sociva Pilot Ops: Core plus `visitor_management`, `authorized_persons`, `guard_kiosk`, `gate_entry`, `parcel_management`, `vehicle_parking`, `society_notices`, `workforce_management`, `worker_marketplace`, `worker_attendance`, `worker_leave`, `worker_salary`, `construction_progress`, `snag_management`, `inspection`, `payment_milestones`, `delivery_management`, `society_reports`, `monthly_report_card`, and related ops keys listed in the SQL dump.

Palm Breeze: `visitor_management=false`, `vehicle_parking=false`, `marketplace=true`.
Lakeview and Greenfield Tower H: Pilot Ops (visitors and parking true).

### 4.2 Enforcement matrix

| Check | Result |
|---|---|
| 1. Enabled A, disabled B (Palm) | Catalog true (SQL `can_access_feature`) |
| 2. Society B cannot access disabled feature through UI | **NOT TESTED** this pass (no Palm JWT; both tested societies are Pilot) |
| 3. Direct URLs | Frontend `FeatureGate` / `useEffectiveFeatures` only. **NOT TESTED** in browser this pass |
| 4. Direct API when disabled | Parking/notices RLS often **GUS only**, not CAF. **FAIL** as design |
| 5. Read/modify DB records when disabled | Same. Intra-society parking INSERT is allowed whenever GUS matches |
| 6. Enabling B does not expose A | GUS still scopes rows. **PASS** as design; not live-toggled |
| 7. Removing entitlement vs existing session | `can_access_feature` is live SQL, but UI `isAdmin` bypasses until refetch. JWT is not the source of `is_admin`. **NOT TESTED** by toggling packages |

Frontend-only gates (not authorization):

- `src/hooks/useEffectiveFeatures.ts` `if (isAdmin) return true`
- `src/App.tsx` admin / society / worker wrappers
- `useSocietyEntryVisible`
- Bulletin/snag `canModerate` in UI

Platform admin bypass of **data** is server-side `is_admin(auth.uid())` in many SELECT policies. That is intended. Combined with SSV-002 it is a privilege-escalation path, not a UI-only issue.

---

## Phase 5 - Staging versus production

Full migration analysis: `docs/audits/SOCIVA_PRODUCTION_MIGRATION_READINESS.md`.

Headline (read-only production snapshot taken during this audit, no writes):

| Item | Staging `wwuanzbusxoyzixuprxs` | Production `kkzkuyhgdvyecmxtmkpy` |
|---|---|---|
| `society_memberships` | yes, FORCE RLS | **does not exist** |
| `request_society_membership` / `decide_society_membership` | yes | **no** |
| `visitor_create_entry` / `visitor_guard_redeem_otp` | yes | **no** |
| `get_user_society_id` | active membership | `SELECT society_id FROM profiles` |
| `visitor_entries` policies | SELECT society + feature; writes revoked | **SELECT only** (`Society members can view visitor entries`) |
| `profiles` SELECT | same-society (global policy dropped) | **`Users can view all approved profiles` still live** |
| Public RLS policy count | 583 | 593 |

Staging JWT results **must not** be assumed on production.

---

## Phase 6 - Visitor Management readiness (staging)

Compared with a MyGate-style resident/guard loop.

| Capability | State | Evidence |
|---|---|---|
| Resident creates pre-approved pass | Implemented (RPC `visitor_create_entry`, server OTP, 24h expiry) | Source `20261123220100_go_vm_visitor_rls_rpcs_staging.sql`. Create **NOT TESTED** this pass (write) |
| Apartment / occupancy check | Partial | RPC uses caller membership society, not a verified unit occupancy table |
| Guard assigned to society | Implemented in RPC (`security_staff` or society/platform admin) | Redeem as resident: `Not a guard for this society` |
| OTP security | Partial | Server-generated 6-digit, stored plaintext, no hash, no RPC rate limit |
| Token expiration | Implemented in RPC (`otp_expires_at > now()`) | Expired Greenfield (non-Tower H) rows exist; not redeemed |
| Replay protection | Implemented as status flip to `checked_in` | **NOT TESTED** |
| Walk-in approval | Partial | `manual_entry_requests` GUS RLS; Authorized Persons **not** in redeem RPC |
| Entry/exit audit | Partial | `gate_entries` + visitor status timestamps; FORCE RLS on gate |
| Authorized Persons in kiosk | **Missing** | Table + `AuthorizedPersonsPage` exist. `visitor_guard_redeem_otp` does not consult `authorized_persons` |
| Society isolation | **PASS** for tested SELECT/redeem | Lakeview JWT saw 0 of 22 visitor rows |
| Rate limiting | Missing on visitor RPCs | Membership RPCs are limited; visitor create/redeem are not |
| Offline / poor network | **NOT TESTED** | No offline queue in kiosk |

**Do not expose Visitor Management to real residents** until SSV-001, SSV-002, OTP hashing/rate-limit, guard JWTs, and Authorized Persons kiosk checks are fixed and retested.

---

## Phase 7 - Performance (membership and entitlement)

Not a hardware recommendation. Observed from live indexes and policy shape:

| Issue | Evidence | Risk |
|---|---|---|
| `get_user_society_id` in almost every hub policy | STABLE DEFINER, unique index `society_memberships_one_active_user` | Per-statement cache helps; still a sequential helper on every row check |
| No index on `visitor_entries(society_id, otp_code)` | Indexes: society+created, society+status, resident_id, pkey | Guard OTP lookup and brute force are seq scans; 6-digit space |
| `get_effective_society_features` / `can_access_feature` unauthenticated to any JWT | No membership predicate | Extra catalog reads, not the main RLS cost |
| Advisor `authenticated_security_definer_function_executable` = 360 | DEFINER surface | Each call bypasses RLS of underlying tables |
| Chat policy calls `conversations_is_member` | Missing EXECUTE -> 403 | Broken SELECT path; RPCs still used by UI |
| N+1 entitlement in UI | `useEffectiveFeatures` plus per-component `FeatureGate` | Client-side; does not replace RLS |

Do not scale CPU/RAM to paper over SSV-001/002 or plaintext OTP.

---

## Findings register

| ID | Sev | Finding |
|---|---|---|
| SSV-001 | CRITICAL | Non-admin JWT can `PATCH profiles.society_id`. Trigger does not stop PostgREST. |
| SSV-002 | CRITICAL | Non-admin JWT can `INSERT user_roles.role = admin`. Backend `is_admin()` follows that row. |
| SSV-003 | HIGH | `get_user_auth_context` IDOR of any profile + roles + seller rows. |
| SSV-004 | HIGH | `get_user_society_id` / `has_active_society_membership` IDOR oracles. |
| SSV-005 | HIGH | Anon `is_admin(uuid)` oracle. |
| SSV-006 | HIGH | Visitor OTP plaintext + no redeem rate limit + client `otp_code` filter. |
| SSV-007 | MEDIUM | Resident `visitor_set_status` can skip guard OTP (source). |
| SSV-008 | HIGH | `notify-help-request` unauthenticated `societyId` (source). NOT TESTED live. |
| SSV-009 | MEDIUM | `convert_bulletin_post_to_snag _auto` skips author (source). NOT TESTED live. |
| SSV-010 | MEDIUM | `conversations_is_member` EXECUTE denied; table SELECT 403. |
| SSV-011 | LOW | Feature catalog RPCs have no membership check. |
| SSV-012 | HIGH | Approved `seller_profiles` globally readable, including `sell_beyond_community=false`. Bank columns selectable. |
| SSV-013 | HIGH | `search_products_v2` accepts spoofed `_buyer_society_id` and sets `is_same_society`. |
| SSV-014 | HIGH | `products` SELECT returns other societies' catalog to a Lakeview JWT. |
| SSV-015 | HIGH | Parking / several ops tables have **no** `can_access_feature` in live policies. UI gate only. |
| SSV-016 | MEDIUM | PERMISSIVE leftover feature-gate writes on notices / manual entry / workforce (migrations). Live merge state not fully row-tested. |
| SSV-017 | HIGH | Production membership model is not this model. Staging PASS != production PASS. |
| SSV-018 | LOW | `builder_societies` SELECT `USING (true)`. |
| SSV-019 | PASS | Hub SELECT isolation (parking, parcels, notices, visitors, workers, gate, bulletin empty) for Lakeview vs Greenfield. |
| SSV-020 | PASS | Chat open/send RPCs reject cross-society. |
| SSV-021 | PASS | Membership RPC one-active rule and `decide` authz. |
| SSV-022 | PASS | `admin_assign_society_package` server-side `is_admin`. |
| SSV-023 | PASS | Visitor redeem/set_status reject non-guard / other society. |
| SSV-024 | PASS | JWT `user_metadata` spoof does not set `is_admin()` (once `user_roles` is clean). |
| SSV-025 | PASS | One-active unique index present; do not drop it. |
| SSV-026 | NOT TESTED | Resident A, pending, suspended, real guards, Palm Core-only JWT, visitor create/replay, storage objects, `notify-help-request`, offline kiosk. |

---

## FINAL GO / NO-GO

**NO-GO**

Do not promote this staging architecture to production. Do not put Visitor Management in front of real residents.

A resident from Society B **cannot** currently read Society A's parking, parcels, notices, or visitor rows through PostgREST. That is necessary and not sufficient. The same resident **can**:

- rewrite `profiles.society_id` to Society A
- grant themselves `user_roles.admin`
- read another user's society id and full `get_user_auth_context`
- read approved sellers and products that belong to Society A, including `sell_beyond_community=false`
- spoof `_buyer_society_id` on `search_products_v2`

Those are database/API failures, not UI gaps.

Next work (when you explicitly ask to fix, still staging only): close SSV-001 and SSV-002 first, then DEFINER IDOR grants, then marketplace SELECT/RPC, then visitor OTP hashing + rate limit + Authorized Persons. Retest with a disposable non-admin Greenfield JWT, a pending JWT, a suspended JWT, and a guard JWT - created only with approval.
