# Cleaner City - gamified experience strategy

The home screen should feel like a daily community commute, using Sociva's existing green (`#0D3327`, `#A3C9A8`), 26px cards, and the current bottom tabs. It should not look like a separate game.

## What the resident should feel

1. Open Cleaner City and see the next unfinished step.
2. Finish that step on the screen it links to.
3. See tomorrow's commute and one primary action: repeat, confirm, or find a seat.
4. After a completed ride, see the finished-ride count increase. Nothing else is counted.

## Mechanics that are live in the client

### Quest path

Source: `src/components/cleaner-city/CommuteJourney.tsx`, fed by profile, work verification, office rows, templates, vehicles, emergency contacts, and rides.

| Step | Done when | Opens |
| --- | --- | --- |
| Verify work email | verification status is verified | `/cleaner-city/setup` |
| Pin office | at least one office row | `/cleaner-city/route` |
| Pin pickup | a template has `pickup_latitude` | `/cleaner-city/route` |
| Set times | a working template has `depart_time` | `/cleaner-city/schedule` |
| Add vehicle, or find a ride | host has a vehicle, or guest has a ride | vehicle or find |
| Verify a contact | a contact has `verified_at` | `/cleaner-city/safety` |
| Finish a ride | a ride status is `completed` | active ride, or find |

There is no server award. Closing the app does not grant a step. WFH does not fail a streak, because there is no streak.

### Impact

Home shows the count of rides with status `completed`. Emissions are withheld. No distance column is used.

### XP shown on the card

`done steps * 40 + completed rides * 30`, displayed as a level name. This number is not stored, not spendable, and not a Sociva Credit. It is a progress label only. If that feels like a fake score, the next change should drop the number and keep the checklist.

## Mechanics that are not live

| Mechanic | Rule when the migration is applied | Why it is off |
| --- | --- | --- |
| Server badges | Inserted by `cleaner_city_refresh_badges` when a ride becomes completed | Table is not in production |
| First ride, five, ten | Completed rides as host or guest | Same |
| Reliable host | 5 completed as host and 0 host no-shows | Same |
| Circle rider | In a circle and 2 completes | Same |
| Safety ready | One contact with `verified_at` | Same |
| City explorer | City opt-in and 1 complete | City column is not in production |
| Multi office | One publication with 3 or more stops | Stop table is not in production |
| Streak | Not implemented | A streak would punish leave and WFH unless those days are excluded. They are not modeled as a streak |
| Credits | Not awarded for commutes | Onboarding credit remains 500. No commute reward is configured |

## Anti-abuse

- Quest ticks read the resident's own rows. They do not accept a posted point total.
- Badge inserts, when they exist, are `ON CONFLICT DO NOTHING` and run inside a security-definer trigger on a completed ride. The client cannot insert them.
- Cancelling a ride does not currently revoke a badge. That reversal is not built. Do not advertise badges until reversal exists.
- Community totals must be counts, never another resident's pin.

## Safety

SOS, share, and block stay on the ride and safety screens. They are not behind a level gate.
