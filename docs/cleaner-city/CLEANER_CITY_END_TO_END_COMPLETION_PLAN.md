# Cleaner City end-to-end completion plan

**Goal:** Make A Cleaner City feel finished for residents: clear setup with real Google Maps route choice, reliable find/request/ride, working safety/comms, polished UI, and no dead buttons.

**Honest baseline (repo audit, not UberPool parity):** roughly **45-55%** of a production society carpool. It is **not** 5%, but many paths feel unfinished (relay call stub, meeting points without map, evening route missing in onboarding, live map is a straight line). That gap is what this plan closes.

Related VoIP platform plan (separate): [`docs/voip/SOCIVA_UNIVERSAL_IN_APP_VOIP_CALLING_PLAN.md`](../voip/SOCIVA_UNIVERSAL_IN_APP_VOIP_CALLING_PLAN.md). Cleaner City peer calling can stay Twilio relay until VoIP ships, or jump to in-app Call once VoIP Phase 1 exists.

---

## Google Maps route selection - current truth

**Yes, partially, on `/cleaner-city/route` (morning only):**

1. Pin **office** and **home / society gate** via Places autocomplete + draggable map ([`CleanerCityPinPicker.tsx`](../../src/components/cleaner-city/CleanerCityPinPicker.tsx)).
2. Google Directions returns up to **3 alternatives** ([`routing.ts`](../../src/lib/cleaner-city/routing.ts)).
3. Rider/host picks one, sees polyline preview ([`CleanerCityRoutePreview.tsx`](../../src/components/cleaner-city/CleanerCityRoutePreview.tsx)).
4. Saves preferred home→office polyline via `cleaner_city_set_preferred_route`.

**Not yet good enough:**

| Gap | Impact |
|-----|--------|
| Setup wizard (`/cleaner-city/setup`) has **no map step** - only links out | Users miss route setup |
| **Office→home** evening route not on route page (only saved when publishing To home) | Guests never set return route |
| Find flow has **no route picker** - uses saved pins only | Feels like matching is magic/wrong |
| Single Google alternative auto-picked with weak confirmation | Users do not feel they chose the road |
| Maps API down → silent haversine on route page | Bad UX / bad matching |
| Meeting points: no map; admin lat/lng text only | Empty society meetups → GPS-only |
| Live ride map: straight line host↔guest | Not turn-by-turn tracking |

---

## Priority backlog (ship in this order)

### P0 - Setup that "just works" (maps + UI)

1. Fold **Office & pickup + route choice** into the setup wizard as a real step (not a buried link).
2. Add **To office** and **To home** route pickers on the route page (both directions, same alternatives UX).
3. Always show route cards (distance, duration, road summary) and require explicit tap even when Google returns one route.
4. Clear offline / no-API state: explain approximate path and block publish/match until confirmed.
5. Save both preferred polylines to profile + weekday templates; surface "Your usual route" chips on Find and Offer.

### P1 - Wire dead / half-dead product paths

1. **Relay call:** either configure Twilio for masked PSTN **or** replace with in-app VoIP CallButton; never leave "queued but not configured" as the happy path.
2. **Meeting points (Uber / Ola / Hopr style):** riders set the pin themselves - GPS chip, guest pickup chip, Places search, drag-to-confirm map. Admin society meetup seeding is **not** required and must not block the flow. Saved suggestions are optional extras only.
3. **Live tracking:** draw host route polyline + live positions; open-in-Maps stays secondary; document iOS background limits.
4. **SOS SMS / dispatcher:** MSG91 (or existing settings) must send; UI shows delivery state.
5. **OTP / meeting-point gate:** keep safety, but copy and empty states must tell the user exactly what to do.
6. **Fuel share:** guest pay + host settle with clear unpaid/paid states; no silent Razorpay route failures.
7. **Chat:** already mostly works post RLS fix; show history prominently; keep Full chat deep link.

### P2 - Matching and ride mission polish

1. Matching must prefer guests/hosts with stored polylines; show "route overlap" honestly on Hopr cards.
2. Offer publish always reuses saved preferred route for that direction before re-fetching Google.
3. Drop run + Maps nav for hosts remains; guest sees Drop N of M and ETA-ish copy.
4. Hub quests / mission UI: one clear next action; remove dead quest targets.

### P3 - Production pilot gates

From [`CLEANER_CITY_FINAL_PRODUCT_READINESS.md`](CLEANER_CITY_FINAL_PRODUCT_READINESS.md):

- Society meetup pins populated for pilot societies
- Device dogfood: Android FG tracking; iOS foreground only
- RLS / concurrency dogfood on request/accept
- Feature flag `cleaner_city` on for pilot societies only until green

---

## UI standard (end user)

- One composition per step; brand-consistent Cleaner City green; no dense dashboard on setup.
- Route step: full-bleed map, one headline ("Choose your usual road"), alternative cards, primary Save.
- Find: keep Hopr match cards; Active ride banner stays first.
- Ride: mission stepper + meeting point map pin + chat + Call that works.
- Never show a primary button that only toasts "not configured".

---

## Explicit non-goals (this plan)

- Full consumer UberX marketplace / dynamic pricing
- Background location on iOS (App Store 2.5.4)
- Call recording
- Replacing Retell Talk-to-Sociva

---

## Suggested execution sequence

1. P0 maps + setup wizard (highest user trust)
2. P1 meeting points + call + SOS + tracking honesty
3. P2 matching/offer polish
4. Pilot checklist + Codemagic builds
5. VoIP module later for native ring (or accelerate if call is P0 for you)
