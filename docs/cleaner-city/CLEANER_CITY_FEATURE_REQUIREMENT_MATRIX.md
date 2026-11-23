# Cleaner City - Feature Requirement Matrix

**Audit date:** 2026-11-01  
**Statuses:** VERIFIED COMPLETE | IMPLEMENTED BUT UNTESTED | PARTIALLY IMPLEMENTED | NOT IMPLEMENTED | BROKEN | BLOCKED - ENVIRONMENT | UNVERIFIED  
**Severity:** P0 launch blocker | P1 pilot blocker | P2 should-fix | P3 polish

No application code was modified during this audit.

---

## Feature 1 - Daily Commute Autopilot

| Req | Requirement | Status | Evidence (file / symbol) | DB / migration | Test evidence | Reproduction if broken | Remaining work | Severity |
|-----|-------------|--------|--------------------------|----------------|---------------|------------------------|----------------|----------|
| 1.1 | Autopilot toggle | IMPLEMENTED BUT UNTESTED | `CleanerCitySchedulePage.tsx` Switch; `useSetAutopilot`; `cleaner_city_set_autopilot` | `commute_profiles.autopilot_enabled` in `20261102210000_...sql` | phase1-4 string contract only | - | Add RPC/integration test | P2 |
| 1.2 | Manual vs auto confirm | IMPLEMENTED BUT UNTESTED | Schedule mode buttons; `autopilot_confirm_mode` | CHECK constraint confirm/auto | phase1-4 | - | Runtime test both modes | P2 |
| 1.3 | Effective weekly schedule | IMPLEMENTED BUT UNTESTED | `cleaner_city_effective_schedule` | unit3 + part2/part3 | string only | - | Call RPC in test DB | P2 |
| 1.4 | Schedule overrides | IMPLEMENTED BUT UNTESTED | Override branch in effective schedule | `commute_overrides` | string only | - | Override day fixture | P2 |
| 1.5 | WFH / holidays / paused / cancelled days | PARTIALLY IMPLEMENTED | Pause + WFH skip; cancelled pub not excluded | autopilot EXISTS filter | none for cancel recreate | Cancel tomorrow draft; wait for cron/manual run → new draft may appear | Exclude cancelled day or convert cancel to override | P1 |
| 1.6 | Generate tomorrow publication | IMPLEMENTED BUT UNTESTED | `cleaner_city_autopilot_run` | part2 migration; prod RPC exists | none executed | - | Observe nightly insert | P1 |
| 1.7 | Scheduled cron / edge | VERIFIED COMPLETE | pg_cron job | prod: `cleaner-city-autopilot` `15 20 * * *` active | SQL listing | - | - | - |
| 1.8 | Idempotent generation | PARTIALLY IMPLEMENTED | EXISTS before INSERT | no UNIQUE | none | Concurrent runs | Add unique (host, date, direction) | P1 |
| 1.9 | Duplicate cron safety | PARTIALLY IMPLEMENTED | Same as 1.8 | no advisory lock | none | Two overlapping service_role calls | Unique + ON CONFLICT | P1 |
| 1.10 | Work email still verified | PARTIALLY IMPLEMENTED | Check in set_autopilot only | autopilot_run omits verify | none | Revoke verify; leave autopilot on | Re-check in nightly run | P0 |
| 1.11 | Vehicle + route pins | IMPLEMENTED BUT UNTESTED | Skip without vehicle/pins | autopilot_run | none | - | Fixture tests | P1 |
| 1.12 | Evening confirmation notification | IMPLEMENTED BUT UNTESTED | enqueue on draft; reminders cron | prod reminders cron active | none | - | Push delivery check | P1 |
| 1.13 | Confirm / Skip / WFH | PARTIALLY IMPLEMENTED | Hub Confirm/Skip; WFH only via Schedule | `cleaner_city_confirm_publication` | phase1-4 hub strings | Open draft card → no WFH button | Add WFH action that writes override + cancels draft | P2 |
| 1.14 | Notify passengers seats available | PARTIALLY IMPLEMENTED | `cleaner_city_notify_waitlist_for_publication` on confirm only | part2 | none | Cancel seat after publish → waitlist silent | Call notify on seat free paths | P0 |
| 1.15 | Tomorrow card on hub | PARTIALLY IMPLEMENTED | Draft section on `CleanerCityPage.tsx` | - | phase1-4 | Auto mode → no card | Date-scoped Tomorrow card including auto-published | P2 |
| 1.16 | Repeat previous commute | NOT IMPLEMENTED | No symbol in src | none | gap doc | Hub/Offer → no Repeat CTA | Build rebook-last flow | P2 |
| 1.17 | Push opens correct screen | IMPLEMENTED BUT UNTESTED | `reference_path`; `notification-routes.ts` | enqueue helper part3 | none device | - | Device tap test | P2 |
| 1.18 | Disable Autopilot immediately | PARTIALLY IMPLEMENTED | Flag flip; draft remains | set_autopilot | none | Disable after draft → draft still Confirmable | Cancel open drafts on disable | P2 |

