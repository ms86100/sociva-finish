# SOCIVA - Multi-Tenant Society Isolation & Production Safety Audit

| Field | Value |
|---|---|
| Report ID | `SOCIVA-MTSA-2026-11-23` |
| Mode | **READ-ONLY** (no code, schema, policy, env, or deploy changes) |
| Production Supabase | `kkzkuyhgdvyecmxtmkpy` (project name: Sociva) |
| Staging Supabase | `wwuanzbusxoyzixuprxs` (branch `onboarding-integration` of production) |
| Spare project | `twnhqhkfcniffyjluryp` (`sociva-integration`, spare empty) |
| Audit date (UTC) | 2026-11-23 |
| Subagent pass | Grok 4.7 explore (`9d3fffea-5ca8-4bd4-912e-ce7299d7f39c`) + live SQL re-verify |

**Classification legend:** CRITICAL | HIGH | MEDIUM | LOW | PASS | NOT VERIFIED

---

## 1. Executive summary

Sociva has **partial multi-tenant foundations** (society registry, builder packages, `society_id` columns, many RLS policies using `get_user_society_id`, conversation RPCs that enforce same-society + feature gates). It does **not** yet implement the full **Society → Membership → Permissions → Features → Data Access** model required before a safe Visitor Management launch.

**Verdict: NO-GO for Visitor Management production launch and NO-GO for treating the platform as securely multi-tenant today.**

Begin remediation only in **staging** (`wwuanzbusxoyzixuprxs`), with two independent test societies, then promote with reviewed migrations.

### Headline production facts (live SQL, `kkzkuyhgdvyecmxtmkpy`)

| Metric | Value |
|---|---|
| Societies total | 242 |
| Societies `is_active` | 8 |
| Societies `is_verified` | 6 |
| Profiles approved / pending | 19 / 230 |
| Distinct `profiles.society_id` values | 215 |
| `society_memberships` table | **Does not exist** |
| `visitor_entries` / `gate_entries` rows | 0 / 0 |
| `visitor_entries` RLS INSERT/UPDATE/DELETE policies | **None** (SELECT only) |
| `search_products_v2` enforces `sell_beyond_community` | **No** (live function body) |
| `seller_is_discoverable_to_buyer` enforces home-society / opt-in | **No** (distance only) |

### Top CRITICAL findings

1. **Onboarding creates / joins societies without an approved-registry gate** - users can create inactive societies via `validate-society` and assign `profiles.society_id` from the client.
2. **No membership lifecycle table** - membership is a single nullable `profiles.society_id` + `verification_status`; pending/suspended/removed memberships are not modeled as required.
3. **Marketplace discovery path bypasses `sell_beyond_community`** on the primary search RPC and discoverability helper.
4. **`products` RLS allows SELECT of all approved products** without society membership scoping (REST can read marketplace catalog cross-tenant).
5. **Visitor Management writes are not RLS-complete on production** - live `visitor_entries` has SELECT only; UI still inserts/updates from the client JWT. Repo migrations still define INSERT/UPDATE (prod/repo drift).

### Grok 4.7 additions (confirmed or live-verified)

| ID | Severity | Finding |
|---|---|---|
| MTSA-015 | HIGH | Invite gate is client-only; active societies SELECT can expose `invite_code`; Edge/trigger never check invite |
| MTSA-016 | HIGH | `findNearestSociety` / seller linking can attach any society within 15 km without active/verified filter (`src/lib/seller-society.ts`) |
| MTSA-017 | HIGH | Visitor OTP minted in browser (`useVisitorManagement.ts` `generateOTP`) and matched by direct `otp_code` filter |
| MTSA-018 | HIGH | `gate_entries` feature policies are PERMISSIVE OR; disabling visitor/guard UI flags does not block `soc_insert_gate` |
| MTSA-019 | HIGH | `get_user_society_id` ignores `verification_status` and society active state - bulletin RLS uses it raw |
| MTSA-020 | HIGH | Hardcoded Greenfield IDs/names in shipping paths (`food-discovery.ts`, `khatmitthi-promo.ts`, seed migrations) |
| MTSA-021 | HIGH process | Repo vs prod policy drift: visitor write policies exist in migrations but not on live prod |

### Live vs repo corrections (do not treat migrations as prod truth)

