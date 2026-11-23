# Cleaner City - Phase 1 Implementation Report

**Date:** 2026-11-01  
**Migration:** `20261102230000_cleaner_city_phase1_remediation.sql` (applied to prod `kkzkuyhgdvyecmxtmkpy`)  
**Rollback:** `supabase/rollbacks/20261102230000_cleaner_city_phase1_remediation.rollback.sql`

---

## Defect log

### 1. Publication coordinate exposure (audit P0-S1 / H privacy)

| Field | Detail |
|-------|--------|
| Root cause | `commute_publications_select` allowed society members to SELECT published rows including lat/lng |
| Change | RLS SELECT limited to host / admin / society_admin |
| Evidence | Prod policy qual now `(is_admin OR is_society_admin OR host_user_id = auth.uid())` |
| Before | Society peer could `select origin_latitude...` |
| After | Society peer denied by RLS; discovery via `cleaner_city_find_matches` only |
| Test | `cleaner_city_phase1_privacy_selftest()` → `publications_select_blocks_society_peers: true`; vitest remediation suite |
| Remaining | Live dual-user JWT SELECT abuse test BLOCKED without seeded dual sessions |

### 2. Circle invite-code exposure (audit P0-S2)

| Field | Detail |
|-------|--------|
| Root cause | `commute_circles_read` society-wide SELECT exposed `invite_code` |
| Change | Members-only SELECT; `invite_expires_at` (14d); rotate/leave/remove RPCs; join society/neighbour gate; `my_circles` returns invite only to owners |
| Files | Migration; `CleanerCityCirclesPage.tsx`; `useLeaveCircle` / `useRotateCircleInvite` / `useRemoveCircleMember` |
| Before | Any society peer could read invite codes; no leave |
| After | Non-members cannot SELECT circles; leave/rotate available |
| Test | Selftest `circles_read_members_only`, `leave_circle_rpc`, `invite_expires_column`; vitest circles UI |
| Remaining | Three-account live RLS exercise BLOCKED; member-remove UI uses RPC but no member picker UI yet (RPC exists) |

### 3. SOS / emergency contact honesty (audit P0-S3 / H2)

| Field | Detail |
|-------|--------|
| Root cause | Safety UI never set `notify_user_id`; copy claimed contact notify |
| Change | `cleaner_city_resolve_emergency_notify_user`; Safety links by phone when Sociva neighbour exists; `report_incident` returns jsonb fan-out (`sms_sent:false`); admin in-app notify; Ride toast uses counts |
| Before | Phone contacts display-only; toast "SOS sent" |
| After | Linked contacts notified in-app; phone-only skipped counted; no SMS claim |
| Test | Migration contains honesty flags; vitest Safety/Ride copy |
| Remaining | SMS still not implemented (honest); provider failure path not e2e tested |

### 4. Server-side publish pin validation (audit P0 publish)

| Field | Detail |
|-------|--------|
| Root cause | `cleaner_city_publish_commute` published without coords |
| Change | Server loads schedule pickup + office; validates ranges; writes coords; rejects if missing |
| Before | Null-coord publications possible via RPC |
| After | RPC raises `Valid pickup/office coordinates required` |
| Test | Selftest `publish_pin_guard: true` |
| Remaining | Direct RPC call with auth user fixture BLOCKED in this environment |

### 5. Bangalore pickup overwrite (audit H1)

| Field | Detail |
|-------|--------|
| Root cause | RoutePage hydrated pickup with `12.9716,77.5946` when label existed |
| Change | Hydrate only from saved lat/lng; clear if missing; save validates finite coords |
| File | `CleanerCityRoutePage.tsx` |
| Test | vitest asserts no Bangalore constants on RoutePage |
| Remaining | Device UI reproduction not run (static + code proof) |

### 6. Publication cancel + guest recovery (audit H4)

| Field | Detail |
|-------|--------|
| Root cause | `cancel_publication` only flipped status |
| Change | Cascades cancel active rides; ride_events; guest notify; optional reason; idempotent if already cancelled |
| Test | Migration contract tests |
| Remaining | Multi-guest live e2e BLOCKED |

### 7. Waitlist on all seat-release paths (audit H8)

| Field | Detail |
|-------|--------|
| Root cause | Notify only on draft confirm |
| Change | `cleaner_city_release_publication_seat` used by cancel_ride, no_show, timeouts, reject; notify excludes blocks; soft 5km filter; non-reservation copy |
| Remaining | Concurrent claim race still first-request-wins (no hold) - intentional for Phase1 |

### 8. Guest double-booking (audit P0)

| Field | Detail |
|-------|--------|
| Change | `request_ride` rejects second active ride same date+direction |
| Remaining | Partial unique index across joined direction not added (enforced in RPC) |

### 9. Autopilot hardening (audit P0)

| Field | Detail |
|-------|--------|
| Change | Nightly `cleaner_city_is_work_email_verified`; unique active index; skip cancelled days; disable cancels drafts |
| Test | Selftest unique index; migration contracts |
| Remaining | Concurrent cron stress not executed |

### 10. Matching honesty (Approach B)

| Field | Detail |
|-------|--------|
| Change | Hub + `matchCopy` renamed to approximate corridor / straight-line estimate |
| Remaining | True road matching deferred |

### 11. Pocket-Safe claims

| Field | Detail |
|-------|--------|
| Change | Ride SOS/copy states background tracking not guaranteed; no SMS |
| Remaining | Native BG tracking not implemented |

---

## App files touched

- `src/pages/cleaner-city/CleanerCityRoutePage.tsx`
- `src/pages/cleaner-city/CleanerCitySafetyPage.tsx`
- `src/pages/cleaner-city/CleanerCityCirclesPage.tsx`
- `src/pages/cleaner-city/CleanerCityPage.tsx`
- `src/pages/cleaner-city/CleanerCityRidePage.tsx`
- `src/lib/cleaner-city/matchCopy.ts`
- `src/hooks/queries/useCleanerCity.ts`
- `src/test/cleaner-city-phase0.test.ts`
- `src/test/cleaner-city-phase1-remediation.test.ts` (new)
