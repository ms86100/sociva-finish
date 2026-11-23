# Cleaner City - product closure roadmap

Denominator: 49 in-scope capabilities. iOS locked-screen location is N/A because a background location mode fails App Store review, and the repo tests forbid it.

| Bucket | Count | Share of 49 |
| --- | --- | --- |
| Implemented, not verified | 30 | 61% |
| Partial | 10 | 20% |
| Missing from production | 7 | 14% |
| Broken (schema cache on repeat) | 1 | 2% |
| Blocked on real meetup coordinates | 1 | 2% |
| Complete and verified | 0 | 0% |

Verified means a resident session, a device, or a production concurrency test was watched in this pass. None were.

## P0 - before any resident pilot

1. Tap Repeat last commute after the schema reload and confirm Offer or the ride opens. File: `src/hooks/queries/useCleanerCity.ts`. RPC: `cleaner_city_repeat_last_commute()`.
2. Send one work-email OTP to a real inbox and confirm the code arrives from `Sociva <noreply@sociva.in>`.
3. Run resident JWT checks: host can read own publication coordinates, a neighbour cannot, an outsider cannot, circle invite codes stay with members.
4. Run two simultaneous guest requests for the same date and direction on two publications. Expect one ride.
5. Run cancel, waitlist notify, no-show, and SOS on test accounts. SOS copy must stay "not a 112 call".
6. Do not run the Phase 1 rollback.

## P1 - pilot can start only after P0, and these are still required for a trustworthy pilot

1. Apply the repo migrations that are not in production, in order: `20261102240000`, `20261102250000`, `20261102260000`. They were not applied in this pass.
2. Deploy `cleaner-city-dispatch-alerts` only after `msg91_sos_template_id` exists. Until then, SOS stays in-app.
3. Enter real Greenfield gate and clubhouse coordinates in Admin. Do not invent them.
4. Android dogfood of `CommuteTrackingService` on a locked phone and with Maps in front. Ship a new Android build first.
5. Confirm autopilot cron `cleaner-city-autopilot` (`15 20 * * *`) creates drafts and does not double-publish.

## P2 - needed before a public launch, not for a tiny supervised pilot

1. Fuel capture and Razorpay route transfer (`cleaner-city-fuel-order`, `cleaner-city-confirm-fuel`, `cleaner-city-settle-fuel`). Host bank transfer stays payable until a real `acct_` route account succeeds.
2. Ride and circle chat tables, with block filtering.
3. City marketplace only when both people opt in.
4. Up to five typed office stops.
5. Phone verification SMS and WhatsApp fallback.
6. Masked relay calls after Twilio sid, token, and from-number exist.
7. Saved driving-line overlap. Do not call live Google Directions from inside SQL.

## P3 - later

1. Emissions, only after a ride stores a measured distance and the formula is written down.
2. Server-side badges and streaks that ignore WFH, leave, and holidays.
3. Society-level aggregate impact that does not reveal a person's route.
4. Sociva Credit rewards. Onboarding credit stays 500. No commute reward was configured, so none is promised.

## Pilot gate

Not ready. P0 items 2 through 5 are unrun. Repeat-last is fixed in the catalog and unverified on a tap.

## Public launch gate

Not ready. P0, P1, and P2 are open. iOS will not background-locate.

## Explicitly not a launch requirement

Childish points for opening the app, fake nearby-resident counts, invented meetup pins, and a second navigation shell beside Sociva's tab bar.
