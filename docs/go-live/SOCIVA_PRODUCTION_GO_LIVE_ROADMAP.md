# SOCIVA Production Go-Live Roadmap

| Field | Value |
|---|---|
| Document | `docs/go-live/SOCIVA_PRODUCTION_GO_LIVE_ROADMAP.md` |
| Depends on | `docs/go-live/SOCIVA_MASTER_PRODUCT_INVENTORY.md` |
| Execution environment until further notice | **Staging only** (`wwuanzbusxoyzixuprxs`) |
| Production | Forbidden without explicit written approval |
| Date (UTC) | 2026-11-23 |

This roadmap turns Stage 1 discovery into ordered work. It does **not** authorize bulk feature enablement across all societies.

---

## Guiding rules

1. Fix foundation before UX polish.
2. Pilot package ≠ default package for all tenants.
3. Real authorized people only for admin/guard roles.
4. Every P0/P1 task needs acceptance criteria + rollback.
5. Prefer repairing existing modules over rebuilds.

---

## P0 - Critical blockers (Stage 2)

Anything that makes the product unsafe, undiscoverable, or impossible to operate.

### P0-1 Entitlement RPC contract alignment

| Field | Detail |
|---|---|
| Business impact | Residents may not see Society entry; admin toggles unreliable |
| Technical issue | Staging `get_effective_society_features` returns 4 columns; UI expects `society_configurable` (+ optional description/icon) |
| Files | `useEffectiveFeatures.ts`, `useSocietyEntryVisible.ts`, SQL RPC, `types.ts` |
| DB | Versioned migration on **staging** only |
| Risk | Accidental enable/disable behavior change |
| Acceptance | Society entry visible when any entitled feature `is_enabled`; FeatureGate matches RPC; unit test for visibility helper |
| Rollback | Revert migration; keep previous RPC signature behind documented dual-read if needed |
| Tests | Unit: `useSocietyEntryVisible`; SQL: select RPC columns |

### P0-2 Pilot feature catalog (not global blast)

| Field | Detail |
|---|---|
| Business impact | Guard/parcels/parking/notices cannot be entitled |
| Technical issue | Staging catalog has 10 features; MyGate core keys missing |
| Files | Migration seeding `platform_features` + `feature_package_items` |
| DB | Add missing keys + metadata; create **`sociva_pilot_ops`** package (or equivalent) separate from indiscriminate default expansion |
| Risk | Silently enabling unused modules for all societies if added only to default package |
| Acceptance | Pilot package contains VM, guard_kiosk, gate_entry, parcel_management, society_notices (+ optional parking); default package unchanged unless explicitly approved |
| Rollback | Delete package items / deactivate package |
| Tests | SQL assert package contents; FeatureGate denies missing keys |

### P0-3 Keep visitor writes server-side on staging

| Field | Detail |
|---|---|
| Business impact | OTP forgery / weak audit if client path returns |
| Technical issue | Dual path already exists; staging RPC path must remain mandatory when `IS_STAGING_SUPABASE` |
| Files | `useVisitorManagement.ts`, `GuardVisitorOTPTab.tsx`, visitor migrations |
| Acceptance | No client INSERT/UPDATE success path on staging; isolation probe stays green |
| Rollback | N/A if already RPC; do not reintroduce client writes |
| Tests | RPC deny without membership; cross-society deny |

### P0-4 Pilot staffing workflow (real users)

| Field | Detail |
|---|---|
| Business impact | 0 society admins / 0 guards = non-operable OS |
| Technical issue | Config empty, not missing UI |
| Files | Society Admin SecurityStaffManager / appoint admin flows |
| Acceptance | Documented checklist to appoint **authorized** pilot admin + guard; no fake seed scripts in production data |
| Rollback | Deactivate appointments via existing deactivate fields |
| Tests | SecurityRoute allows appointed guard; denies resident |

---

## P1 - Core operational readiness (Stage 3)

### P1-1 Visitor full journey E2E on staging

Resident create → OTP → guard redeem → notify artifact → checkout → audit trail.

Acceptance: Playwright or scripted RPC journey with two societies; notification_queue or inbox row present.

### P1-2 QR gate journey

`gate-token` generate → verify → replay/expired reject → `gate_entries` row.

### P1-3 Parcel journey

Guard/admin log → resident sees → collect → status.

### P1-4 Notices journey

Admin publish → resident can read → notification event if wired.

### P1-5 Resident approval journey

Pending membership/profile → admin approve/reject → access delta via `get_user_society_id` / membership.

### P1-6 Notification event matrix (critical events only)

Visitor check-in, parcel received, notice posted, dues generated (if enabled). Prove channel or explicitly mark BLOCKED BY THIRD-PARTY.

---

## P2 - Product quality (Stage 4)

1. Resident daily dashboard (actionable, not feature grid dump).
2. Society admin command center (queues: approvals, security, dues, disputes).
3. Guard tablet mode (large targets, expected visitors first).
4. Empty states with next actions.
5. HelpHub vs workforce single product path for pilot.
6. Marketplace remains stable; no society OS work may regress checkout.

---

## P3 - Growth readiness (later)

1. Amenity booking only if pilot societies demand it.
2. Advanced analytics / report cards.
3. Connection plan upgrade before large soak.
4. Production promotion of staging membership + visitor RPC model.
5. Progressive society onboarding tooling (detect never-operational societies).

---

## Pilot readiness checklist (Stage 6 gate)

Do not auto-select a production society.

- [ ] Staging society verified + active
- [ ] Pilot package assigned (not global enable)
- [ ] Real society admin appointed
- [ ] Real security officer appointed
- [ ] Security mode set (`basic` first)
- [ ] Visitor OTP journey signed off
- [ ] QR journey signed off
- [ ] Parcel journey signed off
- [ ] Notice journey signed off (if in pilot package)
- [ ] Isolation probe green
- [ ] Support / incident contact named
- [ ] Explicit approval recorded before any production promotion

---

## Suggested execution sequence

| Stage | Work | Environment |
|---|---|---|
| 1 | Discovery inventory (this completed) | Staging read-only |
| 2 | P0 foundation | Staging writes only |
| 3 | P1 core journeys | Staging |
| 4 | P2 UX | Staging |
| 5 | Automated validation | Staging |
| 6 | Pilot launch | Staging → then approved production clone |
| 7 | Progressive rollout | Production with monitoring |

---

## Immediate ask after Stage 1

Authorize **Stage 2 on staging only**, limited to:

1. P0-1 RPC/UI contract fix
2. P0-2 pilot package catalog seed
3. P0-3 visitor RPC enforcement confirmation
4. P0-4 pilot staffing checklist (no fake users)

Do **not** authorize production migration or global feature enablement in the same pass.