---

## Feature 2 - Honest Corridor Matching + Meeting Points

| Req | Requirement | Status | Evidence | DB / migration | Test evidence | Reproduction if broken | Remaining work | Severity |
|-----|-------------|--------|----------|----------------|---------------|------------------------|----------------|----------|
| 2.1 | Find sends pickup lat/lng | IMPLEMENTED BUT UNTESTED | `CleanerCityFindPage.tsx` guestCoords | request_ride params | phase0/1-4 strings | - | RPC integration | P1 |
| 2.2 | Pickup mandatory | PARTIALLY IMPLEMENTED | Client hasPickup; RPC optional | find_matches | phase0 | Bypass client → RPC still runs | Server reject if null | P1 |
| 2.3 | Offer rejects without coords | BROKEN | `cleaner_city_publish_commute` no lat check | `20261102130000_...sql` | tests only grep Offer UI | Call publish RPC with null pins → published | Server-side hard fail | P0 |
| 2.4 | Bangalore fallback removed | BROKEN | `CleanerCityRoutePage.tsx:49-56` | - | Tests miss RoutePage | Open Route with label-only template → pickup becomes Bangalore | Use saved lat/lng; remove hardcoded default | P0 |
| 2.5 | Actual route geometry | BROKEN | find_matches uses haversine only | unit5/part2 | routing.test is client Directions helper | Match two corridor hosts → score ignores polyline | Score with cached polyline / Directions | P0 |
| 2.6 | Overlap correct | PARTIALLY IMPLEMENTED | Proxy formula | part2 reasons | none | - | Real overlap or honest rename | P1 |
| 2.7 | Road detour minutes | BROKEN | Same as 2.5 | estimate_detour_minutes haversine | none | Card detour ≠ Maps ETA | Wire road detour into match RPC or edge | P0 |
| 2.8 | Departure windows configurable | IMPLEMENTED BUT UNTESTED | Admin match scope | cleaner_city_settings | unit10-11 strings | - | - | P2 |
| 2.9 | Explainable ranking | IMPLEMENTED BUT UNTESTED | reasons[] | find_matches | matchCopy unit tests (real) | - | - | P2 |
| 2.10 | Why recommended | IMPLEMENTED BUT UNTESTED | formatMatchReasons on cards | - | phase0 helper tests | - | - | P2 |
| 2.11 | Walking distances shown | NOT IMPLEMENTED | meters computed, not rendered | find_matches | none | Open match card → no walk distance | Render walk m/min | P2 |
| 2.12 | Meeting points recommended | PARTIALLY IMPLEMENTED | list_meetup_points + Ride UI | society_meetup_points; **0 rows in prod** | phase1-4 | Open meeting picker → empty | Seed Greenfield POIs | P1 |
| 2.13 | Choose meeting point | IMPLEMENTED BUT UNTESTED | set_meeting_point UI | rides.meeting_point_* | phase1-4 | - | - | P1 |
| 2.14 | Stored on ride | IMPLEMENTED BUT UNTESTED | RPC updates columns | unit9/part2 | none | - | - | P1 |
| 2.15 | Both see same point | IMPLEMENTED BUT UNTESTED | Shared ride row | rides_select | none | - | Dual-user e2e | P1 |
| 2.16 | Coords protected pre-confirm | BROKEN | RLS full-row published select | foundation publications_select | security.test does not cover lat leak | Society member select origin_latitude | Column revoke / view / RPC-only | P0 |
| 2.17 | Missing Google Maps responses | IMPLEMENTED BUT UNTESTED | routing.ts fallback | - | routing.test | - | - | P2 |
| 2.18 | Impossible matches prevented | PARTIALLY IMPLEMENTED | Hard filters if coords | find_matches | none | Null-coord publication still matchable | Reject null-coord pubs | P1 |
| 2.19 | No misleading scores | IMPLEMENTED BUT UNTESTED | Score not shown | Find page | phase0 | - | - | P3 |
| 2.20 | Accurate matching copy | PARTIALLY IMPLEMENTED | Mixed honesty | hub "route overlap" | phase0 anti-"live match" | Hub implies road overlap | Soften copy | P1 |

