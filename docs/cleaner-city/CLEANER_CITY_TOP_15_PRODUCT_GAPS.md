# Cleaner City - Top 15 Product Gaps

Ranked by resident harm and adoption impact. Evidence from repository inspection on 2026-11-01.  
Status vocabulary: **absent** | **partial** | **implemented but untested in product sense** | **working**.

Legend for type: **Confirmed gap** (code proves it) vs **Opportunity** (needs research) called out per row.

---

## 1. Guest pickup never sent into matching

| Field | Detail |
|-------|--------|
| **What product does** | `cleaner_city_find_matches` can filter by pickup corridor when guest coords are provided (`unit6_matching.sql`). |
| **Missing** | Find UI always passes `guest_pickup_lat: null`, `guest_pickup_lng: null`. |
| **Why residents care** | Matches ignore where they actually stand; detour/corridor quality collapses. |
| **Scenario** | Priya at Greenfield Gate 2 searches to Whitefield. Host leaves Gate 4. System cannot corridor-filter; she gets weak or misleading scores. |
| **Adoption impact** | Breaks the core differentiator; churn after first empty/irrelevant search. |
| **Priority** | **P0** |
| **Status** | **Partial** (RPC ready, UI broken) - Confirmed gap |
| **Evidence** | `src/pages/cleaner-city/CleanerCityFindPage.tsx:81-82`; matching corridor logic in `supabase/migrations/20261102150000_cleaner_city_unit6_matching.sql` |

---

## 2. No daily inventory autopilot (schedule does not publish seats)

| Field | Detail |
|-------|--------|
| **What product does** | Rich weekly templates + overrides + pause (`CleanerCitySchedulePage`, Unit 3 RPCs). Manual one-date publish (`CleanerCityOfferPage`). |
| **Missing** | No job/UI that turns "I work Mon-Fri 9:00" into recurring `commute_publications`. |
| **Why residents care** | Drivers will not open the app every night to republish. |
| **Scenario** | Arun sets a perfect schedule once, forgets to publish Tuesday, neighbours see zero seats. |
| **Adoption impact** | Persistent empty Find results; pilot looks dead. |
| **Priority** | **P0** |
| **Status** | **Absent** (by design of Units 3 vs 7) - Confirmed gap |
| **Evidence** | Schedule RPCs create `commute_templates` only; publish is explicit `cleaner_city_publish_commute` from Offer page; no cron/edge found that inserts publications from templates |

---

## 3. No-match is a dead end

| Field | Detail |
|-------|--------|
| **What product does** | Toast "No matches yet for this date" + empty copy. |
| **Missing** | Waitlist, notify-when-available, suggest alternate times, one-tap "offer my seat instead", invite colleagues. |
| **Why residents care** | First failure teaches "this app is empty." |
| **Scenario** | Evening search for tomorrow morning returns nothing; user never returns. |
| **Adoption impact** | Highest early churn driver after cold start. |
| **Priority** | **P0** |
| **Status** | **Absent** - Confirmed gap |
| **Evidence** | `CleanerCityFindPage.tsx:87`, `:200-202`; no waitlist table/RPC under cleaner_city migrations |

---

## 4. Live tracking is foreground-only

| Field | Detail |
|-------|--------|
| **What product does** | While `CleanerCityRidePage` is open and status is `pickup_pending`/`started`, GPS upsert every 10s. Share page polls locations. |
| **Missing** | Background location for active rides; tracking survives lock screen / navigate away. |
| **Why residents care** | Real rides happen with phones in pockets. Family share links freeze. |
| **Scenario** | Guest shares trip with spouse; host switches to Maps/navigation; share map goes stale. |
| **Adoption impact** | Safety perception fails; share feature under-delivers. |
| **Priority** | **P0** for marketed "live tracking"; else P1 with honest UI copy |
| **Status** | **Partial** - Confirmed gap |
| **Evidence** | `CleanerCityRidePage.tsx:70-92`; `src/lib/native-location.ts` requests foreground location; no Cleaner City background geolocation plugin usage found |

---

## 5. SOS does not reach real help

| Field | Detail |
|-------|--------|
| **What product does** | `cleaner_city_report_incident` with type `sos` sets ride `safety_incident`, notifies counterpart via `notification_queue`, lists in admin incidents. |
| **Missing** | Dial emergency services, notify pre-set emergency contacts, guaranteed admin push escalation. |
| **Why residents care** | SOS that only pings the other rider can be useless or dangerous. |
| **Scenario** | Passenger feels unsafe; taps SOS; only the driver (the problem) and a later admin queue are notified. |
| **Adoption impact** | Trust collapse if word spreads; gender-safety adoption blocker (research-backed concern; severity confirmed by code). |
| **Priority** | **P0** |
| **Status** | **Partial** - Confirmed gap |
| **Evidence** | `supabase/migrations/20261102190000_cleaner_city_unit9_tracking_safety.sql` incident + notify; `CleanerCityRidePage` SOS button; no `tel:` / emergency contact table for Cleaner City |

