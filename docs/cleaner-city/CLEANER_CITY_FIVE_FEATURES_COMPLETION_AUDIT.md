# Cleaner City - Five Features Completion Audit

**Audit date:** 2026-11-01  
**Scope:** Current repository + production project `kkzkuyhgdvyecmxtmkpy`  
**Mode:** Independent post-implementation audit. **No application code was modified.**  
**Standard:** A feature is complete only when the full resident journey works, the backend enforces behaviour, security is correct, and relevant tests demonstrate it.

---

## Executive snapshot

| Feature | Honest status | Resident usable today? |
|---------|---------------|------------------------|
| 1. Daily Commute Autopilot | **Partially implemented** | Yes for hosts who enable Autopilot with verified email, vehicle, and pins - with gaps |
| 2. Honest Corridor Matching + Meeting Points | **Partially implemented / partially broken** | Find/Offer usable with caveats; matching is straight-line, not road geometry; Bangalore pin regression on Route page |
| 3. Reliability Net | **Partially implemented** | Waitlist join + timeouts + no-show exist; recovery after cancel is weak |
| 4. Trusted Commute Circles | **Scaffold only** | Create/join by code works; leave/remove/accept/circle-only/board missing; invite codes leak via RLS |
| 5. Pocket-Safe Ride | **Phase A incomplete; Phase B missing** | Quick messages + share link + incident record work; SOS does not notify saved phone contacts; no true background tracking |

**Final decision (see `CLEANER_CITY_FINAL_PRODUCT_READINESS.md`): NOT READY FOR PILOT**

---

## Methodology

1. Read must-build spec: `docs/cleaner-city/CLEANER_CITY_FIVE_MUST_BUILD_FEATURES.md`
2. Inspect migrations `20261102090000` through `20261102220000`, pages under `src/pages/cleaner-city/`, hooks `useCleanerCity.ts`, `native-location.ts`, edge OTP function
3. Queried production for tables, RPCs, cron jobs, meetup seed counts
4. Ran all 12 Cleaner City vitest files (101 tests) - all static source-contract tests
5. Ran `tsc --noEmit` - no Cleaner City type errors reported
6. Did **not** run device SOS/background GPS, Resend OTP delivery, or Playwright e2e (not available / BLOCKED)

**Critical test caveat:** Every `src/test/cleaner-city-*.test.ts` file uses `fs.readFileSync` + `toContain`. None call RPCs, exercise RLS, or drive UI. Passing vitest does **not** prove production safety or journey correctness.

---

## Production evidence (2026-11-01)

| Check | Result |
|-------|--------|
| Cron `cleaner-city-autopilot` | Active - `15 20 * * *` |
| Cron `cleaner-city-timeouts` | Active - `*/15 * * * *` |
| Cron `cleaner-city-reminders` | Active - `10 * * * *` |
| RPCs present | `cleaner_city_autopilot_run`, waitlist, circles create/join, meeting point, no_show, process_timeouts |
| `cleaner_city_leave_circle` | **Absent** |
| `society_meetup_points` rows | **0** (table exists, Greenfield not seeded) |
| `commute_circles` rows | 0 |
| Autopilot column on `commute_profiles` | Present |

---

## FEATURE 1: Daily Commute Autopilot

### Verdict: PARTIALLY IMPLEMENTED

Autopilot is a real server-side product, not a mock. Schedule page toggle + confirm mode, nightly `cleaner_city_autopilot_run` via pg_cron, draft/publish path, and hub confirm/skip exist. Gaps prevent calling it complete.

### Requirement-by-requirement

