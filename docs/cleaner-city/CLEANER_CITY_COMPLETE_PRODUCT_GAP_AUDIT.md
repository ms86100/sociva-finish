# Cleaner City - complete product gap audit

Date: 2026-11-01. Evidence is the repository plus production project `kkzkuyhgdvyecmxtmkpy`.

Counting method: 50 resident-facing capabilities from the requested inventory. Each gets one status. A screen or a function name is not enough for COMPLETE AND VERIFIED. Nothing in this audit is COMPLETE AND VERIFIED, because this pass did not run a resident browser journey, a resident JWT RLS test, or a device ride.

Statuses used below:

- INV: implemented in the running database or the app, not verified end to end in this pass
- PARTIAL: some of the workflow exists
- MISSING: not in the running database, even if a repo file exists
- BROKEN: the resident can hit a failure today
- BLOCKED: needs an external account, credential, coordinate, or test session
- N/A: deliberately out of scope for a stated reason

## Production facts checked with SQL

- `cleaner_city_repeat_last_commute()` exists, zero arguments, `SECURITY DEFINER`, `EXECUTE` granted to `authenticated` only. ACL: `{postgres=X/postgres,authenticated=X/postgres}`.
- The API error in the screenshot is PostgREST PGRST202 (schema cache), not a missing function. `NOTIFY pgrst, 'reload schema'` was sent after the screenshot. A successful tap after that reload was not observed.
- Present in production: booking lock, outbound alert table, seat-offer table, circle-invite table, repeat-last, mark WFH, autopilot cron `15 20 * * *`, reminders cron hourly, timeouts cron every 15 minutes, `resend_from_email` set.
- Absent in production: `ride_chat_messages`, `commute_publication_stops`, `ride_fuel_payments`, `cleaner_city_badges`. Meetup rows: 0.
- Deployed Cleaner City edge function: `cleaner-city-work-email-otp` only. Fuel order, fuel confirm, fuel transfer, and alert dispatcher are not deployed.

## Feature matrix

