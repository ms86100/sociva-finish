# Sociva - A Cleaner City
## Product Owner Review (Units 1-12 as shipped)

**Date:** 2026-11-01  
**Scope:** Independent product investigation of the implemented codebase. No code changes in this pass.  
**Evidence basis:** Pages under `src/pages/cleaner-city/`, hooks in `src/hooks/queries/useCleanerCity.ts`, migrations `20261102090000` through `20261102200000`, edge function `cleaner-city-work-email-otp`, Book entry `CleanerCityEntryCard`, admin `AdminCleanerCityTab`, and related vitest files.

---

## Executive stance

Cleaner City is a **credible society-scoped commute MVP shell** with real server-owned ride state, work-email OTP, seat holds, OTP start, ratings, cost-share ledger, blocks, share links, and admin domain/incident tools.

It is **not yet a daily habit product**. The marketing promise on the Book card ("Smart route matching", "Verified commuters") overstates what a resident experiences on day one. Matching quality is weakened by the Find UI never sending guest pickup coordinates. Publishing is manual and one-date-at-a-time despite a full weekly schedule system. Live tracking stops when the ride screen is left. SOS does not call anyone. Cost share never settles money. Vehicle "verification" is metadata with no admin approve path.

If the goal is a pilot that proves **repeat weekday usage** at Greenfield + neighbours, the current planned form will under-deliver unless five product capabilities below (and the top gaps in the companion gap doc) are treated as launch blockers or immediate post-soft-launch P0s.

Companion deliverables:

1. `CLEANER_CITY_TOP_15_PRODUCT_GAPS.md`
2. `CLEANER_CITY_FIVE_MUST_BUILD_FEATURES.md`
3. `CLEANER_CITY_IDEAL_RESIDENT_JOURNEY.md`
4. `CLEANER_CITY_ROADMAP_RECOMMENDATIONS.md`
5. `CLEANER_CITY_PILOT_SUCCESS_METRICS.md`

---

## 1. What the product actually is today

### Working product loop (confirmed in code)

| Stage | Evidence |
|-------|----------|
| Discover entry | `CleanerCityEntryCard` on Book tab when `cleaner_city` feature on (`CommerceModePage` + `src/components/cleaner-city/CleanerCityEntryCard.tsx`) |
| Feature gate | `CleanerCityGate` -> `FeatureGate feature="cleaner_city"` |
| Profile + work email OTP | `CleanerCitySetupPage` + edge `cleaner-city-work-email-otp` + approved domains |
| Weekly schedule + overrides + pause | Unit 3 RPCs + `CleanerCitySchedulePage` |
| Vehicle car/bike + seat caps | Unit 4 + `CleanerCityVehiclePage` (bike seats capped at 1) |
| Office/pickup pins + route preview | Unit 5 + `CleanerCityRoutePage` + `CleanerCityPinPicker` |
| Publish one date | `cleaner_city_publish_commute` + `CleanerCityOfferPage` |
| Find matches | `cleaner_city_find_matches` + `CleanerCityFindPage` |
| Request / accept / seat hold | Unit 7 RPCs with `FOR UPDATE` seat decrement |
| OTP pickup -> start -> complete | Unit 8 RPCs; host generates OTP; guest enters |
| Live map while on ride page | Unit 9 tables + 10s GPS poll on `CleanerCityRidePage` |
| SOS incident + share token | `cleaner_city_report_incident`, `cleaner_city_create_share_token`, public `/cleaner-city/share/:token` |
| Rating + reputation + block | Unit 10/12 RPCs; block from completed ride screen |
| Cost-share propose/accept/decline | Ledger only; UI states no Razorpay |
| Admin | Domains, match scope, open incidents, pilot stats |

### What residents are sold vs what they get

| Claim (UI / architecture) | Reality |
|---------------------------|---------|
| "Smart route matching" (`CleanerCityEntryCard`) | Detour hard-filter exists; route overlap is a **soft score penalty**, not a 65% hard gate (`unit6_matching.sql`). Find sends `guest_pickup_lat/lng: null` (`CleanerCityFindPage.tsx:81-82`), so corridor filter often never runs. |
| "Verified commuters" | Only **Work email verified** badge. Explicitly not employment verification (OTP email copy). Vehicle docs: `p_storage_path: null`, copy says admin verification comes later. |
| Road-network matching (`ARCHITECTURE.md`) | Falls back to haversine when geometry missing; Offer page can stamp Bangalore default coords (`12.9716, 77.5946`) when home/office pins absent. |
| Live tracking / safety | Foreground-only `setInterval` on ride page. No background location for Cleaner City. SOS = DB row + in-app notify to counterpart, not emergency dial. |
| Fuel cost sharing | Propose/accept ledger. Status `settled` exists in CHECK but no settlement RPC. |
| Daily commute | Schedule templates do **not** auto-create `commute_publications`. Every seat offer is a manual publish. |