| Claim | Repo migrations | Live prod (`kkzkuyhgdvyecmxtmkpy`) |
|---|---|---|
| `visitor_entries` INSERT/UPDATE | Defined in 2026-02 migrations | **SELECT only** (re-verified) |
| `auto_approve_resident` | Later migration always sets approved | **Flag-based** (`societies.auto_approve_residents`) - matches draft |
| `bulletin_votes` SELECT | Society-scoped in an early migration | **`USING (true)`** policy `Anyone can view vote counts` |
| `society_features` SELECT | Society-scoped in an early migration | **`USING (true)`** policy `Society members can view features` |
| `societies` SELECT | Intermediate migration used `USING (true)` | **`is_active = true OR admin`** (invite still readable on active rows) |
| `search_products_v2_core` | Gap-close migration renames/wraps | **0** functions named `search_products_v2_core` on prod |

---

## 2. Existing architecture and data flow

```text
Resident App (Vite SPA / Capacitor)
  ├─ Vercel CDN (static + SPA rewrites) ── vercel.json
  └─ Supabase API Gateway
       ├─ Auth (OTP / GoTrue)
       ├─ PostgREST + RLS
       ├─ Edge Functions (validate-society, gate-token, OTP, payments, ...)
       ├─ Realtime
       └─ Storage

Intended model (target):
  Platform Admin → Approved Society Registry → Membership → Permissions → Features → Data

Observed model (today):
  Google Maps / search → resolve_society / validate-society (may CREATE society)
    → client UPDATE profiles.society_id (NULL→value allowed)
    → verification_status pending|approved (auto_approve_resident trigger optional)
    → get_user_society_id(auth.uid()) used by many RLS policies
    → feature UI via get_effective_society_features (frontend FeatureGate)
```

### Trust boundary gap

**Non-negotiable principle from product architecture:** never trust the society selected by the user; trust backend-verified membership.

**Observed:** society selection and often first assignment are client-driven. `validate-society` returns `valid: true` for any existing society id without requiring `is_active` / `is_verified`. Client then writes `profiles.society_id`.

Evidence:

- `supabase/functions/validate-society/index.ts` lines 117-169 (create with `is_verified: false`, `is_active: false`), lines 191-214 (validate existing without active/verified gate)
- `src/hooks/useAuthPage.ts` lines 612-631 (`profiles.update({ society_id })` after optional validate)
- `src/lib/resolve-profile-society.ts` lines 261-275 (`assignSocietyIdToProfile` client update)

---

## 3. Existing working security controls

| Control | Status | Evidence |
|---|---|---|
| RLS enabled on almost all public tables | PASS (broad) | Live `pg_class.relrowsecurity` - nearly all tables `true`; note `buyer_awareness_exclusions_20261116` = false |
| `profiles.society_id` locked after first set | PASS (partial) | Trigger `trg_guard_profile_privileged_columns` / `guard_profile_privileged_columns()` - migration `supabase/migrations/20260807240200_phase0_admin_governance.sql` lines 10-49; first NULL→value still allowed |
| Conversations same-society + approved resident + feature gate | PASS | Live `conversations_open_or_request` - requires `get_user_society_id`, `can_access_feature(..., 'conversations')`, both parties `conversations_is_approved_resident` |
| Bulletin posts society-scoped SELECT/INSERT | PASS | Policies use `society_id = get_user_society_id(auth.uid())` |
| HelpHub listings society-scoped SELECT | PASS | `helphub_listings_select` scopes by `get_user_society_id` |
| Gate / security / parcel tables society WITH CHECK on INSERT | PASS (partial) | `soc_insert_gate`, `soc_insert_security`, `soc_insert_parcels` use `get_user_society_id` |
| Feature package model exists | PASS (schema) | `platform_features`, `feature_packages`, `builder_feature_packages`, `builder_societies`, `society_feature_overrides`, RPC `get_effective_society_features` |
| Seller society link helpers | PASS (app layer) | `src/lib/seller-society.ts` `ensureSellerSocietyForSubmit`; `src/lib/seller-approval.ts` `ensureSellerSocietyLinked` |
| Staging vs production Supabase separation | PASS | Branch `onboarding-integration` → `wwuanzbusxoyzixuprxs`; docs `docs/STAGING-TESTFLIGHT-ISOLATION.md`, `docs/INTEGRATION.md`; assert scripts `scripts/assert-supabase-env.cjs` |
| Cross-society RLS e2e harness exists | PASS (tooling) | `e2e/cross-society-rls.spec.ts` |
| Edge rate limiting shared module | PASS (infra) | `supabase/functions/_shared/rate-limiter.ts` (Redis then Postgres `rate_limits`) |