| # | Feature | Status | Evidence |
| --- | --- | --- | --- |
| 1 | Book entry | INV | `src/components/cleaner-city/CleanerCityEntryCard.tsx`, route `/cleaner-city` in `src/App.tsx` |
| 2 | Feature flag gate | INV | `CleanerCityGate.tsx`, `useEffectiveFeatures.ts`. Not toggled in this pass |
| 3 | Profile setup | INV | `CleanerCitySetupPage.tsx`, `cleaner_city_upsert_commute_profile` |
| 4 | Work-email OTP | INV | Edge `cleaner-city-work-email-otp` v3. From address row exists. Inbox delivery not retested |
| 5 | Domain check and request | INV | `cleaner_city_check_work_email_domain`, `cleaner_city_request_company_domain` |
| 6 | Office pin | INV | `CleanerCityRoutePage.tsx`, `office_locations` |
| 7 | Weekday pickup pin | INV | Route page writes pickup onto `commute_templates` |
| 8 | Weekly schedule | INV | `CleanerCitySchedulePage.tsx`, `cleaner_city_set_commute_template` |
| 9 | Date override | INV | `cleaner_city_set_commute_override` |
| 10 | WFH | INV | `cleaner_city_mark_wfh` is in production. UI only toasts. Not executed |
| 11 | Autopilot cron | INV | `cron.job` `cleaner-city-autopilot` active. This pass did not watch a run |
| 12 | Repeat last commute | BROKEN | Function exists. Resident tap returned schema-cache PGRST202. Cache reload not retested |
| 13 | Duplicate host publication | INV | Phase 1 unique index was applied earlier. Not retested |
| 14 | Vehicle add and edit | INV | `CleanerCityVehiclePage.tsx`, `cleaner_city_upsert_vehicle` |
| 15 | Vehicle document review | PARTIAL | Upload UI is in the repo. `cleaner_city_admin_review_vehicle_document` is not in the production function list |
| 16 | Seat counts | INV | `seats_available` / `seats_total` on publications |
| 17 | Host and guest reputation | INV | `cleaner_city_reputation`. Not opened in the UI this pass |
| 18 | Map pin picker | INV | `CleanerCityPinPicker.tsx`, `get-google-maps-key` is deployed |
| 19 | Route preview | PARTIAL | Preview can show `haversine_fallback`. That is straight-line, not a driven route |
| 20 | Corridor match | PARTIAL | Production `cleaner_city_find_matches` uses distance and detour. `cleaner_city_polyline_overlap_pct` is not in production |
| 21 | Meetup suggestions | BLOCKED | `society_meetup_points` count is 0. Admin form exists. Coordinates were not invented |
| 22 | Society discovery | INV | Find page calls `cleaner_city_find_matches` |
| 23 | City marketplace | MISSING | UI calls `cleaner_city_set_discovery_prefs`. That function is not in production |
| 24 | Publish a seat | INV | `cleaner_city_publish_commute` |
| 25 | Request, accept, reject | INV | `cleaner_city_request_ride` (lock helper exists), `cleaner_city_respond_ride_request` |
| 26 | Cross-publication double book | INV | Lock function is in production. The concurrent proof was local PostgreSQL, not production |
| 27 | Cancel ride and publication | INV | Functions exist. Lifecycle test not run |
| 28 | Waitlist | INV | Join and leave functions exist. Notify-on-release not executed |
| 29 | 10-minute replacement hold | PARTIAL | `commute_seat_offers` table exists. Offer and expire functions are not in the production catalog |
| 30 | OTP, start, complete | INV | Three RPCs exist. Not executed |
| 31 | No-show | INV | `cleaner_city_mark_no_show`. Not executed |
| 32 | Emergency contacts | PARTIAL | Save and in-app link work. Phone verification SMS needs the dispatcher |
| 33 | SOS | PARTIAL | `cleaner_city_report_incident` notifies in-app. SMS and WhatsApp are not sent. Dispatcher is not deployed |
| 34 | Share link | INV | `cleaner_city_create_share_token`, `CleanerCitySharePage.tsx` |
| 35 | Quick messages | INV | `cleaner_city_send_quick_message` |
| 36 | Masked call | MISSING | `cleaner_city_request_masked_call` is not in production. Dispatcher is not deployed |
| 37 | Foreground location | PARTIAL | Ride page watches location while open and queues failed samples in `locationOutbox.ts` |
| 38 | Android locked-screen location | PARTIAL | `CommuteTrackingService.kt` is a foreground service. No device run |
| 39 | iOS locked-screen location | N/A | `UIBackgroundModes` location is intentionally absent. App Store 2.5.4. Tests forbid it |
| 40 | Circles create, join, leave, rotate | INV | Matching RPCs are in production |
| 41 | Named circle invites | PARTIAL | `commute_circle_invites` exists. Invite RPCs are not in the production function list |
| 42 | Ratings | INV | `cleaner_city_submit_rating` |
| 43 | Quest path on home | PARTIAL | `CommuteJourney.tsx` is computed in the browser from profile, pins, templates, vehicles, contacts, and completed rides. It is not a server award |
| 44 | Server badges | MISSING | `cleaner_city_badges` table is not in production |
| 45 | Emissions impact | MISSING | No stored measured distance. Home shows completed-ride count only |
| 46 | Push deep links | INV | `cleaner_city_enqueue_notify` writes `notification_queue`. Delivery of a commute push was not observed |
| 47 | Admin Cleaner City tab | INV | `src/components/admin/AdminCleanerCityTab.tsx`, `cleaner_city_admin_stats` |
| 48 | Fuel payment and bank transfer | MISSING | No fuel table in production. Fuel edge functions are not deployed |
| 49 | Ride and circle chat | MISSING | Chat page exists. `ride_chat_messages` is not in production |
| 50 | Five office stops | MISSING | Stop table is not in production. Offer page UI will fail on save |

## Historical risks, rechecked

1. Resend From address: `resend_from_email` is set and active. Inbox delivery was not repeated.
2. Resident RLS A/B/C: still blocked. No controlled resident JWTs were used. Service role was not treated as proof.
3. Double-book lock: the function is in production. The concurrent A-F proof remains the earlier local PostgreSQL run, not a production run.
4. Cancel, waitlist, SOS, OTP lifecycle: not executed in this pass.
5. iOS and Android dogfood: not executed.
6. Meetup coordinates: still 0.
7. Background location: Android service is source only. iOS background mode was not added.
8. Phase 1 rollback still restores weaker publication and circle policies. Do not run `supabase/rollbacks/20261102230000_cleaner_city_phase1_remediation.rollback.sql`.

## Repeat-last error

Expected: tap Repeat last commute, then land on Offer (host draft) or the ride (guest request).

Actual: toast `Could not find the function public.cleaner_city_repeat_last_commute without parameters in the schema cache`.

Why: the function was created after PostgREST built its schema cache. The database catalog already had the zero-argument function.

Work done: schema reload notification, and the client retries once after 1.5 seconds if that error returns.

Acceptance: tap the button again. A host with a previous commute should open Offer with tomorrow's draft, or see "Tomorrow already has a commute from you". A guest should open the new ride request. If the toast still mentions the schema cache, the API process did not reload and needs one more schema reload from the Supabase dashboard.