---

## 6. Silent bad geometry (Bangalore fallback on Offer)

| Field | Detail |
|-------|--------|
| **What product does** | Offer caches Directions using origin/destination coords, falling back to `12.9716, 77.5946` when pins missing. |
| **Missing** | Hard block publish without real home/office pins; no resident-visible error. |
| **Why residents care** | Phantom routes match wrong people. |
| **Scenario** | Host skips Route page; publish still succeeds with city-center fallback; matches look random. |
| **Adoption impact** | Corrupts pilot quality metrics and trust. |
| **Priority** | **P0** |
| **Status** | **Partial / defect** - Confirmed gap |
| **Evidence** | `CleanerCityOfferPage.tsx:109-114` |

---

## 7. Route overlap marketed stronger than implemented

| Field | Detail |
|-------|--------|
| **What product does** | Detour minutes hard-filter; overlap % is soft score penalty (`overlap_soft_below_target`). |
| **Missing** | True polyline overlap; hard min overlap if product claims 65%. |
| **Why residents care** | Long detours feel like a taxi favour, not a commute share. |
| **Scenario** | Two people share 20% corridor; still appear as a match with mild score ding. |
| **Adoption impact** | Drivers stop offering after bad detours; passengers feel "not really on the way." |
| **Priority** | **P1** (after Fix #1 and #6) |
| **Status** | **Partial** - Confirmed gap vs `ARCHITECTURE.md` |
| **Evidence** | `ARCHITECTURE.md` thresholds; `unit6_matching.sql:188-200` soft overlap comments |

---

## 8. No-show and dispute states are dead

| Field | Detail |
|-------|--------|
| **What product does** | `rides.status` allows `no_show`, `disputed`. Incidents allow type `no_show`. |
| **Missing** | Any RPC/UI that marks no-show, applies reputation penalty, releases operational expectations, or resolves disputes. |
| **Why residents care** | Waiting at gate with no car destroys the next day's intent. |
| **Scenario** | Host never arrives; guest can cancel or SOS-ish report, but system never records structured no-show or auto-opens backup. |
| **Adoption impact** | Reliability score stays fake; bad actors unpunished. |
| **Priority** | **P0** |
| **Status** | **Absent** (schema only) - Confirmed gap |
| **Evidence** | Foundation CHECK includes statuses; grep of cleaner_city migrations shows no `status = 'no_show'` / `disputed` assignment in RPCs |

---

## 9. No cancel recovery / seat replacement

| Field | Detail |
|-------|--------|
| **What product does** | Cancel ride notifies counterpart; seat can return on reject/cancel paths. |
| **Missing** | Instant waitlist fill, alternate host suggestion, "guaranteed backup" ops playbook. |
| **Why residents care** | Morning cancel with no plan forces solo trip or leave late. |
| **Scenario** | Host cancels at 7:40am; guest only gets a push; Find still empty. |
| **Adoption impact** | One bad morning can end a household's usage. |
| **Priority** | **P1** (P0 if promising reliability in marketing) |
| **Status** | **Absent** - Confirmed gap |
| **Evidence** | Cancel notify in unit7 booking; no waitlist/replacement RPCs |

---

## 10. Pickup coordination without chat or call

| Field | Detail |
|-------|--------|
| **What product does** | Status + OTP + optional labels on pins. |
| **Missing** | In-app short messages or masked call for "I'm at Gate 3 / running 5 min late." |
| **Why residents care** | Society gates are ambiguous; silence creates no-shows. |
| **Scenario** | Guest waits at wrong tower entrance; host circles; both cancel in frustration. |
| **Adoption impact** | Operational friction masquerades as "matching failed." |
| **Priority** | **P1** |
| **Status** | **Absent** - Confirmed gap |
| **Evidence** | No Cleaner City message tables/hooks; ride page has no call CTA |

---

## 11. Vehicle verification is cosmetic

| Field | Detail |
|-------|--------|
| **What product does** | Document metadata rows (`vehicle_documents`), UI "Admin verification comes later", `p_storage_path: null`. |
| **Missing** | Upload, admin approve/reject, badge on match cards. |
| **Why residents care** | Plate/insurance trust before entering a stranger's car. |
| **Scenario** | Passenger sees "car · blue" only; no verified RC. |
| **Adoption impact** | Especially blocks women and parents; slows host supply if docs feel pointless. |
| **Priority** | **P1** for pilot honesty; **P0** before city-wide |
| **Status** | **Partial** - Confirmed gap |
| **Evidence** | `CleanerCityVehiclePage.tsx` (~line 300 copy); `useCleanerCity.ts` document upsert with null storage path; `AdminCleanerCityTab` has no document review UI |

---

## 12. Fuel value invisible at decision time

| Field | Detail |
|-------|--------|
| **What product does** | Post-ride propose/accept/decline ledger (`ride_cost_shares`). No wallet settlement. |
| **Missing** | Pre-ride estimated contribution based on distance/fuel norms; clear social contract. |
| **Why residents care** | People decide to request based on rupees and fairness, not after arrival. |
| **Scenario** | Guest requests; after complete host asks ₹400 unexpectedly; relationship burns. |
| **Adoption impact** | Dispute risk; host/guest asymmetry. |
| **Priority** | **P1** (settlement stays legally gated - estimate can ship without payout) |
| **Status** | **Partial** - Confirmed gap |
| **Evidence** | `CleanerCityRidePage` cost-share UI + "Ledger only" copy; no estimate on Find match cards |

---

## 13. Hub is a setup menu, not a daily commute home

| Field | Detail |
|-------|--------|
| **What product does** | Hub links: setup, schedule, vehicle, route, offer, find. Shows today's schedule snippet. |
| **Missing** | "Today / Tomorrow" primary card with status, next action, and deep link into active ride. |
| **Why residents care** | Commute apps are opened under time pressure. |
| **Scenario** | User has a confirmed ride but must remember to open Find and scan lists. |
| **Adoption impact** | Missed OTPs, missed starts, perceived complexity. |
| **Priority** | **P1** |
| **Status** | **Partial** - Confirmed gap |
| **Evidence** | `CleanerCityPage.tsx` structure; active rides only surfaced inside Find lists |

---

## 14. No commute reminders / pending-request nudges

| Field | Detail |
|-------|--------|
| **What product does** | Event pushes on request, respond, complete, cancel, SOS via generic notification queue. |
| **Missing** | Evening "publish/confirm tomorrow", morning "leave in 20 min", host "request waiting 15 min". |
| **Why residents care** | Habits need prompts; hosts forget open requests. |
| **Scenario** | Guest request sits overnight unanswered; both parties assume the other flaked. |
| **Adoption impact** | Conversion leak between request and confirmed. |
| **Priority** | **P1** |
| **Status** | **Absent** for scheduled reminders - Confirmed gap |
| **Evidence** | `cleaner_city_enqueue_notify` usages are event-driven; `process-notification-queue` has no cleaner_city-specific reminder branch |

---

## 15. Unblock / mid-ride report / reputation on match cards incomplete

| Field | Detail |
|-------|--------|
| **What product does** | Block after completed ride; reputation RPC; match payload can include host stars (unit10/11/12 complete migration). |
| **Missing** | Unblock UI; block/report before or during ride; Find cards may not fully surface trust signals in a scannable way; no "known from 4 prior rides" community cue. |
| **Why residents care** | Trust decisions happen at request time, not only after. |
| **Scenario** | User blocked wrong person; cannot unblock in app. Or sees match with zero trust chrome. |
| **Adoption impact** | Support load + avoidable anxiety. |
| **Priority** | **P2** (unblock P2; trust chrome on cards P1) |
| **Status** | **Partial** - Confirmed gap |
| **Evidence** | `cleaner_city_unblock_user` in `20261102200000_cleaner_city_unit10_11_12_complete.sql`; no `useUnblockUser` in `useCleanerCity.ts`; block UI only on completed ride section of `CleanerCityRidePage.tsx` |

---

## Separators (honesty)

### Confirmed technical defects (fix before features)
1, 4 (if marketed), 5 (if marketed), 6, 8

### Confirmed product absences (build)
2, 3, 9, 10, 13, 14

### Partial trust / commercial
7, 11, 12, 15

### Needs user research (do not over-build from opinion alone)
- Optimal detour minutes for Greenfield corridors
- Whether masked phone vs short chat is preferred for pickup
- In-app fuel settlement willingness vs UPI outside app
- Night commute safety requirements by gender/age segment

### Explicitly NOT listed as top gaps (already working enough for pilot)
- Seat hold concurrency (working)
- Work email OTP path (working; domain ops needed)
- Server OTP start/complete (working)
- Feature flag / society tenancy (working)
- Trip share token page (working at web level)
- Cost settlement via Razorpay (correctly postponed; legal)