---

## 4. Missing security controls

| Gap | Severity | Notes |
|---|---|---|
| Approved-only join registry enforcement | CRITICAL | Users create/join non-active societies; 242 societies / 8 active |
| Membership request + statuses (pending/active/rejected/suspended/removed) | CRITICAL | No `society_memberships` (prod + staging) |
| Backend enforcement that disabled features cannot be hit via REST/RPC | HIGH | Frontend `FeatureGate` / `useEffectiveFeatures`; few Edge checks (`manage-delivery` only among functions grep) |
| Marketplace default home-society + opt-in radius on primary search path | CRITICAL | Live `search_products_v2` / `seller_is_discoverable_to_buyer` |
| Products RLS society scope | HIGH | Policy allows any authenticated user to read approved catalog |
| Profiles directory society scope | HIGH | Policy "Users can view all approved profiles" - not society-scoped |
| Visitor write RLS + society-bound RPCs | CRITICAL for VM launch | SELECT only on `visitor_entries` |
| Suspended / rejected membership session kill | HIGH | No membership suspension model |
| Immutable visitor audit log model | MEDIUM | Tables exist partially; no immutable log design verified |
| Single canonical Greenfield society hygiene | HIGH | Many duplicate inactive Shriram Greenfield* rows from Maps create path |
| Server-side invite enforcement | HIGH | Client-only invite compare; active row can expose `invite_code` |
| Nearest-society assignment without approval | HIGH | `findNearestSociety` 15 km path |
| Server-issued visitor OTP / tokens | HIGH | Browser-minted OTP on `visitor_entries` |
| Restrictive feature gates on gate_entries | HIGH | Permissive OR with `soc_insert_gate` |
| Approved-only in `get_user_society_id` consumers | HIGH | Pending users pass many society RLS policies |
| Remove hardcoded Greenfield IDs from product paths | HIGH | food-discovery / khatmitthi defaults |

---

## 5. Vulnerabilities and severity

### MTSA-001 - Society create / join without approved registry (CRITICAL)

**Evidence:** `validate-society` inserts societies with `is_active: false`, `is_verified: false` (`supabase/functions/validate-society/index.ts` 117-131). Auth flow assigns that id to the profile (`useAuthPage.ts` 628-631). Live DB: 242 societies, 8 active; many duplicate Greenfield names with `is_active=false`.

**Impact:** Google Maps discovery becomes an authorization path. Residents land in unapproved / duplicate tenants. Cross-tenant data partitions become meaningless if "society" rows are user-created sprawl.

**Fix direction:** Approved registry is sole joinable set; Maps is discovery only; create requests stay pending for Platform Admin; never auto-activate membership on create.

### MTSA-002 - No membership table / lifecycle (CRITICAL)

**Evidence:** `to_regclass` / information_schema - no `society_memberships`. Membership = `profiles.society_id` + `verification_status`. Statuses pending/active/rejected/suspended/removed for membership are absent.

**Impact:** Cannot revoke access cleanly, cannot keep pending users out of resident-only modules consistently, cannot support multi-society membership later.

### MTSA-003 - Client-trusted first society assignment (HIGH)

**Evidence:** `guard_profile_privileged_columns` allows NULL→set (`20260807240200_phase0_admin_governance.sql` 23-30). Assignment via client `profiles.update` without server-side membership RPC that checks approved + invite + verification workflow.

**Impact:** Attacker with a valid JWT can attach to any society UUID they know (including inactive) on first assignment.

### MTSA-004 - `validate-society` does not require active/verified (HIGH)

**Evidence:** Existing-id path returns `valid: true` with raw `is_active`/`is_verified` flags but does not reject inactive (`validate-society/index.ts` 191-214). Callers still proceed to assign.

### MTSA-005 - Marketplace discovery ignores `sell_beyond_community` on primary path (CRITICAL)

