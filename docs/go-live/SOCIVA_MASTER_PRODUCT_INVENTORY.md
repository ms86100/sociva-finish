# SOCIVA Master Product Inventory

| Field | Value |
|---|---|
| Document | `docs/go-live/SOCIVA_MASTER_PRODUCT_INVENTORY.md` |
| Stage | **Stage 1 - Discovery (read-only)** |
| Scope environment | **Staging only** - Supabase ref `wwuanzbusxoyzixuprxs` (branch `onboarding-integration`) |
| Production ref | `kkzkuyhgdvyecmxtmkpy` (referenced for contrast only; no production writes) |
| App frontend host (documented) | `sociva-integration.vercel.app` |
| Audit date (UTC) | 2026-11-23 |
| Mode | Inspect + inventory. **No code changes. No feature enablement. No fake users.** |
| Prior evidence reused | `docs/audits/SOCIVA_MULTI_TENANT_SECURITY_AUDIT.md`, `docs/audits/SOCIVA_PRODUCTION_READINESS_AUDIT.md`, `docs/audits/SOCIVA_GO_VM_STAGING_EVIDENCE.md` |

## Status legend

| Status | Meaning |
|---|---|
| COMPLETE AND VERIFIED | UI + backend + DB + auth path proven with staging evidence |
| IMPLEMENTED BUT UNTESTED | Code and schema exist; journey not fully proven end-to-end |
| PARTIALLY IMPLEMENTED | Important pieces missing (RPC, RLS, notification, entitlement, or UX) |
| BROKEN | Evidence of failing contract, wrong path, or unusable journey |
| MISSING | Not found as a first-class product capability |
| BLOCKED BY CONFIGURATION | Needs package/feature/role/env setup before use |
| BLOCKED BY THIRD-PARTY INTEGRATION | Depends on SMS/WhatsApp/payment/provider config not proven live |

---

## 0. Executive verdict (Stage 1)

Sociva is **not** a greenfield build. It is a broad residential OS plus marketplace with substantial code already written.

On **staging**, the foundation for secure Visitor Management is materially ahead of production:

- `society_memberships` exists (21 rows).
- Server visitor RPCs exist: `visitor_create_entry`, `visitor_set_status`, `visitor_guard_redeem_otp`.
- Isolation probe `sociva_go_vm_isolation_probe()` returns `ok: true` and cross-society visitor read denied.
- Client visitor writes fall back to insecure direct table writes **only when staging RPCs are unavailable** (`IS_STAGING_SUPABASE` / `isVisitorRpcAvailable()`).

However, Sociva is **not ready for commercial MyGate/NoBrokerHood-style go-live**, even on staging, because:

1. Feature entitlement contract is incomplete and mismatched with the UI.
2. Guard / society admin / builder staffing is empty (0/0/0).
3. Most society-ops tables are unused.
4. Core competitor modules (`guard_kiosk`, `parcel_management`, `vehicle_parking`, notices, construction, workforce) are **not in the staging feature catalog**.
5. Resident Society hub visibility depends on `society_configurable`, which staging RPC does **not** return.
6. Amenity / facility booking is **MISSING**.
7. Most E2E journeys for society ops are not automated.

**Stage 1 classification:** CONDITIONAL GO for continued **staging** remediation. **NO GO** for multi-society commercial launch.

---

## 1. Staging truth (rechecked live SQL)

### 1.1 Census

| Metric | Staging `wwuanzbusxoyzixuprxs` |
|---|---|
| Societies | 25 |
| Societies active | 9 |
| Societies verified | 6 |
| Profiles | 25 |
| Profiles approved | 21 |
| `society_memberships` | 21 |
| Society admins | **0** |
| Security staff | **0** |
| Builders / builder_societies / builder packages | **0 / 0 / 0** |
| `platform_features` | **10** |
| Feature packages | 1 (default package model) |
| Visitor entries | 4 |
| Gate entries | 0 |
| Parcels | 7 |
| Authorized persons | 0 |
| Parking slots | 0 |
| Society notices | 0 |
| Maintenance dues | 0 |
| Snags / disputes | 0 / 0 |
| Bulletin posts | 0 |
| Orders (marketplace) | 46 |

