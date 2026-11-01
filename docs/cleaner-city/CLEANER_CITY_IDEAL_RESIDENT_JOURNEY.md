# Cleaner City - Ideal Resident Journey

Maps the intended experience from first open to weekday habit, marks **abandonment risks** against today's implementation, and recommends friction cuts.

Evidence of current UX: `CleanerCityEntryCard`, hub `CleanerCityPage`, setup/schedule/vehicle/route/offer/find/ride pages, Unit 2-12 RPCs.

---

## Journey map

### 1. Discovering Cleaner City inside Sociva

**Ideal:** On Book tab, a live card: "3 seats toward Whitefield tomorrow" or "Set up your commute in 2 minutes."  
**Today:** Static marketing card (`CleanerCityEntryCard`) - tagline + "Verified commuters" / "Smart route matching". No live inventory.  
**Abandon risk:** Card looks like another promo; tap curiosity dies if next screen is a setup wall.  
**Cut friction:** Show live count when publications exist; otherwise "Be the first seat on your corridor this week."

### 2. Understanding the value proposition

**Ideal:** One screen: save fuel, ride with society neighbours, work email trust, not a taxi.  
**Today:** Hub hero + participation gate amber box. Value is scattered across tiles.  
**Abandon risk:** Unclear whether this is for drivers, passengers, or both.  
**Cut friction:** Role chooser first ("I drive" / "I need a seat" / "Both") with a 3-bullet promise.

### 3. Setting up a commute profile

**Ideal:** Single guided flow: role -> typical leave time -> home gate pin -> office pin.  
**Today:** Separate Setup, Schedule, Route, Vehicle pages from hub menu.  
**Abandon risk:** Multi-visit setup; user verifies email then never returns to pins.  
**Cut friction:** Wizard with progress 1/4..4/4; allow "finish later" but block Offer/Find until minimum complete.

### 4. Verifying identity

**Ideal:** Work email OTP in under 60 seconds; clear list of approved domains; request-domain CTA.  
**Today:** OTP via edge function; failure if domain not approved; no in-product "request my company" guest flow. Badge is honestly "Work email verified" only.  
**Abandon risk:** Corporate email on personal phone friction; domain rejection with no next step.  
**Cut friction:** Domain check before send; admin request form; keep badge wording honest (do not imply employment verification).

### 5. Adding a vehicle (hosts)

**Ideal:** Number plate, type, seats, optional photo; bike = 1 seat obvious.  
**Today:** Form works; documents metadata with "Admin verification comes later"; no upload.  
**Abandon risk:** Hosts skip docs (fine for pilot); passengers later distrust.  
**Cut friction:** For pilot, make docs optional and say so; do not pretend verification exists.

### 6. Publishing a commute

