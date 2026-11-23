# Cleaner City - Cross-Feature Integration Audit

**Audit date:** 2026-11-01  
**Rule:** Do not treat module completeness as integration completeness.  
**No application code modified.**

---

## Integration checklist (required examples)

| # | Integration | Status | Evidence / break |
|---|-------------|--------|------------------|
| 1 | Autopilot publication appears in matching | PARTIAL | Autopilot inserts `commute_publications` with draft/published; Find uses `cleaner_city_find_matches` on published with seats. Works when auto mode or after Confirm. Drafts are invisible to Find (correct). Gap: cancelled-then-recreated pubs and null-coord pubs can enter matching. |
| 2 | Matching respects Circle preferences | PARTIAL | Soft `shared_circle` +30 only. No circle-only / circle-first hard tier. Stuck boost if leave missing. |
| 3 | Matching can recommend a meeting point | PARTIAL | Meeting points chosen **after** accept on Ride page, not during match/accept sheet. Prod `society_meetup_points` = 0 rows → picker empty unless GPS. |
| 4 | Cancelled ride activates Reliability Net | BROKEN / WEAK | Ride cancel: counterpart push "cancelled"; client-only suggest replacements for canceller. Publication cancel: **no** guest cascade, **no** waitlist re-notify. Seat frees do not call `cleaner_city_notify_waitlist_for_publication`. |
| 5 | Waitlist replacement respects Circles + blocks | BROKEN | Waitlist notify: date+direction only; **no** block filter; **no** circle preference. |
| 6 | Confirmed replacement has correct pickup/meeting point | PARTIAL | Replacement is re-`request_ride` with guest coords from Find state if user searches again. No automatic meeting point carry-over. Double-book across pubs possible. |
| 7 | Pocket-Safe tracking only for eligible active ride | OK (design) | Client polls only for `pickup_pending`/`started`; RPC rejects other statuses. |
| 8 | SOS notifies correct emergency contacts | BROKEN | Contacts saved without `notify_user_id` → SOS fan-out empty for contacts; counterpart may still get notify. Copy claims contacts are notified. |
| 9 | Notifications deep-link to correct ride | PARTIAL / LIKELY OK | `reference_path` set to `/cleaner-city/ride/:id` or hub; client `pickNotificationRoute` honors it. Not device-verified. |
| 10 | Feature flag + society RLS on all ops | PARTIAL | Restrictive feature-gate policies on core tables (foundation). SECURITY DEFINER RPCs generally call require helpers. Gaps: publications SELECT over-exposes columns; circles READ over-exposes invite codes; some publish paths skip pin checks. |

---

## Broken integration chains (resident impact)

### Chain A - Morning supply → Find
1. Host enables Autopilot (confirm mode).
2. 20:15 IST cron drafts tomorrow.
3. Host confirms → waitlist notified (date/direction only).
4. Guest Find matches using haversine, not road geometry.
5. **Breaks honesty** of "route overlap" marketing.

### Chain B - Host cancels publication with booked guests
1. Guests confirmed on publication.
2. Host calls `cleaner_city_cancel_publication`.
3. Publication status cancelled.
4. **Break:** confirmed rides remain; guests not notified; waitlist not offered replacements.

### Chain C - Circle trust → matching
1. Two users join via leaked or shared code.
2. Match cards show "In your circle".
3. **Break:** cannot leave; cannot remove; invite never expires; society peers can read codes.

### Chain D - SOS → family
1. Resident adds father by phone on Safety page.
2. SOS on ride.
3. **Break:** no `notify_user_id` → father not notified; no SMS; admin not pushed.

### Chain E - Pocket safety while navigating
1. Ride starts; 10s GPS poll while app open.
2. User opens Google Maps for navigation.
3. **Break:** tracking pauses until resume; share link viewers see stale points.

---

## Feature flag & Book tab coexistence

| Surface | Observation |
|---------|-------------|
| Routes | `/cleaner-city/*` lazy-loaded beside `/book` in `App.tsx` - separate trees |
| Gate | `CleanerCityGate` + `can_access_feature(..., 'cleaner_city')` |
| Book / commerce | No shared write path into Cleaner City tables found in Book flows |
| Delivery tracking | Uses `useBackgroundLocationTracking` (delivery); Cleaner City does **not** reuse it |
| Notifications | Shared `notification_queue` with Cleaner City types; dest paths namespaced |

Regression of Book/Orders/Contact was **not** e2e-tested in this audit (see regression report). Static routing separation looks intact.

---

## Notification path map

| Event | Enqueued? | Dest | Consumer integration risk |
|-------|-----------|------|---------------------------|
| Autopilot draft | Yes | `/cleaner-city` | OK if process-notification-queue healthy |
| Waitlist seat opened | Yes (publish confirm only) | Find/hub path | Misses cancel frees |
| Ride cancel | Yes (counterpart) | ride path | No replacement payload |
| SOS | Yes (counterpart + notify_user_id contacts) | share/ride | Contacts empty in practice |
| Admin SOS | No push | Admin polls | Ops blind until open dashboard |

---

## Idempotency across features

| Area | Idempotent? | Note |
|------|-------------|------|
| Autopilot publish | Soft | EXISTS without UNIQUE |
| Waitlist join | Yes | UNIQUE(user_id, date, direction) |
| Notification enqueue | Mostly | ON CONFLICT DO NOTHING keys on many paths |
| Seat claim | Partial | FOR UPDATE on same pub; not across pubs |
| Circle join | Soft | Can re-join; no leave |

---

## Conclusion

Individual modules were shipped as parallel slices. The resident journey that connects Autopilot → Match → Book → Cancel → Waitlist → Safety does **not** hold end-to-end. Highest integration risks for pilot: publication cancel silence, waitlist one-shot notify, SOS contact dead-end, circle invite RLS leak, matching honesty vs copy.