**Evidence (production live functions):**

- `seller_is_discoverable_to_buyer`: eligible + `distance <= delivery_radius_km` only - **no** `sell_beyond_community`, **no** same-society default.
- `search_products_v2`: uses discoverability OR allows rows when lat/lng null (`OR (_lat IS NULL OR _lng IS NULL)`).
- Contrast: `search_nearby_sellers` **does** require `sell_beyond_community = true` for cross-society.

**Impact:** Opt-in cross-society marketplace model is not enforced on the main search path. Sellers with `delivery_radius_km > 0` are radius-discoverable regardless of opt-in flag. Direct product SELECT RLS also exposes approved catalog.

### MTSA-006 - Products RLS not society-scoped (HIGH)

**Evidence:** Policy `Anyone can view available products from approved sellers` - approval + seller verification + credit activation only.

**Impact:** Any logged-in user can REST-select marketplace products across societies. App filters are not a security boundary.

### MTSA-007 - Profiles "view all approved" (HIGH)

**Evidence:** Policy `Users can view all approved profiles` - `verification_status = 'approved' OR self OR admin`.

**Impact:** Cross-society resident directory leakage (names, flats, phones depending on column grants / select * usage).

### MTSA-008 - Feature entitlements mostly frontend (HIGH)

**Evidence:**

- `src/hooks/useEffectiveFeatures.ts` 87-101 hardcodes marketplace-domain features always enabled; society features gated in UI.
- Grep of `supabase/functions/**/*.ts` for `is_feature_enabled_for_society` - essentially only `manage-delivery`.
- Positive counterexample: conversations RPC uses `can_access_feature`.

**Impact:** Disabling Smart Groups / Visitor Management in admin config does not reliably block direct API access.

### MTSA-009 - Visitor Management incomplete RLS (CRITICAL for launch)

**Evidence:**

- Tables exist: `visitor_entries`, `visitor_types`, `gate_entries`, `security_staff`, `authorized_persons`, `parcel_entries`.
- `visitor_entries` policies: SELECT society-scoped only; **no INSERT/UPDATE/DELETE**.
- Frontend writes: `src/hooks/useVisitorManagement.ts` 128-156 inserts/updates via user client.
- Zero production visitor/gate rows (feature unused or writes failing).

**Impact:** Either writes fail closed (broken product) or a future hasty policy could open cross-society writes. Not ready for tomorrow's launch.

### MTSA-010 - Chat legacy table vs conversations (MEDIUM)

**Evidence:** `chat_messages` policies are sender/receiver based, not society-scoped. Newer `conversations*` stack is society-scoped via DEFINER RPCs.

**Impact:** If legacy DM paths remain reachable, society isolation depends on callers never messaging cross-society users (no society check on INSERT beyond `sender_id = auth.uid()`).

### MTSA-011 - `bulletin_votes` / `bulletin_rsvps` SELECT true (MEDIUM)

**Evidence:** Policies `Anyone can view vote counts` / RSVP select `true`.

**Impact:** Cross-society metadata leakage if IDs are guessable; posts themselves are society-scoped.

### MTSA-012 - Society feature config readable by all (`society_features` SELECT true) (LOW)

**Evidence:** Policy `Society members can view features` with `qual = true`.

### MTSA-013 - Duplicate / inactive society sprawl (HIGH operational)

**Evidence:** Live societies list includes many inactive variants of Shriram Greenfield / Lagumenahalli Circle created via Maps path.

**Impact:** Breaks "one tenant = one society" operational model; Greenfield must not be hardcoded, but must be a single approved tenant record.

### MTSA-014 - Staging/prod migration drift (HIGH process)

**Evidence:** Staging has `search_products_v2` + `search_products_v2_core` procedure names; production has **0** `search_products_v2_core` functions. Live `search_products_v2` is the full search body. Gap-close wrapper migration not applied to prod the same way. Both envs: discoverability still lacks `sell_beyond`. Visitor write policies present in repo, absent on prod.

**Impact:** Staging tests may not match production behavior; promotions need explicit parity checks.

### MTSA-015 - Invite code is not a server authorization boundary (HIGH)