### 1.2 Feature catalog on staging (complete list)

| feature_key | display_name | category/route/icon | In default package |
|---|---|---|---|
| marketplace | Marketplace | metadata mostly null | yes |
| bulletin | Community Bulletin | metadata mostly null | yes |
| disputes | Dispute System | metadata mostly null | yes |
| finances | Society Finances | metadata mostly null | yes |
| visitor_management | Visitor Management | metadata mostly null | yes |
| domestic_help | Domestic Help | metadata mostly null | yes |
| maintenance | Maintenance Dues | metadata mostly null | yes |
| helphub | HelpHub | community / `/help-hub` | yes |
| cleaner_city | A Cleaner City | community / `/cleaner-city` | yes |
| smart_groups | Smart Groups | community / `/community` | yes |

**Missing from staging catalog but present in app FeatureKey / dashboard:**

`guard_kiosk`, `gate_entry`, `parcel_management`, `vehicle_parking`, `construction_progress`, `snag_management`, `inspection`, `payment_milestones`, `workforce_management`, `worker_marketplace`, `society_notices`, `delivery_management`, `resident_identity_verification`, `authorized_persons` (feature key unused; UI gated by visitor_management), `conversations`, `help_requests`, `seller_tools`, trust/*, subscriptions, collective_buy, society_reports, security_audit, worker_attendance/leave/salary (as distinct keys).

### 1.3 Entitlement RPC contract (staging)

```text
get_effective_society_features(uuid)
RETURNS TABLE(feature_key text, display_name text, is_enabled boolean, source text)
```

App hook `useEffectiveFeatures` also expects `society_configurable`, `description`, `icon_name`.

Generated TS types currently match the **4-column** staging/prod shape.

`useSocietyEntryVisible` requires:

```ts
features.some((f) => f.is_enabled && f.society_configurable)
```

Because `society_configurable` is absent from RPC rows, it is falsy → **Society entry can hide for non-platform-admin residents** even when features are enabled. Platform admins bypass feature gates separately.

### 1.4 Visitor security model on staging

| Check | Evidence |
|---|---|
| Membership table | Present |
| Active membership drives society context | Probe: pending has no active society |
| Visitor SELECT policy | `visitor_entries_select_society` only |
| Visitor writes | Via DEFINER RPCs (no client INSERT/UPDATE policies) |
| Isolation probe | `policy_would_allow_b_to_read_a_visitor: false` |
| App staging path | `visitor_create_entry` / `visitor_set_status` / `visitor_guard_redeem_otp` |
| App production fallback | Client OTP + direct insert/update (insecure for commercial VM) |

---

## 2. Architecture map (as built)

```text
Resident / Guard / Admin (Vite + Capacitor)
  -> Vercel CDN (SPA)
  -> Supabase Auth + PostgREST + RLS + RPCs
  -> Edge Functions (~90): gate-token, validate-society, payments, MSG91, FCM/APNs, WhatsApp, ...
  -> Postgres (society_id columns + feature packages)
  -> notification_queue -> process-notification-queue
```

**Intended entitlement hierarchy**

Platform Admin → Feature catalog → Package → Builder assignment → Society → Society override → Role → FeatureGate / RLS / RPC

**Observed staging hierarchy**

Default package (`is_default=true`) → all societies get those 10 features → optional `society_feature_overrides` → UI FeatureGate (platform admin bypasses)

No builders assigned. Society override UI exists but society admins = 0.

---

## 3. Role model inventory

| Role | How represented | Staging reality | Journey status |
|---|---|---|---|
| Platform admin | `user_roles` / `isAdmin` | Exists for ops accounts | IMPLEMENTED BUT UNTESTED for full society OS launch |
| Society admin | `society_admins` | **0 rows** | BLOCKED BY CONFIGURATION |
| Moderator | `society_admins.role` | Unused | PARTIALLY IMPLEMENTED |
| Security guard | `security_staff` + `is_security_officer` | **0 rows** | BLOCKED BY CONFIGURATION |
| Builder | `builders` / `builder_members` / `builder_societies` | **0** | BLOCKED BY CONFIGURATION |
| Resident | profile + membership | 21 approved; 21 memberships | PARTIALLY IMPLEMENTED (membership better on staging) |
| Seller | `seller_profiles` | Marketplace active (46 orders) | IMPLEMENTED BUT UNTESTED for society-ops coupling |
| Worker / HelpHub provider | helphub / workforce tables | Minimal | PARTIALLY IMPLEMENTED |
| Committee member | soft concept via society admin dashboard | Not staffed | PARTIALLY IMPLEMENTED |

---

## 4. Feature inventory by product area

Verification columns: UI | Route | Schema | RPC/Edge | Auth/RLS | Entitlement | Notify | Staging data | Status

### A. Security and access (MyGate core)

| Feature | UI | Route | Schema | Backend | Auth | Entitlement staging | Notify | Data | Status |
|---|---|---|---|---|---|---|---|---|---|
| Visitor Management | Yes | `/visitors` | `visitor_entries`, `visitor_types` | Staging RPCs + prod client fallback | Staging SELECT + RPC writes | ON | Check-in trigger exists | 4 rows | COMPLETE AND VERIFIED for staging isolation probe; IMPLEMENTED BUT UNTESTED for full resident→guard→notify→exit journey with real guard account |
| Authorized Persons | Yes | `/authorized-persons` | `authorized_persons` | Direct CRUD | Needs re-verify | Gated by visitor_management | No | 0 | IMPLEMENTED BUT UNTESTED |
| Resident QR Gate Pass | Yes | `/gate-entry` | `gate_entries` | Edge `gate-token` (AES-GCM + HMAC, 60s) | Auth required | `gate_entry` **missing** from catalog (FeatureGate also accepts visitor_management) | Partial | 0 | PARTIALLY IMPLEMENTED / BLOCKED BY CONFIGURATION |
| Guard Kiosk | Yes | `/guard-kiosk` | uses visitor/gate/parcel/worker | OTP tab uses staging redeem RPC | SecurityRoute + staff RPC | `guard_kiosk` **missing** | Partial | 0 staff | BLOCKED BY CONFIGURATION + PARTIALLY IMPLEMENTED |
| Manual entry + confirmation mode | Yes | Guard + GateEntry | `manual_entry_requests`, society `security_mode` | Client + settings | Staff/admin | Mode UI works; AI match locked | Confirmation push path exists in code | unused | PARTIALLY IMPLEMENTED |
| Parcel Management | Yes | `/parcels` | `parcel_entries` | Direct table | Admin/resident split | `parcel_management` **missing** | Docs claim push | 7 rows | PARTIALLY IMPLEMENTED / BLOCKED BY CONFIGURATION |
| Parking | Yes | `/parking` | `parking_slots`, `parking_violations` | Direct table | Admin manage | `vehicle_parking` **missing** | No | 0 | BLOCKED BY CONFIGURATION |
| Security Staff Manager | Yes | Society Admin → More | `security_staff` | Insert + role | Society admin | N/A | No | 0 | IMPLEMENTED BUT UNTESTED |
| Entry/exit logs | Guard log tab | `/guard-kiosk` | `gate_entries`, visitor status | Queries | Staff | Depends on guard_kiosk | No | empty | PARTIALLY IMPLEMENTED |
| Amenity / facility booking | No first-class module found | - | - | - | - | - | - | - | MISSING |

### B. Domestic help and workforce

| Feature | Notes | Status |
|---|---|---|
| HelpHub | Routes `/help-hub/*`, feature ON, listings exist in broader product | PARTIALLY IMPLEMENTED (staging community tables light) |
| Domestic Help legacy | `/domestic-help` redirects to HelpHub; legacy tables empty | PARTIALLY IMPLEMENTED - product split unresolved |
| Workforce registry / attendance / leave / salary | Pages exist; feature keys missing from staging catalog | BLOCKED BY CONFIGURATION |
| Worker hire marketplace | Pages exist; feature missing | BLOCKED BY CONFIGURATION |
| Worker gate validation | Guard kiosk tab | Depends on guard staffing + workforce data | BLOCKED BY CONFIGURATION |

### C. Society finance and payments

| Feature | Notes | Status |
|---|---|---|
| Society Finances | `/society/finances`, feature ON | IMPLEMENTED BUT UNTESTED (0 expenses/income) |
| Maintenance dues + Razorpay | `/maintenance`, feature ON | PARTIALLY IMPLEMENTED - payment success must be server-verified; no staging dues data |
| Payment milestones | UI exists; feature missing from catalog | BLOCKED BY CONFIGURATION |
| Society financial reports | `/society/reports` | IMPLEMENTED BUT UNTESTED |

### D. Construction and handover

| Feature | Status |
|---|---|
| Construction progress / documents / Q&A | BLOCKED BY CONFIGURATION (feature missing; empty tables) |
| Snag management | BLOCKED BY CONFIGURATION |
| Inspection checklists | BLOCKED BY CONFIGURATION |
| Builder dashboards | BLOCKED BY CONFIGURATION (0 builders) |

### E. Community and governance

| Feature | Staging notes | Status |
|---|---|---|
| Bulletin / Smart Groups | Feature ON; 0 bulletin posts on staging | IMPLEMENTED BUT UNTESTED on staging |
| Conversations / Messages | Routes exist; conversations feature may be prod-only add | PARTIALLY IMPLEMENTED |
| Disputes | Feature ON; 0 tickets | IMPLEMENTED BUT UNTESTED |
| Society notices | UI exists; feature missing; 0 rows | BLOCKED BY CONFIGURATION |
| Help requests | Tables empty; feature often missing | PARTIALLY IMPLEMENTED / MISSING entitlement |
| Community rules page | Static-ish route | IMPLEMENTED BUT UNTESTED |

### F. Marketplace and commerce (differentiator)

| Capability | Staging evidence | Status |
|---|---|---|
| Discovery / catalog / cart / checkout / orders | 46 orders | COMPLETE AND VERIFIED for core commerce depth relative to society OS (marketplace is the live product) |
| Seller onboarding / approval | Code + admin tools | IMPLEMENTED BUT UNTESTED as part of society OS pilot |
| Delivery tracking | Marketplace delivery tables used more than society parcels | PARTIALLY IMPLEMENTED as society module |
| Society-scoped discovery | Staging has stronger membership/isolation work; production parity incomplete | PARTIALLY IMPLEMENTED |

### G. Platform admin control plane

| Capability | Route / component | Status |
|---|---|---|
| Feature catalog + packages + builder assign | `/admin` Features tab | IMPLEMENTED BUT UNTESTED operationally (catalog incomplete) |
| Society switcher | Society Admin | IMPLEMENTED BUT UNTESTED |
| Campaigns / notifications ops | Admin panels | PARTIALLY IMPLEMENTED |
| Identify never-onboarded societies | No dedicated ops view found | MISSING (needed for commercial rollout) |

---

## 5. Journey readiness matrix (Stage 1)

| # | Journey | Staging readiness | Blocking evidence |
|---|---|---|---|
| 1 | Society onboarding (package → admin → resident) | PARTIAL | 0 builders, 0 society admins; membership RPCs exist |
| 2 | Visitor OTP → guard redeem → notify → checkout | PARTIAL | RPCs + probe OK; 0 security staff; notify not E2E proven |
| 3 | Resident QR → guard scan → replay rejected | PARTIAL | `gate-token` code strong; 0 gate_entries; guard feature missing |
| 4 | Parcel register → notify → collect | PARTIAL | 7 parcels; feature missing; notify unproven |
| 5 | Notices publish → resident notify → read | BLOCKED | Feature missing; 0 notices |
| 6 | Smart Groups messaging isolation | PARTIAL | Feature ON; staging bulletin empty; isolation needs dedicated E2E |
| 7 | Maintenance generate → pay → reconcile | BLOCKED/PARTIAL | Feature ON; 0 dues; payment verification discipline required |
| 8 | Resident apply → approve/reject → access | PARTIAL | Membership model improved on staging; admin staff = 0 |
| 9 | Seller apply → approve → order | STRONGER | Marketplace already operating |
| 10 | Cross-society isolation | PARTIAL→STRONG for visitors | Probe OK on staging; production still NO-GO per MTSA |

Existing automated coverage is **marketplace-heavy** (`e2e/tests/**`). Society OS journeys are thin; `e2e/cross-society-rls.spec.ts` exists but depends on seeded JWTs.

---

## 6. Competitive gap vs MyGate / NoBrokerHood

| Capability | Sociva | Classification |
|---|---|---|
| Visitor pre-approve + OTP | Strong code; staging server OTP | Already competitive (needs ops proof) |
| Guard tablet console | Built | Needs UX polish + staffing + entitlement |
| Resident QR pass | Built (`gate-token`) | Needs functional improvement + entitlement |
| Domestic help | HelpHub + legacy split | Needs product decision + UX improvement |
| Parcels | Built | Needs entitlement + notify proof |
| Maintenance collection | Built | Needs payment E2E proof |
| Notices | Built UI | Missing integration (entitlement/data) |
| Complaints / disputes | Built | Needs UX + usage |
| Amenities / clubhouse booking | Not found | Missing feature (do not build yet unless pilot demands) |
| Community engagement | Bulletin/Smart Groups/marketplace | Already competitive / differentiator |
| Local commerce | Marketplace live | Already competitive differentiator |
| Boom barrier / ANPR / face | Not built | Not currently necessary for MVP |
| Admin/guard command center | Fragmented across tabs | Needs UX improvement |

---

## 7. Top 10 real-user failure risks

Ranked by business impact if 10 societies were onboarded tomorrow (staging-shaped product).

### 1. No society admins or guards (ops vacuum)

- **Journey broken:** Resident joins → nobody approves peers / nobody runs gate.
- **Evidence:** staging `society_admins=0`, `security_staff=0`.
- **Impact:** Society OS cannot operate even if UI is perfect.
- **Smallest safe fix:** Controlled pilot appointment workflow for **real** authorized people only; checklist, not fake seed.

### 2. Society hub can disappear for residents

- **Journey broken:** Resident opens app → no Society entry → cannot find visitors/parcels.
- **Evidence:** RPC omits `society_configurable`; `useSocietyEntryVisible` requires it.
- **Impact:** Features enabled but undiscoverable.
- **Smallest safe fix (Stage 2):** Align RPC return with hook contract **or** change visibility to `is_enabled` without inventing silent enablement.

### 3. Guard Kiosk / parcels / parking not entitled

- **Journey broken:** Deep link `/guard-kiosk` / `/parcels` / `/parking` → Feature Not Available.
- **Evidence:** keys absent from staging `platform_features`.
- **Impact:** MyGate core incomplete.
- **Smallest safe fix:** Seed catalog + package items for **pilot package only**; do not flip all 242 prod societies.

### 4. Dual visitor write paths (staging secure / prod insecure)

- **Journey broken:** Production build still client-OTP + direct insert if RPCs absent.
- **Evidence:** `useVisitorManagement.ts` fallback; GO-VM staging evidence doc.
- **Impact:** OTP forgery / weak audit if promoted early.
- **Smallest safe fix:** Keep staging-only until RPC+RLS promoted; never enable VM commercially on client-OTP path.

### 5. Empty / useless empty states and module sprawl

- **Journey broken:** Society dashboard shows many cards; most lead to empty modules with weak guidance.
- **Evidence:** dashboard sections vs empty tables; generic empty copy patterns.
- **Impact:** Residents and committee abandon product.
- **Smallest safe fix:** Pilot UX: show only entitled + staffed modules; rewrite top empty states with next action.

### 6. Notifications claimed but not journey-proven for society ops

- **Journey broken:** Visitor checked in / parcel arrived / notice posted → resident unaware.
- **Evidence:** triggers/docs exist; no Stage 1 E2E delivery proof for these events on staging.
- **Impact:** Trust failure vs MyGate.
- **Smallest safe fix:** Notification event matrix + one device proof per critical event on staging.

### 7. Maintenance payment integrity risk

- **Journey broken:** Resident pays → UI success without server reconciliation.
- **Evidence:** Maintenance page uses Razorpay hooks; finance audit posture requires server verification (PRA).
- **Impact:** Financial disputes / chargebacks.
- **Smallest safe fix:** Do not pilot maintenance until webhook/idempotency acceptance tests pass.

### 8. Feature metadata and admin toggles unreliable

- **Journey broken:** Admin cannot understand or configure plan; showcase/routes blank.
- **Evidence:** many null `feature_name`/`category`/`route` on staging catalog.
- **Impact:** Wrong commercial packaging; support burden.
- **Smallest safe fix:** Metadata backfill migration on staging only.

### 9. HelpHub vs Domestic Help / Workforce confusion

- **Journey broken:** Resident seeks maid → unclear whether HelpHub, My Workers, or Workforce applies.
- **Evidence:** redirect of `/domestic-help`; multiple feature keys; empty workforce tables.
- **Impact:** Support tickets; incomplete competitor parity.
- **Smallest safe fix:** Product decision doc + hide unstaffed workforce entry points in pilot package.

### 10. Cross-environment drift (staging hardened, production not)

- **Journey broken:** Team believes staging GO equals production GO.
- **Evidence:** MTSA + GO-VM evidence: production lacks memberships/visitor RPCs.
- **Impact:** Accidental production launch of insecure path.
- **Smallest safe fix:** Explicit promotion checklist; Stage 2 remains staging-only until sign-off.

**If 10 societies were onboarded tomorrow, what breaks first?**

1. Nobody can administer the society (no society admins).
2. Nobody can run the gate (no security staff + guard feature not entitled).
3. Residents may not even see Society entry (RPC/UI contract mismatch).
4. Parcels/parking/notices remain undiscoverable or empty.
5. Any production promotion of visitor flows without RPC parity reintroduces client-OTP risk.

---

## 8. Security findings (Stage 1 summary)

| ID | Severity | Finding | Staging | Production contrast |
|---|---|---|---|---|
| SEC-VM-1 | High (prod) / Improved (staging) | Client OTP + direct visitor writes | RPC path | Still the prod path |
| SEC-ENT-1 | High | FeatureGate is UI-only for many modules; backend must enforce | Partial (visitor RPCs) | Weak for VM |
| SEC-RPC-1 | Medium | Effective features callable with arbitrary society id (info disclosure) | Present | Present |
| SEC-ISO-1 | Improved | Visitor cross-society read | Probe denies | Previously weak / different model |
| SEC-ROLE-1 | High ops | Privilege model unused (0 admins/guards) | Config block | Same |
| SEC-PAY-1 | High if enabled | Maintenance must not trust frontend success | Untested | Untested |

Full broader security posture: see `docs/audits/SOCIVA_PRODUCTION_READINESS_AUDIT.md` and `docs/audits/SOCIVA_MULTI_TENANT_SECURITY_AUDIT.md`.

---

## 9. UX findings (Stage 1)

| Persona | Current experience | Gap |
|---|---|---|
| Resident | Marketplace-first home; Society is a secondary grid of modules | Needs daily-use dashboard (parcels, visitors expected, notices, dues, community, local offers) |
| Society admin | Tabbed admin with More clutter | Needs command center of actionable queues |
| Guard | Feature-rich kiosk; not tablet-optimized as a product mode | Needs dedicated high-contrast, large-target mode + expected list first |
| Platform admin | Feature management exists | Needs never-onboarded society detector + pilot package tooling |

Empty states generally report absence, not next action. That fails the "no training required" bar.

---

## 10. Performance / SRE notes (staging)

From PRA re-audit (staging):

- Hardening progress strong (RLS advisors, indexes, rate limits, CORS cleanup in repo).
- `max_connections=60` limits large soak claims.
- Observability partial (health/ops-alert; external uptime not fully verified).
- Backups/PITR vendor-console **NOT VERIFIED** in Stage 1.
- Do not add Redis/queues beyond justified rate-limit use already present.

---

## 11. E2E test plan (authorize in Stage 5; define now)

Framework already present: Playwright under `e2e/`.

Required new/extended journeys (staging credentials only):

1. Society onboarding (membership RPC, no fake mass users)
2. Visitor create → guard redeem → status → notification row
3. QR generate → verify → replay reject
4. Parcel create → resident view → collect
5. Notice publish → inbox/push artifact
6. Smart Groups unauthorized deny
7. Maintenance pay only after server confirm
8. Resident approval access delta
9. Seller happy path (already largely covered)
10. Cross-society matrix (extend `cross-society-rls.spec.ts` with seeded A/B)

Each journey must assert success, unauthorized, invalid input, and persistence.

---

## 12. What Stage 1 authorizes next (and what it forbids)

### Authorized next (Stage 2 - Foundation) - staging only

1. Fix entitlement RPC ↔ frontend contract.
2. Backfill feature metadata + missing catalog keys into a **pilot package** (not all societies blindly).
3. Preserve visitor RPC security model; no weakening.
4. Build pilot readiness checklist (real people appointment).
5. Write `docs/go-live/SOCIVA_PRODUCTION_GO_LIVE_ROADMAP.md` with P0-P3.

### Forbidden still

- Production migrations/deploys without explicit approval.
- Bulk-enable all features for all societies.
- Fake admins/guards/residents.
- Destructive SQL.
- Declaring GO because pages load.

---

## 13. Counts

| Bucket | Count (approx) |
|---|---|
| Feature keys referenced in app | ~40 |
| Features present in staging catalog | 10 |
| Features enabled via default package | 10 |
| Society OS modules with real staging rows | Visitors (4), Parcels (7), Orders/marketplace (46), Memberships (21) |
| COMPLETE AND VERIFIED (narrow) | Marketplace depth; staging visitor isolation probe |
| IMPLEMENTED BUT UNTESTED | Majority of society UI modules |
| BLOCKED BY CONFIGURATION | Guard, parking, notices, construction, workforce, builder, society admin ops |
| MISSING | Amenity booking; never-onboarded society ops view |
| BROKEN / contract defects | Society entry visibility vs RPC shape; incomplete metadata |

---

## 14. Stage 1 sign-off

| Question | Answer |
|---|---|
| Is discovery complete enough to start Stage 2 on staging? | **Yes** |
| Is Visitor Management commercially GO? | **No** (ops + journey proof remaining) |
| Is staging safer than production for VM? | **Yes** |
| Should we enable all missing features now? | **No** |
| Recommended pilot shape | One verified society + real admin + real guard + pilot package (VM, gate, parcels, notices) |

**End of Stage 1 inventory.**
