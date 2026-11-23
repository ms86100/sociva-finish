# 03 - Internal Content Leakage

**Audit date:** 2026-11-10  
**Rule:** Ordinary residents must never see admin, developer, test, or engine internals.

---

## 1. Critical ungated surfaces

| ID | Path / surface | What leaks | Intended audience | Remediation | Status |
|----|----------------|------------|-------------------|-------------|--------|
| L01 | `/docs` | Platform architecture, RLS, `notification_queue`, feature keys | Admin | Wrap in `AdminRoute` | Resolved |
| L02 | `/push-debug` | FCM tokens, BUILD_ID, user id, push_logs | Admin | Wrap in `AdminRoute` | Resolved |
| L03 | `/la-debug` | Live activity entity IDs, raw KV dump | Admin | Wrap in `AdminRoute` | Resolved |
| L04 | `/cleaner-city/prototype/*` | Demo prototype, admin notes | Reviewer / DEV | Gate: `AdminOrDevRoute` | Resolved |

Docs claim Push Debug is admin-only (`AuthOnboardingDocs`); route does not match.

---

## 2. Customer UI technical / dummy leaks

| ID | Location | Issue | Remediation | Status |
|----|----------|-------|-------------|--------|
| L05 | `CleanerCityPage` + `homeDemoRides.ts` | Fictitious hosts (Ananya Mehta, etc.) when no live matches | Empty state; remove demo fallback in prod UI | Resolved |
| L06 | `CleanerCityRidePage` | "admin petrol price" in resident copy | Plain fuel contribution wording | Resolved |
| L07 | Match cards / home | `% road overlap`, `Match power`, corridor engine jargon as primary | Soften to route match language | Resolved |
| L08 | `DropRunPanel` | `haversine_fallback` provider string | Hide provider; "approximate route" | Resolved |
| L09 | Host offer card | Raw `published` status; lat/lng pins | Human status; hide coordinates | Resolved |
| L10 | `App.tsx` MutationCache | `toast.error(String(message))` raw server errors | Friendly message; log raw | Resolved |
| L11 | Cleaner City Find page | Many `toast.error(e?.message)` | Friendly fallbacks | Resolved (Find); other CC pages partial |
| L12 | `useOrderDetail` | Toast mentions `notification_queue` | Already user-facing notify failure text | Already OK |
| L13 | Profile `NotificationHealthCheck` | Technical `status.detail` | Admin-only | Resolved |
| L14 | Seller `DraftProductManager` | "Feature Flags" label | Availability / add-ons wording | Resolved |
| L15 | HelpHub `?demo=1` | Mock workers and phones | Document; do not surface without demo flag | Documented; no prod link |
| L16 | Staging banner | Supabase host on staging builds | Keep staging-only | OK if APP_ENV=staging |
| L17 | Pickup-code copy | Guest told to show code to "rider" (wrong actor) | Show to host | Resolved |

---

## 3. Not customer leaks (acceptable)

| Item | Why OK |
|------|--------|
| `/admin/*`, `/test-results`, `/api-docs` | Behind `AdminRoute` |
| Legal "Consumer Protection" | Statutory language |
| Society expense "Vendor Name" | Domain-specific expense field |
| QA OTP phones in `qa-otp-bypass.ts` | Auth test harness; not labeled in UI as sample users |
| Placeholder `9876543210` on workforce form | Format hint only |
| No Lorem ipsum / John Doe / Test Seller in customer `src/` UI | Confirmed absent (tests only) |

---

## 4. Notification / server copy

Canonical push text lives in migrations, SQL triggers, and `supabase/functions/_shared/notification-display-copy.ts`.  
Phase 8 edits only wording that violates terminology; do not change queue delivery.

---

## 5. Verification checklist (Phase 9)

- [ ] Non-admin cannot open `/docs`, `/push-debug`, `/la-debug`, prototype
- [ ] Cleaner City home shows empty state, not fake hosts, when no matches
- [ ] No "admin petrol", RLS, notification_queue, feature flags in resident UI
- [ ] Failed mutations show friendly toasts
- [ ] Legitimate seller/user names and phones still render
