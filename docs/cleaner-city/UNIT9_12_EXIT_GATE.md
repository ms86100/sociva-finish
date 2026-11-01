# Units 9-12 exit gate

## Unit 9 - Live tracking and safety

- `ride_locations` with participant RLS + 3s write rate limit
- Active-ride-only publish (`pickup_pending` / `started`)
- SOS / incidents (`ride_incidents`) - SOS flips ride to `safety_incident`
- Trip share tokens (`cleaner_city_create_share_token` / `view_shared_ride`)
- UI: `/cleaner-city/ride/:id`, `/cleaner-city/share/:token`

## Unit 10 - Ratings and reputation

- Ratings UI on completed rides
- `cleaner_city_reputation` aggregates
- `commute_blocks` exclude mutual blocks from matching/requests

## Unit 11 - Notifications and fuel cost sharing

- Idempotent `notification_queue` inserts on request/accept/reject/complete/SOS
- Cost-share propose/confirm UI (ledger only; no Razorpay payout)

## Unit 12 - Admin and hardening

- Admin tab: domains, open incidents, match scope, pilot stats
- Request rate limit (20/hour)
- Match scope `same_society` | `neighbours` | `city`

## External gates

- Resend domain verification required to email arbitrary corporate inboxes
- Cost-share money movement remains legally gated