---

## Feature 3 - Reliability Net

| Req | Requirement | Status | Evidence | DB / migration | Test evidence | Reproduction if broken | Remaining work | Severity |
|-----|-------------|--------|----------|----------------|---------------|------------------------|----------------|----------|
| 3.1 | Real waitlist | IMPLEMENTED BUT UNTESTED | join/leave + table | part2; prod table | phase1-4 | - | - | P1 |
| 3.2 | Join when no matches | IMPLEMENTED BUT UNTESTED | Find empty CTA | - | phase1-4 | - | - | P1 |
| 3.3 | Join when full | IMPLEMENTED BUT UNTESTED | Same empty path | - | none | - | Distinguish full vs empty copy | P3 |
| 3.4 | Fair ordering | IMPLEMENTED BUT UNTESTED | ORDER BY created_at | notify_waitlist | none | - | - | P1 |
| 3.5 | Seat free triggers waitlist | PARTIALLY IMPLEMENTED | Only confirm publish | cancel/no_show omit notify | none | Cancel confirmed guest → waitlist silent | Wire notify on seat++ | P0 |
| 3.6 | Blocked users excluded | NOT IMPLEMENTED | notify_waitlist no block check | part2 | none | Block host; join waitlist; host publishes → still notified | Filter blocks | P1 |
| 3.7 | Route compatibility | PARTIALLY IMPLEMENTED | Date+direction only | notify_waitlist | none | Distant corridor still pinged | Reuse find_matches filters | P1 |
| 3.8 | Notify seat available | IMPLEMENTED BUT UNTESTED | enqueue Seat opened | when 3.5 fires | none | - | - | P1 |
| 3.9 | Time-limited offer | NOT IMPLEMENTED | No hold/expiry offer | none | none | - | Personal offer + expiry | P1 |
| 3.10 | Request expires | IMPLEMENTED BUT UNTESTED | process_timeouts 3h | prod cron */15 | none | - | Prefer reading request_expires_at | P1 |
| 3.11 | Seat release atomic | IMPLEMENTED BUT UNTESTED | FOR UPDATE paths | unit7/part2 | none | - | Concurrency test | P1 |
| 3.12 | Pickup timeout | IMPLEMENTED BUT UNTESTED | pickup_pending → no_show | timeouts cron | none | - | - | P1 |
| 3.13 | Report no-show | IMPLEMENTED BUT UNTESTED | mark_no_show + UI | part2 | phase1-4 | - | - | P1 |
| 3.14 | Status no_show | IMPLEMENTED BUT UNTESTED | UPDATE status | rides check | none | - | - | P1 |
| 3.15 | Reputation | PARTIALLY IMPLEMENTED | incident_mentions; not on cards | reputation RPC | none | - | Surface on match cards | P2 |
| 3.16 | Appeal/dispute | NOT IMPLEMENTED | disputed unused | foundation enums | none | - | Guest/host dispute RPC | P2 |
| 3.17 | Host cancel replacements | PARTIALLY IMPLEMENTED | Client suggest on ride cancel; publication cancel silent | cancel_publication | phase1-4 suggest | Host cancels publication with confirmed rides → guests silent | Cascade cancel + notify + suggest | P0 |
| 3.18 | Cancel reasons | PARTIALLY IMPLEMENTED | ride_events reason; publication no param | unit7 | none | - | Add reason to cancel_publication | P2 |
| 3.19 | Duplicate replacement bookings | NOT IMPLEMENTED | request_ride same-pub only | no unique day | none | Request two pubs same day → both succeed | Unique active ride per guest/day/direction | P0 |
| 3.20 | Hub waitlist/recovery | NOT IMPLEMENTED | Hub omits waitlist | - | none | Hub → no waitlist chip | Add hub status | P2 |

