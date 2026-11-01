# Cleaner City - Roadmap Recommendations

Challenges Units 1-12 as implemented and proposes a revised sequence for a Greenfield pilot that can become city-capable.

No architecture rewrite in this document - recommendations only.

---

## 1. What the 12 units got right

| Units | Verdict |
|-------|---------|
| 1 Foundation (flag, schema, neighbours, match_scope, shell) | Correct first. Society tenancy + C-ready scope is the right platform bet. |
| 2 Work email OTP + domains | Correct early trust gate. Keep badge honesty. |
| 3 Schedule templates/overrides/pause | Correct model; sequencing OK. **Incomplete product outcome** (no inventory link). |
| 4 Vehicles car/bike | Correct. Bike seat cap correct. |
| 5 Maps/pins/route cache | Correct dependency before matching. |
| 6 Matching RPC | Correct place in sequence. **Under-delivered** vs marketing (soft overlap, UI null pickup). |
| 7 Booking + seat holds | Correct; concurrency solid. |
| 8 OTP lifecycle | Correct; server-owned states are non-negotiable. |

Units 1-8 are the right **foundation spine**.

---

## 2. What is missing inside those units

| Unit | Missing important functionality |
|------|----------------------------------|
| 3 | Autopilot / scheduled publication generation; evening confirm |
| 5/6 | Guest pickup required in Find; hard block bad geometry; explainable match cards; optional society meetup POIs |
| 6 | No-match waitlist exit criteria |
| 7 | Request TTL; multi-seat family booking (can wait); meeting point on accept |
| 8 | `no_show` / `disputed` transitions; pickup timeout job |
| 9 | Background track; emergency contacts; honest SOS fan-out |
| 10 | Trust chrome on Find; unblock UI; mid-ride report entry |
| 11 | Pre-ride fuel estimate (settlement correctly postponed) |
| 12 | Vehicle doc review if docs are collected; ride ops browser; waitlist metrics |

---

## 3. Units that should be expanded

- **Unit 3 -> "Schedule + Autopilot"** (Must-Build #1)
- **Unit 6 -> "Matching + Waitlist + Explainability"**
- **Unit 8 -> "Lifecycle + Reliability timeouts"**
- **Unit 9 -> "Safety that works in a pocket"**
- **Unit 11 -> split:** notifications/reminders now; Razorpay settlement later behind legal

---

## 4. Overlooked dependencies

1. **Inventory depends on schedule** - built schedule without publish bridge.  
2. **Matching quality depends on Find UI** - RPC alone is insufficient.  
3. **Safety marketing depends on OS background location** - web interval is not enough.  
4. **Acceptance depends on host attention** - pushes without TTL leave seats zombie-held until cancel paths.  
5. **Pilot ops depends on domain list + neighbour edges seeded** - product fails if admin data incomplete (ops, not code).  
6. **Privacy Policy / store copy** must match background location before Phase B ships.

---

## 5. What should have come earlier

Bring forward (before more admin polish):

1. Find pickup + publish pin guards (bugfixes)  
2. Daily Autopilot  
3. Waitlist + request/pickup timeouts + real no_show  
4. Hub "Today/Tomorrow" card  
5. Emergency contacts on SOS  

These beat additional analytics widgets for adoption.

---

## 6. What to postpone

| Postpone | Why |
|----------|-----|
| Razorpay / wallet fuel settlement | Legal taxi-risk gate; estimate + UPI acknowledgment enough for pilot |
| Full free-form chat | Abuse surface; use quick pings first |
| City-wide default match_scope | Density and support not ready; keep neighbours |
| Hard vehicle KYC workflow | Optional until passenger trust research demands it |
| Multi-office multi-stop optimiser | Complexity trap |
| Gamification / streaks cosmetics | After reliability metrics move |
| Rated ride status in CHECK | Ratings table is enough; do not churn schema for vanity states |

---

## 7. Architecture risks beyond one society

| Risk | At what scale | Mitigation |
|------|---------------|------------|
| Haversine loop over all publications in scope | ~1k-10k active pubs/day | Spatial indexes, time partition, prefilter by corridor geohash |
| Soft overlap != road reality | Any expansion corridor | Cache simplified polylines; real overlap or Map Matching |
| notification_queue generic path | Already multi-product | Add cleaner_city deep-link QA; do not special-case prematurely |
| RLS society_id ownership + city scope expansion | City mode | Keep server-side `cleaner_city_allowed_society_ids`; never client-supplied society lists |
| Single Google Maps key / quota | Growth | Cache Directions aggressively (already partial); budget alerts |
| Admin incident triage manual | > few SOS/week | On-call routing, SLA, phone escalation |

**Scale capability assessment**

| Commuters | Capable today? | Notes |
|-----------|----------------|-------|
| 100 (one society pilot) | Yes, after P0 fixes | Density still the product risk |
| 1,000 (neighbours cluster) | Mostly | Need autopilot + waitlist + indexes watch |
| 10,000 | Not without matcher/ops upgrades | Partition publications; meetup POIs; stronger trust |
| 100,000 | No | Needs city topology, support org, legal settlement stance, native reliability |

Foundation choices (feature flag, match_scope enum, SECURITY DEFINER RPCs, PostGIS) **can** support growth if matching and ops evolve. They are not the bottleneck; **habit and density** are.

---

## 8. Revised roadmap (recommended)

### Phase 0 - Stop-ship defects (3-7 days)
1. Find: send guest pickup from template/pin; block search if missing  
2. Offer: refuse publish without real pins; remove silent Bangalore fallback  
3. Match cards: human reasons; surface host rating if present  
4. Hub: deep link to active/confirmed rides  

### Phase 1 - Pilot habit loop (2-3 weeks) = Must-Builds 1+3 (+ matching lite)
1. Autopilot drafts + evening confirm pushes  
2. Waitlist + request TTL + pickup timeout + `no_show`  
3. Cancel recovery suggestions  
4. Commute reminders (tomorrow / leave soon)  
5. Pre-ride fuel estimate (no payout)  

### Phase 2 - Trust ceiling (2-3 weeks) = Must-Builds 2 remaining + 5 Phase A
1. Society meetup points + meeting point on accept  
2. Emergency contacts + SOS fan-out + honest copy  
3. Quick pickup pings / masked call  
4. Tighten overlap rules or retune marketing copy  

### Phase 3 - Density graph (pilot parallel) = Must-Build 4
1. Trusted Circles + invites  
2. Circle-first matching preference  
3. Office domain suggested circles  

### Phase 4 - Native safety + city prep
1. Background location for active rides only  
2. Matcher performance pass  
3. Vehicle doc upload/admin only if metrics show trust gap  
4. Legal review track for settlement (separate workstream)

### Keep as-is from Units 9-12
- Share token page  
- Admin domain + match_scope + incident list + stats (extend, do not rebuild)  
- Block + rating ledger  

---

## 9. Sequencing vs original Units 9-12 emphasis

Original late units prioritised tracking/SOS/ratings/admin while **daily inventory and no-match recovery** remained open. That is a classic platform-team sequencing win and a product-adoption sequencing loss.

Revised principle: **No empty Find screens in the pilot corridor before more safety chrome.** Safety Phase A (contacts) still ships early; background GPS can follow once rides actually happen.

---

## 10. Decision asked of product owner

Approve Phase 0 + Phase 1 as the next build charter instead of "Unit 13+" feature sprawl. Circles and background tracking follow once weekday publications and waitlists exist.
