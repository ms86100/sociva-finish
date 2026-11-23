# Cleaner City - Hidden Gaps and Defects

**Audit date:** 2026-11-01  
**Standard:** Skeptical product owner. Evidence-backed only. No speculative "maybe" bugs.  
**No application code modified.**

---

## Defects with reproduction

### H1 - Route page can overwrite real pickup with Bangalore (P0)

- **Evidence:** `src/pages/cleaner-city/CleanerCityRoutePage.tsx` lines 46-57 set pickup to `{ lat: 12.9716, lng: 77.5946, label: t.pickup_label }` when template has `pickup_label` but in-session pickup state is empty - **ignores saved `pickup_latitude/longitude`.**
- **Steps:** Open Route for a weekday that already has a saved label+coords in DB; leave picker untouched this session; Save pickup.
- **Result:** Risk of writing Bangalore coords over a real society pin.
- **Why hidden:** phase0/1-4 tests only assert Find/Offer lack Bangalore; Ride/PinPicker map *center* defaults are benign and grepped as allowed.

### H2 - SOS copy overpromises contact notification (P0)

- **Evidence:** `CleanerCitySafetyPage.tsx` `addContact` omits `notify_user_id`; display says "display only, not a Sociva account yet"; Ride SOS copy still says contacts with Sociva accounts are notified.
- **Steps:** Add emergency contact with name+phone only → start ride → SOS.
- **Result:** Contact not notified; user believes they were.

### H3 - Hub "Match by route overlap" overstates engine (P1)

- **Evidence:** Hub marketing vs `cleaner_city_find_matches` haversine-only scoring (no polyline read).
- **Steps:** Compare two matches with similar straight-line detour but different road corridors.
- **Result:** Ranking may disagree with real Maps routes while UI implies overlap matching.

### H4 - Publication cancel leaves guests stranded without notice (P0)

- **Evidence:** `cleaner_city_cancel_publication` only flips publication status (`20261102130000_...sql`); no ride cascade.
- **Steps:** Guest confirmed → host cancels publication (not individual ride) → guest app/notifications.
- **Result:** Guest retains confirmed ride against cancelled inventory; no replacement push from that path.

### H5 - Empty meeting-point UX with no admin seed (P1)

- **Evidence:** Prod `society_meetup_points` count = 0; Ride page still shows meeting-point section.
- **Steps:** Confirm ride → open meeting picker at Greenfield.
- **Result:** Empty list; only "Use GPS" path - no society gate/clubhouse suggestions.

### H6 - Circles page is a dead-end after join (P1)

- **Evidence:** Only create/join/copy code; prod has no leave/remove RPCs; no member list.
- **Steps:** Create circle → join from second account → try leave or remove.
- **Result:** No UI/RPC; "In your circle" boost permanent until DB edit.

### H7 - Invite code privacy failure (P0)

- **Evidence:** `commute_circles_read` society-wide SELECT includes `invite_code`.
- **Steps:** Any society member queries circles table for codes → joins private circle.
- **Result:** Private circle model fails.

### H8 - Waitlist success path does not cover the failure modes that need it (P0)

- **Evidence:** `cleaner_city_notify_waitlist_for_publication` only from confirm-publish; cancel/no_show/timeout seat++ omit it.
- **Steps:** Join waitlist → host publishes (notify works) vs join waitlist → seat frees after cancel (silent).
- **Result:** Reliability Net does not activate on the most common "seat opened" events.

### H9 - Auto Autopilot mode hides hub draft UX (P2)

- **Evidence:** Hub draft card binds to draft publications; auto mode inserts `published` directly.
- **Steps:** Set Autopilot auto → next morning → hub.
- **Result:** No Tomorrow confirmation surface; host may not notice live seats.

### H10 - Find waitlist vs hub recovery disconnect (P2)

- **Evidence:** Waitlist state only on Find page; hub has no chip.
- **Steps:** Join waitlist → return to hub.
- **Result:** User cannot see recovery status without re-entering Find.

---

## UX / journey gaps (evidence-backed)

| Gap | Evidence |
|-----|----------|
| No Repeat last commute | Grep + unimplemented doc; absent in Offer/hub |
| No WFH on draft card | Hub only Skip/Confirm |
| No walking distance on cards | `pickup_deviation_meters` unused in Find render |
| Full vs empty Find indistinguishable | Same empty CTA |
| Safety cannot link Sociva user as contact | No picker for `notify_user_id` |
| No masked call | Absent from cleaner-city pages |
| Vehicle KYC upload | Metadata only (prior gap doc; not re-built) |
| Fuel settlement | Ledger/estimate only - intentional defer |

---

## Mobile-specific

| Issue | Evidence |
|-------|----------|
| No true background geolocation for rides | `native-location.ts` comments + no Transistorsoft for CC; interval on Ride page |
| Delivery has separate BG path | `useBackgroundLocationTracking` not used by Cleaner City |
| iOS/Android lock/Maps scenarios | BLOCKED - not device tested; architecture cannot satisfy without native BG |

---

## Accessibility / loading / empty states

Observed positive: several empty states (waitlist, emergency contacts, Find empty).  
Gaps: meeting points empty lacks admin-seed guidance for residents; Circles empty does not explain invite privacy model; Autopilot auto mode lacks status card.

---

## Admin / ops dependencies

| Dependency | State |
|------------|-------|
| Seed Greenfield meetup points | **Not done** (0 rows) |
| Approve company domains | Manual admin; Setup can request |
| Resend From address | Historically missing (`resend_from_email`) - OTP delivery ops risk |
| Admin SOS push | Missing - dashboard pull only |
| pg_cron jobs | Present and active in prod |

---

## Scalability / races

| Issue | Evidence |
|-------|----------|
| Autopilot duplicate race | EXISTS without UNIQUE |
| Double guest booking | request_ride scoped per publication |
| Waitlist notify LIMIT 20 | FIFO but no hold - thundering herd on Find |

---

## What was deliberately not filed

- Speculative performance of PostGIS at city scale without load data  
- Unconfirmed Resend delivery failures without a fresh invoke this audit  
- Assumptions about Codemagic binary containing `6d95c7a` without re-checking build  
