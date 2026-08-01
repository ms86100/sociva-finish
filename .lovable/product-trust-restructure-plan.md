# Sociva Trust Infrastructure Restructure Plan

## Executive Summary

Repositioning Sociva from a community marketplace app to **the default trust and governance layer for residential communities**. The marketplace becomes a secondary feature. The homepage leads with society health, transparency, and accountability metrics. New infrastructure includes weekly digest notifications, collective issue escalation, monthly report cards, and a verification-pending preview mode.

---

## Current State Assessment

| Feature | Emotional Value | Trust-Building | Habit-Forming | Lock-in |
|---|---|---|---|---|
| Marketplace (food ordering) | Low | Low | Medium | Low — WhatsApp replaceable |
| Society Finances | **High** | **High** | Medium | **High** — data lock-in |
| Construction Progress | **High** | **High** | Low | **High** — photo evidence |
| Dispute System | **High** | **High** | Low | **High** — resolution records |
| Snag Management | **High** | **High** | Low | **High** — SLA tracking |
| Bulletin Board | Medium | Medium | Medium | Low |
| Trust Score | **High** | **High** | Medium | **High** — unique metric |
| Activity Feed | Medium | **High** | **High** | Medium |
| Maintenance Tracker | Medium | Medium | **High** | **High** — recurring need |

**Critical Gap:** High-value features (Trust, Finances, Disputes, Progress) are buried below marketplace. Homepage communicates "food app" not "trust platform."

---

## Phase 1: Trust Dashboard

**Status: Implemented**

### Required Changes
- Created `useSocietyHealthMetrics` hook — single aggregated query via `Promise.all` with 60s `staleTime`
- Created `SocietyHealthDashboard` component — top-level widget showing:
  - Trust Score with trend indicator
  - Committee response time
  - Disputes resolved this month
  - Snags fixed this month
  - Financial summary (expenses documented)
  - Construction progress %
- Redesigned `HomePage.tsx` — society health dashboard appears above all marketplace content
- Marketplace sections moved below health dashboard with "Marketplace" section header

### RLS Impact
- **None** — all queries use existing RLS policies via `effectiveSocietyId`
- No new policies needed; reads from `societies`, `dispute_tickets`, `snag_tickets`, `society_expenses`, `construction_milestones`

### Index Impact
- Uses existing indexes on `society_id` columns
- Existing indexes sufficient: `snag_tickets(society_id)`, `dispute_tickets(society_id)`, `society_expenses(society_id)`

### Scalability Risk: LOW
- 7 parallel count queries per homepage load — all indexed, head-only
- 60-second staleTime prevents redundant fetches
- React Query deduplication prevents parallel requests
- Safe at 1M+ users (count queries on indexed columns = O(index scan))

### Caching Strategy
- React Query with `staleTime: 60_000` (1 minute)
- Query key includes `effectiveSocietyId` for multi-tenant cache isolation
- Background refetch on window focus

---

## Phase 2: Weekly Digest

**Status: Implemented**

### Required Changes
- Created `generate-weekly-digest` edge function
- Aggregates per society: expenses added, disputes resolved, snags closed, milestones posted, trust score change
- Inserts summary into `notification_queue` for each approved member
- Scheduled via pg_cron (weekly, Sunday 9 AM IST)

### RLS Impact
- **None** — edge function uses `SUPABASE_SERVICE_ROLE_KEY` (bypasses RLS)
- Notification queue insertion uses existing INSERT policy (`user_id IS NOT NULL`)

### Index Impact
- Uses existing `society_id` indexes on all aggregated tables
- Uses existing `notification_queue` indexes

### Scalability Risk: LOW
- Batched per society — no full table scans
- Count-only queries (head: true) — minimal I/O
- 100 societies × 7 queries = 700 lightweight queries
- Async execution — no user-facing latency
- Estimated execution time: <30s for 100 societies

### Performance Impact
- Runs once weekly during off-peak hours
- No transaction contention — read-only aggregation + queue inserts
- Notification delivery handled by existing `process-notification-queue` function

