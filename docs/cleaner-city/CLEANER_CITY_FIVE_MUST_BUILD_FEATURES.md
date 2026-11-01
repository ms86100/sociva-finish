# Cleaner City - Five Must-Build Features

Selected as an owner accountable for weekday habit formation at Shriram Greenfield + neighbours.  
These are **not** covered adequately by Units 1-12 as shipped. Ranked by user value x adoption x feasibility.

Related: gaps #1-#6, #8-#9, #13-#14 in `CLEANER_CITY_TOP_15_PRODUCT_GAPS.md`.

---

## Rank 1 - Daily Commute Autopilot

**Complexity:** Medium  
**MVP vs later:** **MVP / pre-pilot hardening**  
**Depends on:** Units 3 (schedule), 4 (vehicle), 5 (pins), 7 (publish/book), notifications

### 1. Resident problem
People will not manually republish seats every weekday. Schedules already exist but do not create inventory, so Find stays empty.

### 2. Why others fail
Generic carpool apps either require daily posting (friction) or assume professional drivers. Society commute needs "set once, runs on workdays, one-tap pause for WFH."

### 3. End-to-end behaviour
1. Host enables **Autopilot** on schedule (default off).
2. Each evening (e.g. 8pm local), system drafts tomorrow's `commute_publications` from effective schedule + vehicle + pins when `is_working`.
3. Push: "Tomorrow 9:05 to office - 2 seats ready. Confirm / Skip / WFH."
4. If confirmed or auto-confirm window passes, publication goes live.
5. Guest side: push "3 seats on your corridor tomorrow" or waitlist promotion.
6. One-tap **Repeat last commute** on hub for guests/hosts.

### 4. Example
Meera drives Mon-Thu. She enables Autopilot once. Tuesday she is WFH - taps Skip in the evening push. Wednesday seats appear without opening Offer.

### 5. Screens / interactions
- Hub: "Tomorrow" card (status: draft / live / skipped)
- Schedule: Autopilot toggle + confirm mode (manual confirm vs auto)
- Push deep link to tomorrow card
- Find: "Notify me" when empty (ties to Feature 3)

### 6. Data / backend
- `commute_profiles.autopilot_enabled`, `autopilot_confirm_mode`
- `commute_publication_drafts` or draft status on `commute_publications`
- Cron/edge: `cleaner-city-autopilot-tick`
- Idempotent publish per user/date/direction

### 7. Integrations
- `notification_queue` with dest `/cleaner-city` or tomorrow card
- Existing `cleaner_city_effective_schedule`, `cleaner_city_publish_commute`

### 8. Security / privacy
- Only publish when work email still verified and not paused
- Do not expose exact home coords in draft pushes (labels only)

### 9. Retention impact
Converts Unit 3 from "preferences form" into supply. Primary habit loop for hosts.

### 10. Success metrics
- % working-template days with a live publication
- Host publish streak (days/week)
- Evening confirm CTR
- Fill rate of autopilot publications

### 11. Why not "just notifications"
Reminders without creating inventory still leave Find empty. Autopilot creates the marketplace.

---

## Rank 2 - Honest Corridor Matching + Smart Meeting Points

**Complexity:** Medium-High  
**MVP vs later:** **MVP (fix + meeting points lite); full polyline later**  
**Depends on:** Units 5-6-7; Fix Find pickup null and Offer fallback first

### 1. Resident problem
"Smart route matching" currently often runs without guest pickup and with soft overlap. Residents need "on my way" truth and a gate that both can find.

### 2. Why others fail
Same-office-only matching is too narrow; pin-to-pin doorstep pickup is too slow in gated societies. Need corridor + suggested common pickup.

### 3. End-to-end behaviour
1. Find requires guest pickup pin (from schedule template or inline pin picker) - **block search if missing**.
2. Hard-fail publish without real origin/destination pins (remove silent Bangalore fallback).
3. Matcher uses guest pickup + host route; surface explain reasons on cards ("+6 min detour", "pickup ~400m").
4. On accept, suggest 1-3 **meeting points** (society gate, clubhouse, main road junction) ranked by walking + detour.
5. Both parties see the chosen meeting point on ride screen before OTP.