**Evidence:** `useAuthPage.ts` 603-606 compares invite against client-loaded `selectedSociety.invite_code`. `checkInviteGate` in `resolve-profile-society.ts` 217-250 is a client SELECT. `validate-society` and `guard_profile_privileged_columns` never check invite. Live societies SELECT allows reading active society rows (including `invite_code` if selected).

**Impact:** UI invite gate can be skipped by direct `profiles.society_id` first-assign.

### MTSA-016 - Nearest-society seller linking ignores approval (HIGH)

**Evidence:** `src/lib/seller-society.ts` `findNearestSociety` loads societies with coordinates without requiring `is_active`/`is_verified`, within 15 km, then writes `profiles.society_id`. `ensureSellerSocietyLinked` only requires some `society_id`.

**Impact:** Violates "Maps/nearby is discovery, not authorization."

### MTSA-017 - Visitor OTP minted client-side (HIGH)

**Evidence:** `src/hooks/useVisitorManagement.ts` 56-60 `generateOTP()` using `crypto.getRandomValues`; OTP stored via client insert and shown in toast. Guard paths match `otp_code` with user JWT queries.

**Impact:** OTP is not a server-issued capability token; weakens gate trust vs `gate-token` HMAC path.

### MTSA-018 - Gate feature flags are permissive OR (HIGH)

**Evidence:** `gate_entries` feature_gate policies created PERMISSIVE (`20260222150805_*.sql`). Live prod still has `soc_insert_gate` PERMISSIVE. Disabling `visitor_management` / `guard_kiosk` in UI does not negate society-scoped insert policy.

### MTSA-019 - Pending residents pass society-scoped RLS (HIGH)

**Evidence:** Live `get_user_society_id` = `SELECT society_id FROM profiles` only. Bulletin and many policies use it without `verification_status = 'approved'`. Conversations RPC is the exception.

**Impact:** Pending membership is not a reliable access deny for society data.

### MTSA-020 - Hardcoded Greenfield tenant assumptions (HIGH operational)

**Evidence:** `src/lib/food-discovery.ts` hardcoded society/seller UUIDs; `src/lib/khatmitthi-promo.ts` and Edge shared copy default `Shriram Greenfield`; seed migration pins historical UUID. Conflicts with "Greenfield is first customer, not a special case."

---

## 6. Table-by-table RLS assessment (priority surfaces)

| Table / family | `society_id`? | RLS | Society isolation | Notes | Grade |
|---|---|---|---|---|---|
| `societies` | n/a | Yes | Registry open SELECT for active; INSERT by any auth | Users can request/create via Edge service role | HIGH risk on create path |
| `profiles` | Yes | Yes | Weak - SELECT all approved; society_id lock after set | Membership surrogate | CRITICAL model gap |
| `society_features` / overrides | Yes | Yes | SELECT overly open | Entitlement store exists | MEDIUM |
| `bulletin_posts` | Yes | Yes | SELECT/INSERT scoped | Smart Groups surface | PASS |
| `conversations*` | Yes | Member + DEFINER RPCs | Strong on RPC path | Good pattern to copy | PASS |
| `chat_messages` | No | Yes | Peer-only, not society | Legacy | MEDIUM |
| `products` | Optional | Yes | **Not society-scoped SELECT** | Catalog leak | HIGH |
| `seller_profiles` | Yes | Yes | Approved sellers visible broadly | Discovery helper incomplete | HIGH |
| `orders` | via parties | Yes | Buyer/seller ownership | OK for txn privacy; not society ACL | PASS (txn) |
| `delivery_addresses` | optional | Yes | Owner-only | OK | PASS |
| `helphub_listings` | Yes | Yes | Society + feature gate on some cmds | Better pattern | PASS |
| `visitor_entries` | Yes | Yes | SELECT only | Writes broken / unsafe | CRITICAL |
| `visitor_types` | Yes | Yes | SELECT scoped | | PASS (read) |
| `gate_entries` | Yes | Yes | INSERT/SELECT society | Guard path via Edge service role also | PARTIAL PASS |
| `security_staff` | Yes | Yes | INSERT/SELECT/UPDATE society | No DELETE policy noted | PARTIAL PASS |
| `device_tokens` | No | Yes | Owner-only | OK | PASS |
| `notification_queue` | varies | Yes | Service/processing | Fair-use elsewhere | NOT fully audited |
| Storage buckets | path-based | NOT VERIFIED live | - | Needs dedicated storage policy dump | NOT VERIFIED |