---

## Phase 3: Maintenance Payments

**Status: Not Implemented — Requires Razorpay integration**

### Required Changes
- New table: `maintenance_payments` (id, society_id, user_id, amount, due_month, payment_status, paid_at, razorpay_order_id, idempotency_key, created_at)
- New edge function: `create-maintenance-payment-order`
- Payment flow: create Razorpay order → redirect → webhook confirms → update status
- Idempotency via `idempotency_key` unique constraint

### RLS Additions Required
- `SELECT`: `user_id = auth.uid() OR (society_id = get_user_society_id(auth.uid()) AND is_society_admin(auth.uid(), society_id))`
- `INSERT`: `user_id = auth.uid() AND society_id = get_user_society_id(auth.uid())`
- `UPDATE`: `(society_id = get_user_society_id(auth.uid()) AND is_society_admin(auth.uid(), society_id))`

### Index Requirements
- `(society_id, payment_status)` composite index
- `(user_id, payment_status)` composite index
- `(idempotency_key)` unique index

### Scalability Risk: MEDIUM
- Payment processing is inherently latency-sensitive
- Idempotency prevents duplicate charges
- Audit logging on status change required
- Razorpay webhook processing must be idempotent
- Safe at scale with proper connection pooling

### Blockers
- Requires `RAZORPAY_KEY_ID` and `RAZORPAY_KEY_SECRET` secrets
- Requires Razorpay Route activation for per-society settlements
- Recommend implementing after core trust features are validated

---

## Phase 4: Collective Escalation

**Status: Implemented**

### Required Changes
- New table: `collective_escalations` (id, society_id, category, tower_id, snag_count, resident_count, sample_photos, status, created_at, resolved_at)
- New edge function: `detect-collective-issues` — scans open snags, groups by (society_id, category, tower_id), creates escalation when threshold (5+) met
- UI badge on SnagListPage showing "X residents reported this"
- Admin notification on new escalation
- Scheduled via pg_cron (every 6 hours)

### RLS Additions
- `SELECT`: `society_id = get_user_society_id(auth.uid()) OR is_admin(auth.uid())`
- `INSERT`: Service role only (edge function)
- `UPDATE`: `is_society_admin(auth.uid(), society_id) OR is_admin(auth.uid())`
- No `DELETE` — escalations are historical records

### Index Requirements
- `snag_tickets(society_id, category, status)` composite index — for grouping query
- `collective_escalations(society_id, status)` composite index

### Trigger Requirements
- None — detection is scheduled, not trigger-based
- Avoids per-INSERT overhead

### Scalability Risk: LOW
- Scheduled execution (every 6 hours) — no real-time overhead
- Aggregation query uses composite index — O(index scan)
- No per-request computation
- Safe at 1M+ users

### Cross-Society Leakage Risk: NONE
- All queries filtered by `society_id`
- RLS enforces society isolation on reads

---

## Phase 5: Society Report Card

**Status: Implemented**

### Required Changes
- New edge function: `generate-society-report`
- Generates structured JSON report (not PDF — PDF generation requires external library)
- Stores report in `society_reports` table for archival
- Includes: financial breakdown, resolution rates, response times, trust score, community engagement
- Scheduled monthly via pg_cron (1st of month, 6 AM IST)
- Notifications sent to all society members

### RLS Additions
- `SELECT`: `society_id = get_user_society_id(auth.uid()) OR is_admin(auth.uid())`
- `INSERT`: Service role only
- No `UPDATE`/`DELETE` — reports are immutable

### Index Requirements
- `society_reports(society_id, report_month)` composite unique index

### Storage Impact
- ~2KB per report per society per month
- 100 societies × 12 months = 1.2MB/year — negligible

### Scalability Risk: LOW
- Monthly execution — minimal overhead
- Aggregation uses existing indexes
- No user-facing latency

---

## Phase 6: Preview Mode (Verification Pending Redesign)

**Status: Implemented**