| # | Requirement | Status | Evidence |
|---|-------------|--------|----------|
| 1 | Autopilot toggle | IMPLEMENTED BUT UNTESTED | `cleaner_city_set_autopilot`; `CleanerCitySchedulePage.tsx` Switch; `useSetAutopilot` |
| 2 | Manual vs automatic confirmation | IMPLEMENTED BUT UNTESTED | `autopilot_confirm_mode` `confirm`/`auto`; UI mode buttons |
| 3 | Reads effective weekly schedule | IMPLEMENTED BUT UNTESTED | `cleaner_city_effective_schedule` called from autopilot run |
| 4 | Respects schedule overrides | IMPLEMENTED BUT UNTESTED | Override branch in effective schedule |
| 5 | WFH, holidays, paused, cancelled days | PARTIALLY IMPLEMENTED | WFH/holiday/paused respected; cancelled publication for same day can be recreated |
| 6 | Generates tomorrow publication | IMPLEMENTED BUT UNTESTED | `cleaner_city_autopilot_run(date+1)` inserts `commute_publications` |
| 7 | Scheduled Edge Function or cron | VERIFIED COMPLETE | Prod cron `cleaner-city-autopilot` active (DB cron, not Edge Function) |
| 8 | Idempotent generation | PARTIALLY IMPLEMENTED | App-level EXISTS skip; no UNIQUE constraint |
| 9 | Duplicate cron cannot create duplicates | PARTIALLY IMPLEMENTED | Race under concurrent runs; no lock/unique |
| 10 | Verifies work email still verified | PARTIALLY IMPLEMENTED | Checked at toggle time only; nightly run does not re-check |
| 11 | Vehicle + valid route pins | IMPLEMENTED BUT UNTESTED | Skips without active vehicle / pickup / office |
| 12 | Evening confirmation notification | IMPLEMENTED BUT UNTESTED | Draft push + reminders cron |
| 13 | Confirm / Skip / WFH | PARTIALLY IMPLEMENTED | Confirm+Skip on hub; no WFH action on draft card |
| 14 | Notify passengers when seats available | PARTIALLY IMPLEMENTED | Waitlist notify on publish confirm only, not on cancel/no-show seat free |
| 15 | Tomorrow card on hub | PARTIALLY IMPLEMENTED | Draft list card; not date-labelled "Tomorrow"; empty in auto mode |
| 16 | Repeat previous commute | NOT IMPLEMENTED | No CTA/RPC in repo |
| 17 | Push opens correct screen | IMPLEMENTED BUT UNTESTED | `reference_path` `/cleaner-city` or `/cleaner-city/ride/:id` |
| 18 | Disable Autopilot immediately | PARTIALLY IMPLEMENTED | Stops future runs; does not cancel tonight's draft |

### Scenario coverage (design intent vs code)

| Scenario | Expected | Actual |
|----------|----------|--------|
| Mon-Fri schedule | Draft/publish workdays | Supported via template + autopilot |
| Tuesday WFH | Skip generation | Override `is_working=false` skips |
| Schedule changed after draft | Regenerate or update | Draft not auto-updated |
| Pause Autopilot | Stop supply | Flag stops next cron; draft remains |
| Delete vehicle | No publish | Nightly skip if no active vehicle |
| Lose work email verification | No publish | **Gap:** nightly run does not re-verify |
| Cron twice | One publication | Soft EXISTS only; race possible |
| Notification provider fails | Graceful | Queue insert; no retry UX for host |
| Confirm after publish time | Still live | Confirm publishes draft anytime |
| Change departure time | Affect next draft | Next run uses new schedule; existing draft stale |

---

## FEATURE 2: Honest Corridor Matching + Smart Meeting Points

### Verdict: PARTIALLY IMPLEMENTED / PARTIALLY BROKEN

Find sends guest pickup and client-gates missing pins. Match cards show human reasons. Meeting-point columns/RPC/UI exist. But production matching is **haversine detour proxy**, not road polyline; Offer publish is not server-enforced for coords; Route page can still write Bangalore defaults; publications RLS leaks exact coords; meetup table has **zero** seeded points.

### Requirement-by-requirement

| # | Requirement | Status | Evidence |
|---|-------------|--------|----------|
| 1 | Find sends guest pickup lat/lng | IMPLEMENTED BUT UNTESTED | `CleanerCityFindPage.tsx` → `guest_pickup_lat/lng` |
| 2 | Pickup mandatory when required | PARTIALLY IMPLEMENTED | Client gate; RPC optional/`pickup_coords_missing` |
| 3 | Offer rejects without origin/dest | BROKEN | `cleaner_city_publish_commute` has no coord check |
| 4 | Silent Bangalore fallback removed | BROKEN | `CleanerCityRoutePage.tsx:49-56` still defaults pickup to `12.9716, 77.5946` |
| 5 | Matching uses actual route geometry | BROKEN | `cleaner_city_find_matches` never scores with `route_polyline` |
| 6 | Route overlap calculated correctly | PARTIALLY IMPLEMENTED | Proxy `100*(1-extra/direct)` from haversine |
| 7 | Detour via realistic road routes | BROKEN | Detour minutes = haversine estimate only |
| 8 | Departure-time windows configurable | IMPLEMENTED BUT UNTESTED | Admin `departure_difference_minutes` |
| 9 | Explainable ranking | IMPLEMENTED BUT UNTESTED | `reasons[]` + score sort |
| 10 | Users understand why matched | IMPLEMENTED BUT UNTESTED | `matchCopy.ts` + Find cards |
| 11 | Pickup walking distances shown | NOT IMPLEMENTED | RPC returns meters; UI does not show |
| 12 | Common meeting points recommended | PARTIALLY IMPLEMENTED | Table+RPC+UI; **0 prod rows** |
| 13 | User can choose meeting point | IMPLEMENTED BUT UNTESTED | Ride page chips + GPS |
| 14 | Meeting point stored on ride | IMPLEMENTED BUT UNTESTED | `rides.meeting_point_*` + `cleaner_city_set_meeting_point` |
| 15 | Both parties see same point | IMPLEMENTED BUT UNTESTED | Shared ride row |
| 16 | Home/office coords protected pre-confirm | BROKEN | `commute_publications_select` full-row for society on published |
| 17 | Missing Google Maps responses | IMPLEMENTED BUT UNTESTED | `routing.ts` haversine fallback |
| 18 | Prevent geographically impossible matches | PARTIALLY IMPLEMENTED | Hard filters when coords exist; skipped if null |
| 19 | Match cards not misleading numeric scores | IMPLEMENTED BUT UNTESTED | Score not rendered; reasons shown |
| 20 | UI accurately describes matching | PARTIALLY IMPLEMENTED | Some honest copy; hub "Match by route overlap" overstates |