---

## 2. Investigation by product lens

### A. Discovery and matching

**Can a resident find a compatible ride in seconds?**  
Only if someone already published for that date/direction and search is run manually. No proactive "we found a seat for tomorrow" push. Cold start is likely the dominant failure mode in a single-society pilot.

**80% same route?**  
Not computed as polyline overlap. Soft proxy from detour extra meters ratio. Architecture's "at least 65%" is not a hard reject.

**Intelligent pickup/drop?**  
Absent. Pins are manual. No shared meeting-point recommendation.

**Multi-passenger different destinations?**  
One request = one seat = one `rides` row. No multi-stop itinerary optimization. Second passenger books separately.

**Traffic / road direction / time variants?**  
Cached Directions at publish time; no live traffic re-score at search; departure window default +/-30 min.

**No match?**  
Toast + "No matches shown yet." Dead end. No waitlist, no alternate time suggestion, no "publish your own seat" CTA with prefilled data, no notify-when-available.

**Verdict:** Matching engine is a solid **v0 filter**, undermined by the Find UI gap and missing no-match recovery. Product opportunity, not just polish.

### B. Daily usability

Setup is multi-step: profile -> OTP -> schedule -> vehicle (hosts) -> office/pickup -> then offer/find. Reasonable for trust, heavy for a busy resident.

Publish tomorrow: possible but not "few seconds" if pins/vehicle missing; Offer uses fallback Bangalore coords if geometry incomplete - a **confirmed defect**, not a research assumption.

Schedule changes do not rewrite past confirmed rides (good). They also do not create tomorrow's publication (gap).

No commute reminder cron for Cleaner City types was found in `process-notification-queue` (no `cleaner_city` branch; events only enqueue on request/accept/complete/cancel/SOS).

Repeat previous commute: no one-tap rebook of last publication/ride.

**Verdict:** Backend schedule model is excellent; habit UX around it is incomplete.

### C. Trust and safety

| Capability | Status |
|------------|--------|
| Work email badge | Implemented |
| Vehicle document verification | Partial / effectively absent (metadata only) |
| Report suspicious behaviour | Partial (`ride_incidents` types include harassment etc.) |
| SOS | Partial (in-app + admin tab; no call cascade) |
| Trip share with contact | Implemented (time-boxed token) |
| Driver no-show | Schema has `no_show` / incident type; **no RPC sets ride status to `no_show`** |
| Dispute flow | `disputed` status unreachable |
| Block | Implemented post-ride; unblock RPC exists without UI |
| Mid-ride chat / call | Absent |

**Verdict:** Trust theater risk. Badge + OTP start are real; emergency and no-show ops are not resident-grade yet.

### D. Reliability

| Scenario | Assessment |
|----------|------------|
| Seat double-book | Mitigated: `FOR UPDATE` + seats_available check in `cleaner_city_request_ride` |
| Duplicate guest request | Mitigated: open request uniqueness check |
| Illegal state transitions | Mitigated: SECURITY DEFINER RPCs + `ride_events` |
| Network drop mid-ride | Weak: tracking is client poll; no offline queue; completion requires host RPC |
| Force-close app | Tracking stops; ride state remains server-side (good); passenger loses live map until reopen |
| Maps / push failure | Soft degrade for maps; push rides generic queue (should work, no CC-specific deep-link QA evidence in this review) |
| Stuck `pickup_pending` | No timeout/cron found to auto `no_show` or release seat |

**Verdict:** Transactional booking is strong. Operational reliability (timeouts, background, recovery) is weak.

### E. Commercial and adoption

**Why ride-share vs alone?** Fuel split + community trust + empty-seat social proof. Today fuel split is post-ride negotiation, not visible at match time as an estimate - weakens the passenger value prop at decision time.

**Why host?** Partial cost recovery. No reliability score, no "your usual 3 passengers this week" habit loop, no incentive credit. Host still does manual publish every day.

**Invite loop:** No referral, no office cohort, no "invite neighbour" share from hub.

**Adoption blockers even if tech works:** Density, manual publish friction, no-match dead ends, safety perception, legal caution on settlement (correctly gated).

### F. Mobile experience