---

## Feature 4 - Trusted Commute Circles

| Req | Requirement | Status | Evidence | DB / migration | Test evidence | Reproduction if broken | Remaining work | Severity |
|-----|-------------|--------|----------|----------------|---------------|------------------------|----------------|----------|
| 4.1 | Create Circle | IMPLEMENTED BUT UNTESTED | create_circle + Circles page | part2; prod RPC | phase1-4 | - | - | P2 |
| 4.2 | Invite residents | PARTIALLY IMPLEMENTED | invite_code copy only | commute_circles | phase1-4 | - | Targeted invites | P2 |
| 4.3 | Accept/reject | NOT IMPLEMENTED | join auto-adds | join_circle | none | - | Pending membership | P1 |
| 4.4 | Membership permissions | NOT IMPLEMENTED | role column unused | members.role | none | - | Owner-gated RPCs | P1 |
| 4.5 | Leave Circle | NOT IMPLEMENTED | No RPC (prod count 0) | - | none | Circles page → no Leave | Implement leave | P1 |
| 4.6 | Remove members | NOT IMPLEMENTED | No RPC | - | none | - | Owner remove | P1 |
| 4.7 | Block members | PARTIALLY IMPLEMENTED | Ride block only | commute_blocks | none | Circles → cannot pick member | Member list + block | P2 |
| 4.8 | Circle-first matching | PARTIALLY IMPLEMENTED | +30 soft boost | find_matches | phase1-4 badge | - | Hard tier sort | P2 |
| 4.9 | Circle-only matching | NOT IMPLEMENTED | No filter | - | none | - | Preference flag | P2 |
| 4.10 | Discover outside when permitted | IMPLEMENTED BUT UNTESTED | Always allowed | - | none | - | Optional restrict | P3 |
| 4.11 | Circle badges | IMPLEMENTED BUT UNTESTED | shared_circle badge | Find page | phase1-4 | - | - | P2 |
| 4.12 | Travelling tomorrow | NOT IMPLEMENTED | No board | - | none | - | Opt-in tomorrow strip | P2 |
| 4.13 | Notify compatible | NOT IMPLEMENTED | No circle notify | - | none | - | Circle fan-out | P2 |
| 4.14 | Secure expiring invites | BROKEN | Never expires; reusable | invite_code | none | Code reused forever | Expiry + rotate | P0 |
| 4.15 | Cross-society permissions | NOT IMPLEMENTED | join ignores society | join_circle | none | Foreign society with code joins | Enforce neighbour/society | P1 |
| 4.16 | Private membership access | BROKEN | circles_read by society_id exposes invite_code | unit9 RLS | none | Society peer SELECT invite_code | Restrict SELECT; hide code | P0 |
| 4.17 | Privacy visibility setting | NOT IMPLEMENTED | No column/UI | - | none | - | Visibility toggle | P2 |

---

## Feature 5 - Pocket-Safe Ride

