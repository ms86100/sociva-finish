# Security & Gate Module — Feature & Rule Inventory

## Module Scope

| Area | Count |
|------|-------|
| Pages | 7 (Guard Kiosk, Gate Entry, Security Verify, Security Audit, Visitor Management, Parcel Management, Authorized Persons) |
| Components | 11 (GuardResidentQRTab, GuardVisitorOTPTab, GuardDeliveryTab, GuardManualEntryTab, GuardGateLogTab, ExpectedVisitorsList, QRCodeDisplay, ResidentConfirmation, ManualEntryApproval, GuardConfirmationPoller, WorkerGateValidation) |
| Edge Functions | 1 (gate-token) |
| DB Tables | 5 (gate_entries, visitor_entries, manual_entry_requests, parcel_entries, security_staff) |
| RPCs | 3 (is_security_officer, get_unified_gate_log, validate_worker_entry) |

---

## Feature Inventory

### 1. Guard Kiosk (`/guard-kiosk`)
- **Access**: Society admins, platform admins, or security officers only
- **Feature gate**: `guard_kiosk`
- **Tabs**: QR, OTP, Manual, Delivery, Worker, Expected, Log (7 tabs)
- **Access check**: `is_security_officer` RPC (SECURITY DEFINER) checks `security_staff` table + falls back to `is_society_admin`

### 2. Resident QR Verification (GuardResidentQRTab)
- Token paste/scan → POST to `gate-token?action=validate`
- Token format: AES-GCM encrypted payload + HMAC-SHA256 signature
- Expiry: 60-second window (server-enforced)
- Nonce dedup: `notes` column with `nonce:` prefix
- Basic mode: immediate entry logged
- Confirmation mode: `awaiting_confirmation` flag → GuardConfirmationPoller
- Unverified residents rejected (403)
- Non-officer validators rejected (403)

### 3. Visitor OTP Verification (GuardVisitorOTPTab)
- 6-digit OTP input with InputOTP component
- Queries `visitor_entries` by `society_id` + `otp_code`
- Expired OTP check: `otp_expires_at < now()`
- Check-in: updates `status` to `checked_in`, `checked_in_at`, creates `gate_entries` record
- Deny: resets state

### 4. Manual Entry (GuardManualEntryTab)
- Flat number + person name input
- Rate limiting: POST to `gate-token?action=rate_check_manual` (429 on limit)
- Creates `manual_entry_requests` row with `status: pending`
- Realtime subscription for response updates
- Notification enqueued for resident
- States: idle → sent → approved/denied/expired

### 5. Delivery Verification (GuardDeliveryTab)
- Search by delivery code, rider name, or phone
- Queries `delivery_assignments` joined with orders
- Allow entry: updates status to `at_gate`, creates `gate_entries` record
- PendingDeliveries sub-component shows active deliveries

### 6. Worker Gate Validation (WorkerGateValidation)
- Worker ID input → `validate_worker_entry` RPC
- Checks: active status, not deactivated, correct day, within shift hours, has flat assignments
- Blocks: suspended, blacklisted, outside hours, no assignments
- Entry logged in `worker_entry_logs` and `gate_entries`

### 7. Expected Visitors (ExpectedVisitorsList)
- Queries `visitor_entries` for today + recurring
- Quick check-in button for expected visitors
- Now logs `gate_entries` for audit completeness (G7 fix)
- Counters: expected today, currently inside

### 8. Gate Activity Log (GuardGateLogTab)
- Calls `get_unified_gate_log` RPC (unions visitor_entries, gate_entries, worker_attendance, delivery_assignments)
- Filtered by date (today)
- Color-coded by entry type (visitor, delivery, resident, worker)

### 9. Gate Entry Page (`/gate-entry`)
- Resident-facing: shows pending manual entry requests
- Resident confirmation: approve/deny manual entries
- Realtime + 5s polling fallback

### 10. Security Audit (`/security/audit`)
- Role-scoped: officers see own verifications, admins see all
- Filters: date range, entry type, confirmation status, resident name
- CSV export
- Pagination with configurable page size
- Metrics: today count, manual %, denied %, avg confirmation time

### 11. Visitor Management (`/visitors`)
- Add visitor: generates 6-digit OTP, sets expiry
- Pre-approved flag controls auto-entry
- Recurring visitors with day selection
- Status transitions: expected → checked_in → checked_out / cancelled
- OTP copy to clipboard
- Tabs: Today, Upcoming, History

### 12. Parcel Management (`/parcels`)
- Resident logs own parcel
- Admin/guard flat lookup → log for resident (G5 fix enables this)
- Collect marks as collected with timestamp
- Tabs: Pending, Collected

### 13. Authorized Persons (`/authorized-persons`)
- Add with name, relationship, phone, photo
- Remove sets `is_active = false` (soft delete)
- Feature-gated under `visitor_management`

### 14. Security Verify (`/security/verify`)
- Deprecated redirect to `/guard-kiosk`

---

## Discovered Issues

| ID | Severity | Description | Status |
|----|----------|-------------|--------|
| G1 | CRITICAL | GuardGateLogTab passes `_limit: 50` instead of `_date` to `get_unified_gate_log` RPC | ✅ Fixed |
| G2 | MEDIUM | PendingDeliveries uses `useState()` for async fetch instead of `useEffect` | ✅ Fixed |
| G3 | MEDIUM | GuardResidentQRTab duplicates manual entry logic from GuardManualEntryTab | ✅ Fixed (removed) |
| G4 | LOW | Visitor OTP query lacks explicit security officer RLS policy | Documented (functionally safe) |
| G5 | LOW | Parcel INSERT RLS blocks admin/guard inserts for other residents | ✅ Fixed (migration) |
| G6 | INFO | SecurityVerifyPage is deprecated redirect | By design |
| G7 | INFO | Expected visitor quick check-in bypasses gate_entries audit logging | ✅ Fixed |

---

## RLS Policy Summary

### gate_entries
- SELECT: `is_security_officer(uid, society_id)` or society member
- INSERT: `is_security_officer(uid, society_id)`
- UPDATE: `is_security_officer(uid, society_id)` (confirmation updates)

### visitor_entries
- SELECT: own entries or `is_society_admin`
- INSERT: `can_write_to_society`
- UPDATE: own entries or `is_society_admin`

### manual_entry_requests
- SELECT: requestor or target resident or admin
- INSERT: security officers
- UPDATE: target resident (approve/deny)

### parcel_entries
- SELECT: own or admin
- INSERT: `(resident_id = uid AND can_write_to_society) OR is_society_admin OR is_admin` (G5 fix)
- UPDATE: own or admin

### security_staff
- SELECT: admin or society admin
- INSERT/UPDATE/DELETE: admin only

---

## Test Coverage

See `src/test/security-gate.test.ts` — 65 test cases covering all features above.