---

## 7. API and Edge Function assessment

| Function / RPC | Society auth | Feature gate | Rate limit | Notes |
|---|---|---|---|---|
| `validate-society` | Auth required | N/A | Yes (create 3/h, validate 20/min) | Creates unverified societies; no approved-only gate |
| `gate-token` | Service role inserts | Partial | Yes | Sensitive; must stay society-bound |
| `msg91-send-otp` / `verify-otp` | Auth flow | N/A | Yes | |
| Payments (Razorpay create/confirm) | Order ownership | N/A | Yes fail-closed pattern | |
| `conversations_*` RPCs | Strong | Yes (`conversations`) | Daily pending cap | **Reference implementation** |
| `search_products_v2` | Buyer society optional arg | No | Staging wrapper may add `sociva_assert_rate_limit`; prod body unaudited as wrapper | Discoverability gap |
| `search_nearby_sellers` | Buyer society id | N/A | NOT VERIFIED | Correctly uses `sell_beyond_community` |
| `get_effective_society_features` | DEFINER, takes society id | n/a | - | Callable with arbitrary society id (info disclosure LOW) |
| `is_feature_enabled_for_society` | DEFINER | - | - | Underused by Edge |
| Most other Edge functions | Mixed | Rarely | Partial coverage | Do not assume RL |

---

## 8. Society onboarding and membership assessment

| Requirement | Result | Evidence |
|---|---|---|
| Only Platform-Admin-approved societies joinable | **FAIL** | Create path + inactive assignable |
| Google Maps discovery only, not auth | **FAIL** | Maps → create/match → profile society_id |
| Users cannot create arbitrary society records | **FAIL** | `validate-society` service-role insert |
| Users cannot join unapproved societies | **FAIL** | No active/verified requirement on assign |
| No automatic active resident on select | **PARTIAL** | `verification_status` may stay pending unless `auto_approve_residents` | Trigger `auto_approve_resident` |
| Membership verification server-side | **PARTIAL** | Admin approval of `verification_status`; not a membership request workflow |
| Suspended/rejected/removed blocked | **FAIL** | Statuses not modeled for membership |
| society_id not client-manipulable after set | **PASS** | Guard trigger |
| First society_id not client-manipulable | **FAIL** | NULL→value allowed from client |

**Membership statuses (requested vs actual):**

| Status | Access (target) | Actual |
|---|---|---|
| Pending | No resident-only | Approx via `verification_status=pending` - **inconsistent enforcement** across modules |
| Active | Authorized | Approx `approved` |
| Rejected / Suspended / Removed | No access | **Missing** |

---

## 9. Feature entitlement assessment

**Sources of truth found:**

1. `platform_features` + packages + `builder_societies` + `society_feature_overrides` + RPC `get_effective_society_features`
2. Frontend `useEffectiveFeatures` / `FeatureGate`
3. Sparse backend `can_access_feature` / `is_feature_enabled_for_society`

**Conflicts:**

- Frontend forces marketplace-domain keys always on (`useEffectiveFeatures.ts` 87-97) even if society override would disable.
- Disabling `smart_groups` / `visitor_management` hides nav but does not universally block REST.
- Helphub / bulletin category policies show the **right pattern** (feature_gate_* policies) - not applied consistently to visitors.

**Recommendation:** Extend existing builder/admin entitlement model; do **not** invent a second flag system. Add RLS/RPC/Edge asserts mirroring `can_access_feature`.

---

## 10. Marketplace visibility assessment

| Rule | Expected | Actual | Grade |
|---|---|---|---|
| Default visibility = seller home society | Required | Not enforced on `search_products_v2` / discoverability helper | CRITICAL |
| Opt-in cross-society | `sell_beyond_community` | Column exists; honored by `search_nearby_sellers` and older migrations; **not** by live discoverability helper | CRITICAL |
| Radius | `delivery_radius_km` / `service_radius_km` | Used as distance gate; also treated as eligibility (`delivery_radius_km > 0`) | PARTIAL |
| Cross-society must not expose private society data | Required | Product/seller public fields exposed via RLS SELECT | HIGH |
| Orders/addresses protected | Required | Owner/party RLS | PASS |
| Seller society linking on submit | Required | `ensureSellerSocietyForSubmit` / `ensureSellerSocietyLinked` | PASS (app) |