### 4. Example
Rahul lives Tower H; host lives Tower B. System suggests Clubhouse porte-cochere as mutual pickup; both save 4 minutes of hunting.

### 5. Screens
- Find: mandatory pickup chip + map mini-pin
- Match card: detour + walk-to-pickup
- Accept sheet: pick meeting point
- Ride: meeting point map + copy address

### 6. Data / backend
- Persist `guest_pickup_*` on ride request
- `ride_meeting_points` or columns on `rides`
- Optional Places library of society POIs (`society_meetup_points` admin-seeded for Greenfield)
- Tighten overlap: either hard min % or rename marketing copy until real

### 7. Integrations
- Google Directions / Distance Matrix for walk+drive tradeoff
- Existing detour helper RPCs

### 8. Security / privacy
- Approximate corridor in discovery; exact meeting point only after confirm
- Do not leak office lat/lng of other users pre-confirm

### 9. Retention
Fewer bad matches -> fewer cancelled rides -> hosts keep publishing.

### 10. Metrics
- Median detour minutes of completed rides
- % searches with non-null guest pickup
- Meeting-point acceptance rate
- Cancel reason "wrong pickup / could not find"

### 11. Feasibility note
Shipping **required pins + no silent fallback + explainable cards** is Medium and should precede fancy intersection math.

---

## Rank 3 - Reliability Net (No-show, Timeouts, Waitlist, Cancel Recovery)

**Complexity:** Medium  
**MVP vs later:** **MVP**  
**Depends on:** Units 7-8-10; notifications; Feature 1 inventory helps waitlist fill

### 1. Resident problem
Morning commute is brittle. Cancel and ghosting with no backup destroy trust faster than any UI polish can repair.

### 2. Why others fail
Consumer ride-hailing solves this with paid supply. Pure carpool usually shrugs. Society product must offer a **reliability net**, not a taxi SLA.

### 3. End-to-end behaviour
1. Guest can join **date+direction waitlist** when Find is empty or full.
2. When a seat frees or autopilot publishes, waitlist notified in order (respect blocks).
3. Host request timeout: unanswered `requested` auto-declines after N minutes with seat release + guest notify.
4. Pickup timeout: `pickup_pending` past depart+grace -> either party can mark **no_show**; system records status, reputation impact, optional incident.
5. On host cancel within T hours of depart: auto-offer waitlist alts + "broadcast need" to corridor autopilot hosts.

### 4. Example
Sneha's host cancels at 7:15. Within 2 minutes she gets "Ananya has 1 seat, +5 min detour - Request?" from waitlist matching.

### 5. Screens
- Find empty state: Join waitlist
- Ride: Mark no-show (with confirm)
- Push: seat opened / request expiring
- Hub: waitlist status chip

### 6. Data / backend
- `commute_waitlist` table + RPCs
- Cron for request and pickup timeouts
- Wire `rides.status = no_show` for real
- Reputation adjustments on no-show (careful, appeal path)

### 7. Integrations
- `notification_queue`
- Matching RPC reuse for replacement suggestions

### 8. Security / privacy
- Rate-limit no-show marking; require active participant
- Audit via `ride_events`

### 9. Retention
Turns failures into recoveries. This is how you earn "I can depend on it."

### 10. Metrics
- No-show rate
- Median time request -> accept
- % cancels that get a replacement offer within 10 minutes
- Waitlist conversion

---

## Rank 4 - Trusted Commute Circles

**Complexity:** Medium  
**MVP vs later:** **Pilot week 2-4** (after Autopilot + Matching honesty)  
**Depends on:** Units 2, 6, 10; society graph

### 1. Resident problem
Cold start among "all neighbours" is scary and sparse. People already trust floor colleagues, carpool WhatsApp groups, and tower friends.

### 2. Why others fail
Open marketplaces force stranger risk. Closed WhatsApp groups do not match routes or hold seats. Circles bridge both.

### 3. End-to-end behaviour
1. Create / join a Circle: "Tower H ORR", "ACME Whitefield", "School run".
2. Membership via invite link or same verified work domain auto-suggest.
3. Matching preference: **Circles first**, then society/neighbours.
4. Optional "only ride with Circles + prior 2 completed rides."
5. Circle board: who is going tomorrow (privacy: opt-in visibility).