- Location: `@capacitor/geolocation` via `native-location.ts`, foreground permission only for Cleaner City paths.
- Ride tracking: component-scoped 10s interval (`CleanerCityRidePage.tsx:70-92`).
- Background location: used elsewhere for deliveries (PrivacyPolicy mentions seller delivery); **not wired for Cleaner City**.
- Deep links: share URL is HTTPS web route; no Cleaner City-specific App Link evidence found in this pass.
- Accessibility / loading: basic loading and not-found; empty match state is thin.
- Interaction complexity: hub is a menu of setup tiles - functional, not a single daily "Today's commute" surface.

---

## 3. Confirmed gaps vs research assumptions

### Confirmed technical / product gaps (code evidence)

See ranked list in `CLEANER_CITY_TOP_15_PRODUCT_GAPS.md`.

### Product opportunities (need pilot / interviews)

- Whether residents prefer office cohorts vs neighbour societies for first rides.
- Willingness to share fuel via UPI outside app vs in-app ledger.
- Acceptable detour minutes for Greenfield -> Whitefield / ORR corridors (hypothesis: 10-12 min, not 15).
- Whether bike hosts feel seat=1 is worth the setup cost.
- Whether "Work email verified" alone is enough trust for women passengers after dark (safety research required; do not assume).

### Assumptions that must not be treated as facts

- That Greenfield + neighbours will produce enough same-day inventory without auto-publish or office seeding.
- That haversine fallback matching is "good enough" for launch marketing that says "smart route matching".
- That SOS-as-DB-flag meets resident safety expectations.

---

## 4. What makes the product exceptional (honest answers)

**What would make someone open Cleaner City every morning?**  
A single "Tomorrow is set" card: seat confirmed or waitlist active, pickup time, partner name, one tap to navigate. Not a hub of six setup links.

**What would make a driver publish regularly?**  
Auto-publish from schedule + one-tap cancel for WFH, plus visible fuel recovery and reliable passengers (low no-show).

**What would make passengers trust strangers?**  
Same society + work email is a start. Stronger: mutual office domain, prior commute count, trip share to family, working SOS, and visible cancellation policy.

**What would make users invite others?**  
When a match fails and the app says "Invite 2 colleagues on your floor - your corridor fills faster," with a real invite path.

**What would make someone choose this over alone?**  
Reliable seat by 8pm the night before + clear rupee save estimate + less parking/stress. Reliability beats idealism.

**Single biggest reason this could fail?**  
**Empty inventory / no matches** while marketing claims smart matching. Density + auto-publish + waitlist matter more than another screen.

**Strongest competitive advantage?**  
**Society-native trust graph** (residence + neighbours + work email) with route-corridor matching - if matching is made honest and daily autopilot exists. Pure consumer carpool apps lack society tenancy; Sociva already has it.

---

## 5. Challenge to the 12-unit roadmap (summary)

Units 1-8 sequencing is largely correct for a marketplace foundation. Units 9-12 add safety/admin before habit formation - **wrong emphasis for adoption**.

Overlooked earlier dependencies:

1. Guest pickup coords in Find (Unit 6/7 incomplete in UI).
2. Auto-publish / reminders (Unit 3 outputs never feed Unit 7 inventory).
3. No-match recovery (Unit 6 exit should have required it).
4. Background tracking if Unit 9 is marketed as "live tracking".
5. Settlement legal gate correctly postponed - keep postponed.

Scale readiness: society-scoped RLS + match_scope city flip is architecturally sound for 100-1,000. At 10,000+ city-wide, `cleaner_city_find_matches` will need indexing/partitioning and real geometry scoring; current haversine loops will not hold. Details in roadmap companion.

---

## 6. Launch recommendation (owner accountable)

**Would I launch in current planned form?**  
**No - not as a full resident launch.**

**I would soft-launch a closed pilot only after:**

1. Fix Find guest pickup (and stop Bangalore fallback silently polluting routes).
2. Ship daily autopilot: remind + one-tap publish/rebook from schedule.
3. Ship no-match waitlist + cancel recovery path.
4. Upgrade SOS to emergency-contact notify (even WhatsApp/SMS) and be honest in UI that it is not a 112 dialer unless legally cleared.
5. Compress first-time setup into a single guided flow with a "Today's commute" home.

Without those, the product risks teaching early users that Cleaner City is empty, inaccurate, or unsafe-looking - which is harder to reverse than delaying two weeks.

---

## 7. Final ask for approval

Approve the five must-build features and the revised near-term roadmap in the companion docs before any further unit-style implementation. Do not expand feature surface (chat, gamification, Razorpay settlement) until density and daily loop are fixed.