---

## 11. Visitor Management readiness

| Concern | Status |
|---|---|
| Tables with `society_id` | Partially present (`visitor_entries`, `gate_entries`, `security_staff`, `visitor_types`) |
| Recommended tables (`visitor_requests`, `visitor_approvals`, `visitor_logs`, `guard_assignments`, `visitor_access_tokens`) | **Not present as named model** - OTP fields embedded on `visitor_entries`; gate via `gate-token` |
| Resident approve only own flat/society | Intended in UI filters; **RLS writes missing** |
| Guard restricted to assigned society | `security_staff.society_id` + some policies; guard UI uses client queries - needs hardening |
| Token not cross-society | Depends on `gate-token` implementation - NOT fully line-audited this pass |
| Immutable entry/exit audit | NOT VERIFIED / missing dedicated immutable log |
| Suspended residents blocked | No membership suspension |
| Feature flag backend enforcement | Frontend `FeatureGate` only for page |
| Production data | Empty - no live VM traffic |

**Architectural blockers before implementation/launch:**

1. Membership + approved society foundation (Phases 1-3 of remediation).
2. Complete RLS for visitor writes (INSERT/UPDATE) scoped by `get_user_society_id` + resident_id/guard role.
3. Prefer SECURITY DEFINER RPCs (conversation pattern) over raw client inserts for OTP generation.
4. Guard assignment table + RLS.
5. Cross-society e2e matrix including visitor tables.

---

## 12. Staging / production isolation assessment

| Check | Result | Evidence |
|---|---|---|
| Separate staging Supabase | PASS | Branch project `wwuanzbusxoyzixuprxs` |
| Separate prod | PASS | `kkzkuyhgdvyecmxtmkpy` |
| Spare empty project | PASS | `twnhqhkfcniffyjluryp` |
| Env assert scripts | PASS | `scripts/assert-supabase-env.cjs`, npm `assert:staging` / `assert:production` |
| Codemagic staging vs release workflows | PASS (documented) | `docs/STAGING-TESTFLIGHT-ISOLATION.md` |
| Staging app URL | PASS (docs) | `sociva-integration.vercel.app` / Vercel project `sociva-integration` |
| Migrations independently testable | PASS with process | Promote script `scripts/promote-staging-backend.cjs` |
| Staging can access prod data | FAIL if misconfigured env | Mitigated by assert scripts - operator discipline required |
| Schema parity | **DRIFT RISK** | search wrapper / core naming differs; always diff before promote |
| Rollback docs | PASS | `docs/ops/STAGING_ROLLBACK.md` |
| Git branches `staging` / `feature/society-isolation` | NOT VERIFIED as mandatory workflow | Recommend adopting proposed branch model |

**Important:** A Git staging branch alone is insufficient - Sociva already has a separate Supabase branch project; keep it that way. Never point staging builds at prod keys.

---

## 13. Evidence index (paths and objects)

| Item | Location |
|---|---|
| Society validate/create Edge | `supabase/functions/validate-society/index.ts` |
| Auth society complete | `src/hooks/useAuthPage.ts` ~601-646 |
| Resolve/create society helper | `src/lib/resolve-profile-society.ts` |
| Society_id lock trigger | `supabase/migrations/20260807240200_phase0_admin_governance.sql` |
| Feature hook | `src/hooks/useEffectiveFeatures.ts` |
| Visitor UI/hook | `src/pages/VisitorManagementPage.tsx`, `src/hooks/useVisitorManagement.ts` |
| Seller society helpers | `src/lib/seller-society.ts`, `src/lib/seller-approval.ts` |
| Rate limiter | `supabase/functions/_shared/rate-limiter.ts` |
| Gap-close RL migration (repo) | `supabase/migrations/20261123210000_gap_close_rl_tenant_definer_indexes.sql` |
| Staging isolation doc | `docs/STAGING-TESTFLIGHT-ISOLATION.md`, `docs/INTEGRATION.md` |
| Cross-society e2e | `e2e/cross-society-rls.spec.ts` |
| Live RPCs/policies | Queried via Supabase MCP `execute_sql` on `kkzkuyhgdvyecmxtmkpy` / `wwuanzbusxoyzixuprxs` |
| Vercel SPA headers/CDN | `vercel.json` |

