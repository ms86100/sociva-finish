# Daily food discovery

Sociva pings Greenfield residents only when a neighbour kitchen can actually take the order. The catalogue is the CMS. Voice frames live in git. Silence is a valid outcome.

## Defaults

- Mode: `shadow` (select and log, do not push)
- Breakfast 10:15 IST, lunch 11:15 IST, evening 17:30 IST
- Max 2 discovery pushes per user per day, 10 per week, 4 hours apart
- Type `promotion` through the existing notification queue
- Channel `general`, default sound, never order-alert channels

## Enable in production

1. Deploy the `send-food-discovery` function and migration `20261021250000_food_discovery_engine.sql`.
2. Confirm the three cron jobs exist in Admin > System. Leave them on.
3. Open Admin > Campaigns and dry-run breakfast, lunch and evening.
4. Watch shadow rows for a day. Copy must match a live product/store and a real destination.
5. Switch mode to `live` only after that review.
6. Pause with mode `off`, or disable the cron jobs, if opt-outs spike.

Times, society IDs and store filters are in `notification_config` key `food_discovery`.