**Ideal:** Autopilot from schedule; or one-tap "Publish tomorrow morning."  
**Today:** Manual Offer page per date; can publish with Bangalore fallback coords if pins missing (**defect**).  
**Abandon risk:** Too many fields; bad geometry creates bad matches.  
**Cut friction:** Block publish without pins; default date/time from effective schedule; Autopilot (Must-Build #1).

### 7. Discovering a compatible match

**Ideal:** Open app -> matches already ranked; or push "seat on your corridor."  
**Today:** Manual Search; guest pickup always `null` (**defect**); empty state dead end.  
**Abandon risk:** Highest. Empty / irrelevant results teach permanent disengagement.  
**Cut friction:** Require pickup pin; waitlist; proactive push from Autopilot inventory.

### 8. Comparing available rides

**Ideal:** Cards with leave time, detour, seats, company, reputation, estimated fuel share, Circle badge.  
**Today:** Time, vehicle, labels, seats, score, detour if present, host company. Score is opaque. Reputation not first-class on card UI. No fuel estimate.  
**Abandon risk:** Cannot tell good from bad match.  
**Cut friction:** Replace raw "score" with human reasons; show stars/completed rides; show estimated ₹ contribution band.

### 9. Requesting or accepting a seat

**Ideal:** Request holds seat; host gets push with guest corridor label + reputation; accept in one tap.  
**Today:** Request/accept RPCs + notifies exist; host may miss request (no expiry nudge).  
**Abandon risk:** Requests rot unanswered.  
**Cut friction:** Request TTL + host reminder (Must-Build #3).

### 10. Confirming the ride

**Ideal:** Both see confirmed card on hub: time, meeting point, partner first name, cancel policy.  
**Today:** Status lives in Find lists / ride page; hub does not prioritise confirmed ride.  
**Abandon risk:** User forgets they have a ride; no morning orientation.  
**Cut friction:** Hub "Today's ride" primary card.

### 11. Communicating pickup instructions

**Ideal:** Meeting point + quick pings / masked call.  
**Today:** Labels + hope; no chat/call.  
**Abandon risk:** Wrong gate; perceived no-show.  
**Cut friction:** Meeting points + quick messages (Must-Build #2 and #5 Phase A).

### 12. Starting the journey

**Ideal:** Host generates OTP; guest enters; both navigate; background track on.  
**Today:** OTP flow works server-side; tracking only while ride screen open.  
**Abandon risk:** OTP UX friction in traffic; tracking gap.  
**Cut friction:** Large OTP UI; optional host "I'm arriving" ping; background track Phase B.

### 13. Completing the journey

**Ideal:** Host completes; both prompted to rate and agree fuel share with prefilled estimate.  
**Today:** Complete RPC + rating + propose/accept cost share (ledger only).  
**Abandon risk:** Awkward money conversation; skip rating.  
**Cut friction:** Prefill estimate; allow "settle on UPI" acknowledgment without Razorpay.

### 14. Sharing expenses

**Ideal:** Transparent estimate before ride; settle outside or later in-app when legal.  
**Today:** Post-ride negotiation only; `settled` unused.  
**Abandon risk:** Disputes; hosts feel unpaid; guests feel ambushed.  
**Cut friction:** Estimate at match time; keep payout legally gated.

### 15. Rating the experience

**Ideal:** 1-tap stars + optional note; feeds match cards.  
**Today:** Rating after complete on ride page; reputation RPC exists.  
**Abandon risk:** Easy to skip; trust graph stays thin.  
**Cut friction:** Mandatory soft prompt before leaving ride page; show on Find cards.

### 16. Repeating tomorrow

**Ideal:** Autopilot + "Same as last time"; Circles see who is going.  
**Today:** Start over: Offer/Find again.  
**Abandon risk:** Habit never forms - product dies as a novelty.  
**Cut friction:** Must-Build #1 and #4.

---

## Abandonment funnel (compressed)

| Step | Likely drop cause today | Severity |
|------|-------------------------|----------|
| Entry -> Hub | Promo fatigue | Medium |
| Hub -> Setup complete | Multi-page setup | High |
| OTP | Domain not approved | High |
| Setup -> Pins/Vehicle | No guided continuum | High |
| First Find | Empty / null pickup matching | **Critical** |
| Request -> Accept | No host nudge/TTL | High |
| Confirm -> Pickup | No meeting point / chat | High |
| Active ride | Tracking/SOS trust | Medium-High |
| Complete -> Repeat | No autopilot | **Critical** |

---

## Recommended minimum path (pilot onboarding)

**Guest (target < 4 minutes):**  
Book card -> role Guest -> work email OTP -> home pickup pin -> office pin -> default Mon-Fri time -> Find tomorrow.

**Host (target < 6 minutes):**  
Role Host -> OTP -> vehicle basics -> pins -> schedule -> enable Autopilot -> done.

Defer: document verification workflow, Circles creation, background location education (until Phase B), cost settlement.

---

## Tone and complexity principle

The product should feel like **confirming a society WhatsApp carpool with superpowers**, not like onboarding a logistics SaaS. Every extra tile on the hub that is not "Today/Tomorrow" competes with the habit.
