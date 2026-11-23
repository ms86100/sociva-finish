# Cleaner City - Phase 1 Remediation Plan

**Date:** 2026-11-01  
**Basis:** Seven audit reports + live re-validation against repo and prod `kkzkuyhgdvyecmxtmkpy`  
**Goal:** Make Cleaner City safe for a controlled resident pilot (security + journey blockers). No unrelated features.

---

## Re-validation of P0s (still present)

| # | Defect | Prod / code status |
|---|--------|--------------------|
| 1 | `commute_publications_select` society full-row (coords) | **CONFIRMED** in prod policy |
| 2 | `commute_circles_read` society-wide invite_code | **CONFIRMED**; no leave RPC; no invite_expires_at |
| 3 | SOS contacts without `notify_user_id` | **CONFIRMED** in Safety UI |
| 4 | `cleaner_city_publish_commute` no coord guard | **CONFIRMED** in unit4 definition |
| 5 | RoutePage Bangalore overwrite | **CONFIRMED** `CleanerCityRoutePage.tsx:46-57` |
| 6 | Publication cancel no guest cascade | **CONFIRMED** |
| 7 | Waitlist notify only on confirm-publish | **CONFIRMED** |
| 8 | Cross-publication double-book | **CONFIRMED** in request_ride |
| 9 | Autopilot no nightly email re-check / soft idempotency | **CONFIRMED** |
| 10 | Matching marketed as route overlap | **CONFIRMED** hub copy + haversine |
| 11 | No true background tracking | **CONFIRMED** - Phase 1 will keep honest copy (Approach: document, do not fake) |

---

## Approach decisions

| Topic | Decision |
|-------|----------|
| Matching | **Approach B for pilot:** keep haversine proxy; rename UI/reason copy to "approximate corridor fit" - no silent score meaning change |
| Background GPS | **Defer native BG** to post-Phase-1; keep honest "keep app open" claims; do not advertise pocket tracking |
| Coordinate privacy | Restrict table SELECT to host/admin/society_admin; discovery via SECURITY DEFINER match RPC only |
| Circles | Members-only SELECT; invite_code only via owner RPC; expiry 14d + rotate; leave + owner remove; join society/neighbour gate |
| SOS | Phone lookup to link Sociva user (same/neighbour society); honest phone-only UI; return notify fan-out counts; society-admin push on SOS |
| Publish pins | Server resolves schedule+office coords; reject if missing/invalid; write coords on insert |
| Cancel publication | Cascade cancel active rides; notify guests; release seats; waitlist notify; reason + events; idempotent |
| Waitlist | Shared seat-available helper on all seat++ paths; exclude blocks; soft distance filter when waitlist has pins; notify without false reservation |
| Double-book | Server check + partial unique index via expression where possible |
| Autopilot | Email verified filter; unique active index; skip if cancelled exists; disable cancels drafts |

---

## Migration

**File:** `supabase/migrations/20261102230000_cleaner_city_phase1_remediation.sql`  
**Rollback:** `supabase/rollbacks/20261102230000_cleaner_city_phase1_remediation.rollback.sql` (best-effort restore prior policies/functions)

**Prod apply:** Via Supabase `apply_migration` after local file is ready. No destructive user data deletes. Additive columns + policy/function replaces.

---

## Application files

| File | Change |
|------|--------|
| `CleanerCityRoutePage.tsx` | Load real saved lat/lng; never Bangalore overwrite |
| `CleanerCitySafetyPage.tsx` | Link Sociva by phone; honest phone-only copy |
| `CleanerCityCirclesPage.tsx` | Leave / remove / expiry / owner-only invite |
| `CleanerCityPage.tsx` | Matching honesty copy |
| `CleanerCityRidePage.tsx` | SOS result honesty; tracking claims |
| `matchCopy.ts` | Rename overlap labels |
| `useCleanerCity.ts` | New RPCs: leave/remove/rotate invite, phone lookup, cancel reason |
| Tests | Real behavior tests + SQL selftest RPC |

---

## Implementation order

1. Security: publications RLS, circles RLS/ops, SOS honesty, publish pin validation  
2. Journey: RoutePage, cancel cascade, waitlist, double-book, autopilot  
3. Honesty: matching copy, pocket-safe claims  
4. Tests + apply migration + reports  

---

## Out of scope this phase

- True native background geolocation plugin  
- Real road-polyline matching (Approach A)  
- SMS/112 dialer  
- Masked calling  
- Repeat-last-commute CTA  
- Meetup POI seed data (ops)  
- Gamification / new marketing features  

---

## First critical fix

**Publication coordinate exposure** - change RLS so ordinary society members cannot `SELECT` exact coords (or any full publication row) from the table API; hosts retain access for their own rows.