---

## FEATURE 3: Reliability Net

### Verdict: PARTIALLY IMPLEMENTED

Real waitlist table + join/leave + FIFO notify on first publish. Timeouts cron active. Manual + auto no_show. Not a reliability net: no time-limited seat hold, waitlist ignore blocks/route fit, seat frees do not re-trigger waitlist, hub has no waitlist status, publication cancel does not cascade to guests, no dispute path, no cross-publication double-book guard.

### Requirement-by-requirement

| # | Requirement | Status | Evidence |
|---|-------------|--------|----------|
| 1 | Real waitlist | IMPLEMENTED BUT UNTESTED | `commute_waitlist` + join/leave RPCs + Find UI |
| 2 | Join when no matches | IMPLEMENTED BUT UNTESTED | Find empty state |
| 3 | Join when seats booked | IMPLEMENTED BUT UNTESTED | Empty results path (indistinguishable UX) |
| 4 | Deterministic fair ordering | IMPLEMENTED BUT UNTESTED | `ORDER BY created_at` |
| 5 | Seat free triggers waitlist | PARTIALLY IMPLEMENTED | Only on draft→published confirm |
| 6 | Blocked users excluded | NOT IMPLEMENTED | Waitlist notify has no block check |
| 7 | Route/schedule compatibility | PARTIALLY IMPLEMENTED | Date+direction only |
| 8 | Notify when seat available | IMPLEMENTED BUT UNTESTED | When #5 path fires |
| 9 | Time-limited replacement offer | NOT IMPLEMENTED | Informational push only |
| 10 | Unanswered request expires | IMPLEMENTED BUT UNTESTED | `process_timeouts` 3h; cron active |
| 11 | Seat released atomically | IMPLEMENTED BUT UNTESTED | FOR UPDATE + seats++ in one txn |
| 12 | Automatic pickup timeout | IMPLEMENTED BUT UNTESTED | pickup_pending → no_show |
| 13 | Report genuine no-show | IMPLEMENTED BUT UNTESTED | `cleaner_city_mark_no_show` + Ride UI |
| 14 | Transition to `no_show` | IMPLEMENTED BUT UNTESTED | Status check allows it |
| 15 | Reputation update | PARTIALLY IMPLEMENTED | Incident count; not on match cards |
| 16 | Appeal/dispute | NOT IMPLEMENTED | `disputed` enum unused |
| 17 | Host cancel → replacements | PARTIALLY IMPLEMENTED | Client suggest on cancel ride; publication cancel silent |
| 18 | Cancellation reasons recorded | PARTIALLY IMPLEMENTED | Ride cancel yes; publication cancel no reason |
| 19 | Prevent duplicate replacement bookings | NOT IMPLEMENTED | No per-day guest uniqueness |
| 20 | Hub waitlist/recovery status | NOT IMPLEMENTED | Hub has no waitlist UI |

---

## FEATURE 4: Trusted Commute Circles

### Verdict: NOT COMPLETE (scaffold)

This is **not** society membership. Circles tables/RPCs/pages exist. Missing leave, remove, accept/reject, circle-only mode, tomorrow board, circle notify, privacy toggle. Invite codes never expire and leak to all society members via RLS. Prod has 0 circles and no leave RPC.