### Required Changes
- Redesigned verification pending screen:
  - Shows estimated queue position (count of pending profiles before user)
  - Shows average approval time (based on historical approved profiles)
  - Read-only preview of society health dashboard (trust score, recent activity count, member count)
- No new RLS policies needed — preview data is publicly aggregable

### UI Restrictions vs RLS Changes
- **UI-only restrictions** — no RLS weakening
- Preview shows aggregate counts only (no PII, no individual records)
- Queries use `profiles` table count (public aggregate) and `societies` table (trust_score is public)
- Write actions remain blocked by existing RLS policies (all require `get_user_society_id(auth.uid())` which returns null for unapproved users)

### Risk of Data Exposure: NONE
- Only shows: trust score (public), member count (aggregate), queue position (count of pending)
- No individual user data, no financial details, no dispute content

### Abuse Mitigation
- Queue position is a simple count — no information about other users
- Average approval time is society-wide aggregate
- Preview dashboard shows same data as `SocietyTrustBadge` (already public to society members)

---

## Multi-Tenant Safety Verification

| Phase | New RLS Policies | SECURITY DEFINER | Triggers | Cross-Society Risk | Breaks Context Switch | New Indexes | Safe at 1M | Transaction Contention | Background Batching |
|---|---|---|---|---|---|---|---|---|---|
| 1. Trust Dashboard | No | No | No | None | No | No | Yes | No | No |
| 2. Weekly Digest | No | No | No | None | No | No | Yes | No | Yes (pg_cron) |
| 3. Maintenance Payments | Yes (4) | No | Yes (audit) | None | No | Yes (3) | Yes | Low | No |
| 4. Collective Escalation | Yes (3) | No | No | None | No | Yes (2) | Yes | No | Yes (pg_cron) |
| 5. Report Card | Yes (1) | No | No | None | No | Yes (1) | Yes | No | Yes (pg_cron) |
| 6. Preview Mode | No | No | No | None | No | No | Yes | No | No |

---

## RLS Impact Summary

### Existing Policies — No Changes
- All Phase 1 queries use existing RLS on `societies`, `dispute_tickets`, `snag_tickets`, `society_expenses`, `construction_milestones`
- Phase 2 uses service role key (bypasses RLS)
- Phase 6 uses aggregate queries on existing tables

### New Policies Added
- `collective_escalations`: SELECT (society members), UPDATE (society admins)
- `society_reports`: SELECT (society members)
- `maintenance_payments` (Phase 3, not yet implemented): SELECT, INSERT, UPDATE

---

## New Index Requirements

| Table | Index | Purpose | Phase |
|---|---|---|---|
| `snag_tickets` | `(society_id, category, status)` | Collective escalation grouping | 4 |
| `collective_escalations` | `(society_id, status)` | Active escalation lookup | 4 |
| `society_reports` | `(society_id, report_month)` UNIQUE | Report deduplication | 5 |
| `maintenance_payments` | `(society_id, payment_status)` | Payment filtering | 3 |
| `maintenance_payments` | `(user_id, payment_status)` | User payment history | 3 |
| `user_notifications` | `(society_id)` WHERE NOT NULL | Notification filtering | Previously added |

---

## Edge Functions Added

| Function | Schedule | Purpose | Phase |
|---|---|---|---|
| `generate-weekly-digest` | Weekly (Sun 9 AM IST) | Society activity summary notifications | 2 |
| `detect-collective-issues` | Every 6 hours | Group similar snags into escalations | 4 |
| `generate-society-report` | Monthly (1st, 6 AM IST) | Archival society health report | 5 |

---

## Trigger Additions

| Trigger | Table | Purpose | Phase |
|---|---|---|---|
| None added | — | All new features use scheduled jobs instead of triggers | — |

**Design Decision:** Triggers were avoided in favor of scheduled background jobs to prevent per-INSERT overhead and transaction contention. This is safer at scale.

---

