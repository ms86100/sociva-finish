# Role Access Matrix — All Critical Tables

> Verified against live pg_policy queries on 2026-02-14.

## Legend
- ✅ = Allowed
- ❌ = Denied by RLS
- 🔒 = Denied (no policy exists for this operation)
- 📍 = Scoped to own society only

---

## gate_entries

| Operation | Resident (own) | Security Officer (same society) | Society Admin (same) | Platform Admin |
|---|---|---|---|---|
| SELECT | ✅ (user_id = self) | ✅📍 (via is_security_officer RPC) | ✅📍 (via is_society_admin RPC) | ✅ |
| INSERT | ❌ | ✅📍 (via is_security_officer RPC) | ✅📍 (via is_security_officer, which includes admins) | ✅ |
| UPDATE | ✅ (user_id = self) | ✅📍 | ✅📍 | ✅ |
| DELETE | 🔒 | 🔒 | 🔒 | 🔒 |

## security_staff

| Operation | Resident | Security Officer | Society Admin (same) | Platform Admin |
|---|---|---|---|---|
| SELECT | ❌ | ✅ (own record) | ✅📍 | ✅ |
| INSERT | ❌ | ❌ | ✅📍 | ✅ |
| UPDATE | ❌ | ❌ | ✅📍 | ✅ |
| DELETE | ❌ | ❌ | ✅📍 | ✅ |

## manual_entry_requests

| Operation | Resident (target) | Security Officer | Society Admin | Platform Admin |
|---|---|---|---|---|
| SELECT | ✅ (resident_id = self) | ✅📍 (via is_security_officer) | ✅📍 | ✅ |
| INSERT | ❌ | ✅📍 | ✅📍 | ✅ |
| UPDATE | ✅ (resident_id = self, status only) | ✅📍 | ✅📍 | ✅ |
| DELETE | 🔒 | 🔒 | 🔒 | 🔒 |

---

## Page Access Matrix — Security Officer Role

| Page | Security Officer | Society Admin | Platform Admin | Resident |
|---|---|---|---|---|
| `/security/verify` | ✅ | ✅ | ✅ | ❌ |
| `/security/audit` | ✅ (own entries only) | ✅ (all society entries) | ✅ (all entries) | ❌ |
| `/guard-kiosk` | ✅ | ✅ | ✅ | ❌ |
| `/gate-entry` | ✅ | ✅ | ✅ | ✅ |
| `/` (Home) | ❌ (nav hidden) | ✅ | ✅ | ✅ |
| `/search` (Marketplace) | ❌ (nav hidden) | ✅ | ✅ | ✅ |
| `/community` | ❌ (nav hidden) | ✅ | ✅ | ✅ |
| `/society` | ❌ (nav hidden) | ✅ | ✅ | ✅ |
| `/society/finances` | ❌ (nav hidden) | ✅ | ✅ | ✅ |
| `/disputes` | ❌ (nav hidden) | ✅ | ✅ | ✅ |
| `/directory` | ❌ (nav hidden) | ✅ | ✅ | ✅ |
| `/profile` | ✅ | ✅ | ✅ | ✅ |

### Navigation Enforcement
- **BottomNav**: Security officers see restricted `securityNavItems` (Verify, History, Profile) — enforced via `useSecurityOfficer` hook
- **Route level**: `/security/*` routes wrapped in `SecurityRoute` component in `App.tsx`
- **In-page guards**: Each security page checks `useSecurityOfficer` and renders \"Access Restricted\" for unauthorized users
- **RLS level**: All gate_entries queries enforced by `is_security_officer()` SECURITY DEFINER function

---

## products

| Operation | Buyer (same society) | Buyer (other society) | Seller (owner) | Society Admin | Platform Admin |
|---|---|---|---|---|---|
| SELECT | ✅📍 | ❌ | ✅ (own) | ✅📍 | ✅ (all) |
| INSERT | ❌ | ❌ | ✅ | ❌ | ✅ |
| UPDATE | ❌ | ❌ | ✅ (own) | ❌ | ✅ |
| DELETE | ❌ | ❌ | ✅ (own) | ❌ | ✅ |

## orders

| Operation | Buyer (own) | Buyer (other) | Seller (on order) | Society Admin | Platform Admin |
|---|---|---|---|---|---|
| SELECT | ✅ | ❌ | ✅ | ❌ | ✅ |
| INSERT | ✅ | ❌ | ❌ | ❌ | ❌ |
| UPDATE | ✅ | ❌ | ✅ | ❌ | ✅ |
| DELETE | 🔒 | 🔒 | 🔒 | 🔒 | 🔒 |

## seller_profiles

| Operation | Buyer | Seller (own) | Society Admin (same) | Society Admin (other) | Platform Admin |
|---|---|---|---|---|---|
| SELECT | ✅ (approved only) | ✅ | ✅ | ✅ (approved only) | ✅ |
| INSERT | ✅ (apply) | — | — | — | — |
| UPDATE | ❌ | ✅ | ✅📍 | ❌ | ✅ |
| DELETE | 🔒 | 🔒 | 🔒 | 🔒 | 🔒 |

## society_expenses

| Operation | Buyer (same society) | Buyer (other society) | Society Admin (same) | Society Admin (other) | Platform Admin |
|---|---|---|---|---|---|
| SELECT | ✅📍 | ❌ | ✅📍 | ❌ | ✅ |
| INSERT | ❌ | ❌ | ✅📍 | ❌ | ✅ |
| UPDATE | ❌ | ❌ | ✅📍 | ❌ | ✅ |
| DELETE | ❌ | ❌ | ✅📍 | ❌ | ✅ |

## audit_log

| Operation | Buyer | Society Admin | Platform Admin |
|---|---|---|
| SELECT | ❌ | ✅📍 | ✅ |
| INSERT | ✅ (actor_id = self) | ✅ | ✅ |
| UPDATE | 🔒 | 🔒 | 🔒 |
| DELETE | 🔒 | 🔒 | 🔒 |