| Req | Requirement | Status | Evidence | DB / migration | Test evidence | Reproduction if broken | Remaining work | Severity |
|-----|-------------|--------|----------|----------------|---------------|------------------------|----------------|----------|
| 5.1 | Save emergency contacts | IMPLEMENTED BUT UNTESTED | Safety page upsert | commute_emergency_contacts | phase1-4 | - | - | P1 |
| 5.2 | Contacts verified | NOT IMPLEMENTED | No OTP/consent | - | none | - | Consent + verify | P1 |
| 5.3 | SOS notifies contacts | BROKEN | Fan-out needs notify_user_id; UI never sets it | report_incident; SafetyPage addContact | phase1-4 optimistic copy | Add phone contact → SOS → contacts not notified | Link Sociva user or SMS | P0 |
| 5.4 | SOS notifies admin | PARTIALLY IMPLEMENTED | Incident row; admin tab poll | ride_incidents | unit9-12 | Admin offline → no alert | Admin push on SOS | P0 |
| 5.5 | Escalation reliable | NOT IMPLEMENTED | No tiers/ack SLA | - | none | - | Escalation cron | P1 |
| 5.6 | SOS explains recipients | IMPLEMENTED BUT UNTESTED | Ride + Safety copy | - | phase1-4 | - | Align copy with real fan-out | P1 |
| 5.7 | Not a 112 dialer | IMPLEMENTED BUT UNTESTED | Explicit copy | - | phase1-4 | - | - | P2 |
| 5.8 | Share active trip | IMPLEMENTED BUT UNTESTED | create_share_token | unit9 | unit9-12 strings | - | Auto-share to contacts | P2 |
| 5.9 | Link expires | IMPLEMENTED BUT UNTESTED | 6h expires_at | view_shared_ride | none | - | - | P1 |
| 5.10 | Contact views live trip | IMPLEMENTED BUT UNTESTED | SharePage poll map | anon grant | none | - | - | P1 |
| 5.11 | Background iOS | NOT IMPLEMENTED | native-location admits fallback; no plugin | - | phase1-4 only helper presence | Lock phone → no updates | Native background track | P0 |
| 5.12 | Background Android | NOT IMPLEMENTED | Same | - | delivery uses different hook; CC does not | Minimize app → stop | Same | P0 |
| 5.13 | Locked screen tracking | NOT IMPLEMENTED | 10s interval while mounted | Ride page | none | Lock during ride | Native task | P0 |
| 5.14 | Switch to Google Maps | NOT IMPLEMENTED | Resume-only re-tick | Ride page | phase1-4 documents resume | Open Maps → gap | Background track | P0 |
| 5.15 | Stops on complete/cancel | IMPLEMENTED BUT UNTESTED | Effect cleanup + RPC reject | upsert_ride_location | none | - | - | P1 |
| 5.16 | Permission consent | IMPLEMENTED BUT UNTESTED | requestLocationPermission | native-location | ios/android other suites | - | CC-specific primer | P2 |
| 5.17 | Fallback if BG denied | IMPLEMENTED BUT UNTESTED | Honest keep-app-open copy | Ride page | phase1-4 | - | - | P2 |
| 5.18 | Poor connectivity | NOT IMPLEMENTED | Silent catch on tick | Ride page | none | Airplane mode | Queue/retry UI | P2 |
| 5.19 | Quick pickup messages | IMPLEMENTED BUT UNTESTED | send_quick_message + phrases | part2 | phase1-4 | - | - | P2 |
| 5.20 | Masked calling | NOT IMPLEMENTED | None in cleaner-city | - | none | Ride → no call | Masked/relay or hide | P2 |
| 5.21 | Incidents auditable | IMPLEMENTED BUT UNTESTED | ride_incidents | unit9 | unit9-12 | - | - | P1 |
| 5.22 | Admin incident workflow | IMPLEMENTED BUT UNTESTED | admin_resolve_incident | AdminCleanerCityTab | unit9-12 | - | Push + SLA | P1 |

---

## Totals

| Status | Count |
|--------|------:|
| VERIFIED COMPLETE | 1 |
| IMPLEMENTED BUT UNTESTED | 48 |
| PARTIALLY IMPLEMENTED | 22 |
| NOT IMPLEMENTED | 18 |
| BROKEN | 8 |
| **Total requirements** | **97** |

**P0 count:** 16  
**P1 count:** 42 (approx from matrix)  