## Risk Matrix

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Homepage query count (7 parallel) | Low | Medium | 60s staleTime, head-only counts, indexed columns |
| Weekly digest timeout | Low | Low | Per-society batching, count-only queries |
| Collective escalation false positives | Medium | Low | Threshold tunable, admin can dismiss |
| Report card data staleness | Low | Low | Generated monthly, reflects past period |
| Preview mode data exposure | Very Low | Medium | Aggregate-only data, no PII |
| Maintenance payment double-charge | Low | **High** | Idempotency key, webhook verification |

---

## Implementation Timeline

| Phase | Effort | Dependencies | Priority |
|---|---|---|---|
| 1. Trust Dashboard | ✅ Complete | None | P0 — CRITICAL |
| 2. Weekly Digest | ✅ Complete | pg_cron setup | P0 — CRITICAL |
| 4. Collective Escalation | ✅ Complete | Migration approval | P1 — HIGH |
| 6. Preview Mode | ✅ Complete | None | P1 — HIGH |
| 5. Report Card | ✅ Complete | Migration approval | P2 — MEDIUM |
| 3. Maintenance Payments | ❌ Not started | Razorpay secrets | P2 — MEDIUM |

---

## Phase 7: Visitor Management System

**Status: Implemented**

### Required Changes
- New table: `visitor_entries` with society-scoped RLS
- Features: pre-approved guests with OTP, check-in/check-out tracking, vehicle logging, visitor type classification
- Page: `/visitors` — today/upcoming/history tabs
- Integrated into Society Dashboard grid

### RLS Impact
- 4 policies: SELECT (own + society admin), INSERT (own), UPDATE (own + admin), DELETE (own)
- Composite indexes on `(society_id, status)`, `(resident_id, status)`, partial index on `otp_code`

### Scalability Risk: LOW
- Queries scoped to resident_id — O(index scan)

---

## Phase 8: Payment Milestone Tracker

**Status: Implemented**

### Required Changes
- New tables: `payment_milestones` (society-wide schedule), `resident_payments` (per-resident tracking)
- Timeline view grouped by construction stage (booking → possession)
- Progress bar showing paid vs total percentage
- Linked to construction milestones
- Page: `/payment-milestones`

### RLS Impact
- `payment_milestones`: SELECT (society members), INSERT/UPDATE/DELETE (admins)
- `resident_payments`: SELECT (own + admin), INSERT (admin + own), UPDATE (own + admin)

### Scalability Risk: LOW
- Small dataset per society (6-10 milestones max)

---

## Phase 9: Pre-Handover Inspection Checklist

**Status: Implemented**

### Required Changes
- New tables: `inspection_checklists` (per-flat), `inspection_items` (70+ items with pass/fail/na status)
- 8 categories: electrical, plumbing, civil, painting, doors/windows, kitchen, bathroom, flooring
- Pre-populated with 70+ standard Indian real estate inspection items
- Severity tracking (minor/major/critical), notes for failed items
- Submit to builder workflow
- Page: `/inspection`

### RLS Impact
- Checklists: SELECT (own + admin), INSERT (own), UPDATE (own + admin)
- Items: all operations gated through parent checklist ownership

### Scalability Risk: LOW
- One checklist per flat per possession cycle

---

## Final Readiness Score

| Category | Score | Notes |
|---|---|---|
| Trust-First Positioning | ✅ 9/10 | Homepage leads with health dashboard |
| Multi-Tenant Isolation | ✅ 10/10 | All queries use effectiveSocietyId, RLS intact |
| Habit Formation | ✅ 7/10 | Weekly digest + daily health dashboard (missing: daily check-in) |
| Data Lock-in | ✅ 8/10 | Financial, dispute, snag records create switching cost |
| Emotional Impact | ✅ 8/10 | Collective voice + trust score + transparency metrics |
| Scalability | ✅ 9/10 | All scheduled jobs batched, indexed queries, no N+1 |
| Payment Integration | ❌ 3/10 | Maintenance payments not yet implemented |
| Competitive Moat | ✅ 7/10 | Trust score + collective escalation are unique |