Secrets and service-role keys were **not** written into this report.

---

## 14. Recommended implementation phases

Align with the product plan; order is mandatory:

1. **Phase 1 - Society identity and membership**  
   Approved registry gate; membership requests; statuses; replace client first-assign with DEFINER RPC; stop Maps-driven create-as-join; dedupe inactive Greenfield rows in staging first.

2. **Phase 2 - Database isolation**  
   Tighten profiles/products/seller SELECT; audit DEFINER; storage policies; legacy `chat_messages`.

3. **Phase 3 - Feature entitlement enforcement**  
   RLS + RPC + Edge asserts using existing `can_access_feature`; remove frontend-only trust; remove marketplace always-on bypass or make it explicit platform policy.

4. **Phase 4 - Marketplace visibility**  
   Fix `seller_is_discoverable_to_buyer` + `search_products_v2` to: same society OR (`sell_beyond_community` AND within radius); never expose when lat/lng missing unless same-society path.

5. **Phase 5 - Visitor Management**  
   Build on Phases 1-3; complete RLS; prefer RPCs; guard assignments; audit log immutability.

6. **Phase 6 - Regression and production rollout**  
   Two-society matrix; promote migrations; monitor.

**Shriram Greenfield:** treat as first customer tenant only - no hardcoded special-case IDs in architecture.

---

## 15. Regression test plan (two societies)

Society A = approved Greenfield canonical; Society B = separate approved test society (staging).

| # | Test | Layer |
|---|---|---|
| 1 | Resident A cannot SELECT Society B bulletin/conversations/helphub | REST + RPC |
| 2 | Resident A cannot open conversation to B resident | `conversations_open_or_request` |
| 3 | Resident B cannot read Society A visitor_entries / gate_entries | REST |
| 4 | Pending membership cannot call resident-only RPCs | RPC |
| 5 | Suspended membership (once modeled) loses access with existing JWT | RPC + optional session revoke |
| 6 | Client cannot set `society_id` to B when already on A | Trigger |
| 7 | Client cannot first-assign unapproved society | New join RPC |
| 8 | Seller with `sell_beyond_community=false` not in B search | `search_products_v2` |
| 9 | Seller with opt-in + radius includes B only inside radius | RPC |
| 10 | Disabled `visitor_management` blocks REST insert even if UI bypassed | RLS/RPC |
| 11 | Guard for A cannot update B gate rows | REST |
| 12 | Manipulate `society_id` on visitor insert → rejected | WITH CHECK |
| 13 | Direct URL `/visitors` with feature off | UI + API |
| 14 | Products REST select does not return other-society private fields beyond policy | REST |

Automate via extending `e2e/cross-society-rls.spec.ts` and DB tests under `supabase/tests/`.

---

## 16. Production migration and rollback strategy

1. Develop on `feature/society-isolation` → deploy/test on staging Supabase `wwuanzbusxoyzixuprxs` only.
2. Apply migrations via reviewed SQL; never use staging service-role against prod.
3. Forward-only where possible; provide `supabase/rollbacks/` scripts for destructive changes.
4. Before prod: schema diff prod vs staging; run two-society matrix on staging; backup verification.
5. Promote with `scripts/promote-staging-backend.cjs` (confirm flags) or explicit MCP `apply_migration` file list to `kkzkuyhgdvyecmxtmkpy`.
6. Expand rollout: registry+membership → RLS → marketplace → visitor.
7. Rollback: revert app deploy first; DB rollback only with rehearsed scripts; keep feature flags off for VM until Phase 5 signed off.

---

## 17. GO / NO-GO

| Decision | Recommendation |
|---|---|
| Start **implementation in staging** for Phases 1-2 | **GO** (after this audit review) |
| Launch **Visitor Management tomorrow on production** | **NO-GO** |
| Claim Sociva is securely multi-tenant today | **NO-GO** |
| Use Maps selection as membership proof | **NO-GO** (architectural) |

**Bottom line:** Rebuild trust around **backend-verified membership** of **approved societies**, then isolate data and entitlements, then marketplace rules, then Visitor Management - on the same framework used by Conversations, not a one-off VM security design.
