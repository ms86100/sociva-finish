# Society Hub Gap Audit (Staging)

| Field | Value |
| --- | --- |
| Date | 2026-11-23 |
| Target | Staging `wwuanzbusxoyzixuprxs` |
| Focus society | Lakeview Proof Residency (`94a7124c-a692-4d66-981f-0227b1317199`) |
| Architecture skill | `.cursor/skills/sociva-traffic-architecture/SKILL.md` |
| Production writes | None |

## Hub tile smoke (code + entitlement evidence)

Lakeview has **32 enabled** features via Pilot Builder → `sociva_pilot_ops` (same pilot path as Stage2 A/B).

| Tile | Route | Verdict | Notes |
| --- | --- | --- | --- |
| Visitors | `/visitors` | PASS (page+RPC path) | Staging server OTP |
| Authorized Persons | `/authorized-persons` | PASS | Shares visitor_management gate |
| Parking | `/parking` | PASS | Page implemented |
| Parcels | `/parcels` | PASS | RLS society-scoped |
| HelpHub | `/help-hub` | PASS | Multi-page |
| My Workers | `/my-workers` | PASS | |
| Workforce Mgmt | `/workforce` | PASS | |
| Hire Workers | `/worker-hire` | PASS | Thin list wrapper |
| Finances | `/society/finances` | PASS | |
| Payment Schedule | `/payment-milestones` | PASS | |
| Maintenance | `/maintenance` | PARTIAL | Hub stats query used wrong dues column historically |
| Construction | `/society/progress` | PASS | |
| Snag Reports | `/society/snags` | PASS | |
| Inspection | `/inspection` | PASS | |
| Documents | `/society/progress` | GAP | No tab deep-link |
| Q&A | `/society/progress` | GAP | No tab deep-link |
| Disputes | `/disputes` | PASS | |
| Deliveries | `/society/deliveries` | PASS | |
| Notices | `/society/notices` | PASS | Stage2 A cannot read B notices |
| Monthly Report | `/society/reports` | PASS | Banner gate |

## Onboarding (MyGate-like)

| Step | Staging status |
| --- | --- |
| Admin create society | Wizard + client inserts (`society-onboard.ts`) |
| Assign package to builder | Client `builder_feature_packages` writes (hardening in this batch) |
| Appoint society admin | Client `society_admins` insert |
| Resident join | Staging `request_society_membership` + invite; block/flat via AddressForm/ProfileEdit |
| Tower/unit master | Not MyGate-grade - free-text block/flat |

## Isolation (ops vs marketplace)

| Surface | Result |
| --- | --- |
| Notices A→B | Blocked (Stage2 suite) |
| Visitors A→B | Blocked |
| Parcels A→B | Blocked / empty |
| Visitor OTP cross-society | Rejected |
| Bulletin votes/RSVP SELECT | PASS (hardened) | society-scoped + `can_access_feature` |
| Marketplace radius | **Commerce exception** - intentional discoverability by radius, not society-ops leak |
| Production parity | **NO** - membership/visitor RPC not promoted |

## Confirmed gaps (15)

1. Package assign was client writes - **fixed** via `admin_assign_society_package` (VOLATILE DEFINER + RL).
2. FeatureGate UI-only - **fixed** server `can_access_feature` on notices/parcels/disputes/visitors.
3. Production lacks membership + visitor OTP RPC parity - **deferred** (no prod writes this pass).
4. No structured tower/unit registry - **partial** (clearer tower/flat UX; full MyGate registry deferred).
5. Documents/Q&A deep-links - **fixed** (`?tab=`).
6. Bulletin votes/RSVP world-readable - **fixed**.
7. Legacy `chat_messages` not society-scoped - **deferred** (new conversations RPC is membership-scoped).
8. Profiles directory cross-society - **probe PASS** on staging (A cannot enumerate B); keep watching.
9. Storage/Realtime - **probe PASS** for payment-proofs cross-user list; Realtime soak deferred.
10. Hub grid orphans - **fixed**.
11. Dense stats/search margins - **fixed**.
12. Empty states inconsistent - **fixed** for Visitors/Parcels/Notices/Maintenance.
13. Admin ops checklist buried - **fixed** (overview checklist).
14. Lakeview pilot package - **validated** (32 enabled).
15. Isolation suite coverage - **fixed** (Stage2 **38/38** incl. bulletin/disputes/conversations/profiles/storage).

## Marketplace radius note

Users who expand discovery radius can see **marketplace sellers/products** from other geographies. That is product intent for commerce. Society ops (notices, visitors, parcels, smart-group posts) must remain membership-scoped - do not "fix" isolation by disabling marketplace radius.

## Remediation shipped (this batch)

| Task | Status |
| --- | --- |
| Hub grid spacing + orphan last-row cards | Done (`SocietyDashboardPage`) |
| Documents/Q&A `?tab=` deep-links | Done (`SocietyProgressPage`) |
| Server `can_access_feature` on notices/parcels/disputes/visitors | Done (staging migration `20261123270000_*`) |
| Bulletin votes/RSVP society-scoped SELECT | Done |
| `admin_assign_society_package` VOLATILE DEFINER + audit | Done; client uses RPC |
| Resident tower/flat join UX | Done (`AddressForm`, ProfileEdit hint) |
| Society admin ops checklist + appoint | Done (`SocietyAdminPage`) |
| Empty states Visitors/Parcels/Notices/Maintenance | Done |
| Stage2 isolation + Lakeview package sanity | Done - validation **36/36 pass** |
| Lakeview pilot entitlements | Confirmed: 32 enabled, required ops keys present |

Deferred (explicitly out of scope): production membership/visitor promotion; marketplace radius redesign; full MyGate unit registry.