### 4. Example
Priya invites three teammates. Their autopilot seats prefer each other; detour stays tiny; first week feels like a known group, not a stranger app.

### 5. Screens
- Circles list / create / invite
- Match cards: "In your Circle" badge
- Privacy: visibility toggles
- Hub: Circle tomorrow strip

### 6. Data / backend
- `commute_circles`, `commute_circle_members`
- Match RPC preference weight / hard filter flag
- Invite tokens

### 7. Integrations
- Work domain verification for office circles
- Share sheet for invites

### 8. Security / privacy
- Owner/moderation; block still applies inside circles
- No forced location broadcast to circle without opt-in

### 9. Retention
Social graph creates invite loops and denser inventory inside thin societies.

### 10. Metrics
- % rides where both parties share a circle
- Invite accept rate
- 7-day retention of circle members vs non-members

### 11. Legal / complexity caution
Keep circles social preference, not a paid subscription. Avoid becoming a transport aggregator.

---

## Rank 5 - Pocket-Safe Active Ride

**Complexity:** High (native) / Medium for contacts-first slice  
**MVP vs later:** **Contacts + coordination lite in MVP; full background track ASAP for iOS/Android store honesty**  
**Depends on:** Unit 9; Capacitor permissions; Privacy Policy updates

### 1. Resident problem
Safety and coordination fail when the app is backgrounded. SOS that only notifies the counterpart is not enough. Pickup needs a lightweight "I'm here / 5 min late" channel.

### 2. Why existing Unit 9 is insufficient
Foreground interval tracking + DB SOS + share link is a prototype, not a safety system residents can trust.

### 3. End-to-end behaviour (phased)
**Phase A (ship first):**
1. Emergency contacts (1-3) - on SOS, notify contacts with live share link + ride summary.
2. Ride screen: masked call or predefined quick messages (Here / 5 late / Wrong gate) without full chat product.
3. Honest copy: what SOS does and does not do.

**Phase B:**
4. Background location only while ride `pickup_pending`/`started`, with OS disclosure matching Privacy Policy pattern used for deliveries.
5. Admin urgent push on SOS within SLA.

### 4. Example
Ananya's father receives "Ananya shared a Cleaner City ride - live map" when she taps Share; if she taps SOS, he and admin get alerted, not only the host.

### 5. Screens
- Setup: emergency contacts
- Ride: quick pings, SOS confirm sheet explaining recipients
- OS permission primer for background (Phase B)

### 6. Data / backend
- `commute_emergency_contacts`
- `ride_quick_messages` (small, capped)
- Extend incident notify fan-out

### 7. Integrations
- SMS/WhatsApp/push to contacts (choose one reliable path for India)
- Existing share token RPC
- Capacitor background geolocation (Phase B)

### 8. Security / privacy
- Explicit consent; auto-stop tracking on complete/cancel
- Message rate limits; no free-form harassment channel in v1 quick pings
- Store review: purpose string must match actual use

### 9. Retention
Safety confidence is the gate for evening/women ridership - a large share of potential seats.

### 10. Metrics
- % active rides with background location permitted (Phase B)
- SOS acknowledge time by admin
- Share-link open rate by contacts
- Quick-message usage vs cancel rate

---

## Ranking rationale (value / adoption / feasibility)

| Rank | Feature | Why this order |
|------|---------|----------------|
| 1 | Daily Commute Autopilot | Without supply, nothing else matters |
| 2 | Honest matching + meeting points | Without quality, supply burns out |
| 3 | Reliability Net | Without recovery, one failure kills habit |
| 4 | Trusted Circles | Accelerates density and trust after basics work |
| 5 | Pocket-Safe Ride | Trust ceiling; Phase A medium, Phase B high |

### Explicitly deferred (do not build next)
- Full chat product
- Razorpay fuel settlement (legal gate)
- Gamification / badges for fun
- City-wide open marketplace before society density proven
- Multi-stop optimised carpools for 3+ different offices (complexity trap)

---

## Mapping to gaps

| Feature | Closes gaps |
|---------|-------------|
| Autopilot | #2, #13, #14 |
| Honest matching | #1, #6, #7 |
| Reliability Net | #3, #8, #9 |
| Circles | cold start / invite (adoption), complements #15 |
| Pocket-Safe | #4, #5, #10 |