| # | Requirement | Status |
|---|-------------|--------|
| 1 | Create Circle | IMPLEMENTED BUT UNTESTED |
| 2 | Invite residents | PARTIALLY IMPLEMENTED (code share only) |
| 3 | Accept/reject invitations | NOT IMPLEMENTED |
| 4 | Membership permissions enforced | NOT IMPLEMENTED |
| 5 | Leave Circle | NOT IMPLEMENTED (confirmed absent in prod) |
| 6 | Admins remove members | NOT IMPLEMENTED |
| 7 | Block other members | PARTIALLY IMPLEMENTED (ride-level block only) |
| 8 | Circle-first matching | PARTIALLY IMPLEMENTED (+30 soft boost) |
| 9 | Circle-only matching | NOT IMPLEMENTED |
| 10 | Discover outside Circles when permitted | IMPLEMENTED BUT UNTESTED (always on) |
| 11 | Circle badges on match cards | IMPLEMENTED BUT UNTESTED |
| 12 | Who is travelling tomorrow | NOT IMPLEMENTED |
| 13 | Notify members about compatible commutes | NOT IMPLEMENTED |
| 14 | Invitation links secure and expiring | BROKEN |
| 15 | Cross-society permissions | NOT IMPLEMENTED |
| 16 | Prevent unauthorised private membership access | BROKEN (`commute_circles_read` leaks invite_code) |
| 17 | Privacy setting for Circle visibility | NOT IMPLEMENTED |

---

## FEATURE 5: Pocket-Safe Ride

### Verdict: NOT FULLY IMPLEMENTED

Contacts can be saved as name/phone. SOS fan-out requires `notify_user_id`, which the Safety UI never sets - so emergency contacts are display-only. Share link + expiry + map view exist. Quick phrases exist. Tracking is foreground 10s poll only. No masked call. No SMS/112. Admin can resolve incidents by polling dashboard (no push escalation).

| # | Requirement | Status |
|---|-------------|--------|
| 1 | Save emergency contacts | IMPLEMENTED BUT UNTESTED |
| 2 | Contacts verified/protected | NOT IMPLEMENTED |
| 3 | SOS notifies emergency contacts | BROKEN (UI never sets `notify_user_id`) |
| 4 | SOS notifies admin/ops | PARTIALLY IMPLEMENTED (DB row; no admin push) |
| 5 | Notification escalation reliable | NOT IMPLEMENTED |
| 6 | SOS screen explains recipients | IMPLEMENTED BUT UNTESTED |
| 7 | Distinguishes SOS vs 112 | IMPLEMENTED BUT UNTESTED |
| 8 | Share active trip | IMPLEMENTED BUT UNTESTED |
| 9 | Shared link expires | IMPLEMENTED BUT UNTESTED (6h) |
| 10 | Contact views live trip | IMPLEMENTED BUT UNTESTED |
| 11 | Background location iOS | NOT IMPLEMENTED |
| 12 | Background location Android | NOT IMPLEMENTED |
| 13 | Tracking when screen locked | NOT IMPLEMENTED |
| 14 | Tracking when switching to Maps | NOT IMPLEMENTED |
| 15 | Tracking stops on complete/cancel | IMPLEMENTED BUT UNTESTED |
| 16 | Location permissions with consent | IMPLEMENTED BUT UNTESTED |
| 17 | Fallback if background denied | IMPLEMENTED BUT UNTESTED (honest copy) |
| 18 | Poor connectivity handling | NOT IMPLEMENTED |
| 19 | Quick pickup messages | IMPLEMENTED BUT UNTESTED |
| 20 | Masked calling | NOT IMPLEMENTED |
| 21 | Safety incidents recorded | IMPLEMENTED BUT UNTESTED |
| 22 | Admin incident workflow | IMPLEMENTED BUT UNTESTED |

---

## Requirement scorecard (all five)

| Status | Count (of 97) |
|--------|---------------|
| VERIFIED COMPLETE | 1 |
| IMPLEMENTED BUT UNTESTED | 48 |
| PARTIALLY IMPLEMENTED | 22 |
| NOT IMPLEMENTED | 18 |
| BROKEN | 8 |
| BLOCKED - ENVIRONMENT | 0 (device/e2e scenarios listed separately as blocked) |
| UNVERIFIED | 0 |

**Genuinely complete (VERIFIED COMPLETE only):** ~1% of requirements.  
**Code present and not known-broken (VERIFIED + IMPLEMENTED BUT UNTESTED):** ~51%.  
**Broken or missing:** ~27%.  
**Partial:** ~23%.

See matrix file for full per-requirement rows.

---

## Related reports

1. `CLEANER_CITY_FEATURE_REQUIREMENT_MATRIX.md`
2. `CLEANER_CITY_INTEGRATION_AUDIT.md`
3. `CLEANER_CITY_SECURITY_AND_PRIVACY_AUDIT.md`
4. `CLEANER_CITY_REGRESSION_TEST_REPORT.md`
5. `CLEANER_CITY_HIDDEN_GAPS_AND_DEFECTS.md`
6. `CLEANER_CITY_FINAL_PRODUCT_READINESS.md`
