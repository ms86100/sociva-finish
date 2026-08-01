# Security Architecture Documentation

## Overview
The Resident Identity Verification system provides gate-level security with anti-impersonation capabilities.

## Security Modes
| Mode | Behavior | Use Case |
|------|----------|----------|
| **Basic** | QR scan → instant verify | Daytime, low-risk |
| **Confirmation** | QR scan → push to resident → approve/deny | Premium, night-time |
| **AI Match** | Future: camera + face match | Placeholder |

Configured per-society in `societies.security_mode`. Managed via Society Admin > Security tab.

## Token Architecture
- **Payload**: Only `user_id`, `society_id`, `iat`, `exp` — NO PII
- **Encryption**: AES-256-GCM (server-side secret derived from service role key)
- **Integrity**: HMAC-SHA256 signature over encrypted blob
- **Expiry**: 60 seconds, auto-refresh at 5s remaining
- **Replay prevention**: Token expiry + server-side timestamp validation

## Role Enforcement
| Layer | Mechanism |
|-------|-----------|
| Route | `useSecurityOfficer()` hook via `is_security_officer()` RPC |
| Navigation | `BottomNav` switches to kiosk-mode for security officers |
| RLS | `is_security_officer(auth.uid(), society_id)` on gate_entries |
| Edge Function | Society-scoped security_staff table check |

## Data Flow: Confirmation Mode
1. Guard scans QR → edge function validates
2. Edge function checks `societies.security_mode`
3. If `confirmation`: inserts gate_entry with `awaiting_confirmation=true`
4. Push notification sent to resident
5. Resident sees `ResidentConfirmation` component (realtime subscription)
6. Resident taps Approve/Deny → updates gate_entry
7. Guard sees result via `GuardConfirmationPoller` (realtime subscription)
8. Auto-expires after configurable timeout

## Tables Modified
- `societies`: Added `security_mode`, `security_confirmation_timeout_seconds`
- `gate_entries`: Added `awaiting_confirmation`, `confirmation_expires_at`, `confirmed_by_resident_at`, `confirmation_denied_at`

## Indexes
- `idx_gate_entries_pending_confirmation` (partial, society_id + status WHERE awaiting=true)
- `idx_gate_entries_resident_confirmation` (partial, user_id + status WHERE awaiting=true)
- `idx_gate_entries_audit` (society_id, entry_time DESC, entry_type, confirmation_status)
- `idx_gate_entries_verified_by` (verified_by, entry_time DESC)

## Security Officer Navigation
Officers see ONLY: Verify, History, Profile. No marketplace, finances, disputes, bulletin, or construction pages.

## Audit Dashboard
Route: `/security/audit` — society-scoped, paginated, filterable, CSV exportable.
Metrics: entries today, manual %, denial %, avg confirmation time.

## Files
- `supabase/functions/gate-token/index.ts` — Token generate/validate with AES+HMAC
- `src/hooks/useSecurityOfficer.ts` — RPC-based role check
- `src/hooks/useGateAudit.ts` — Paginated audit queries + metrics
- `src/components/security/ResidentConfirmation.tsx` — Resident approve/deny UI
- `src/components/security/GuardConfirmationPoller.tsx` — Guard realtime poller
- `src/components/admin/SecurityModeSettings.tsx` — Mode toggle UI
- `src/pages/SecurityAuditPage.tsx` — Full audit dashboard
- `src/components/layout/BottomNav.tsx` — Kiosk-mode nav for officers
