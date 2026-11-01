# Sociva - A Cleaner City

Architecture assessment and foundation for the society-first corporate commute-sharing module.

## Product identity

- Brand: **sociva**
- Module name: **A Cleaner City**
- Tagline: Your daily commute. Shared with your community.
- Entry: Book tab (`/book`) entry card -> hub at `/cleaner-city`
- Feature key: `cleaner_city`

## Locked product decisions

1. **Discovery:** Same society + neighbouring societies now. Match scope config must support city-wide without rewrite.
2. **Vehicles:** Cars and bikes.
3. **Payments:** Fuel cost sharing between residents (not free-only; not platform taxi fares).
4. **Work email:** Approved corporate domains only.
5. **Matching:** Any destination along a compatible host route (route overlap + detour), not same-office-only.

## Placement

Do not model this as a marketplace `category_config` / Book tile. That path forces `ServiceBookingFlow` and commerce-mode classification.

Chosen shape (HelpHub-like):

- Society feature flag `cleaner_city`
- Protected routes under `/cleaner-city`
- Feature-gated Book tab entry card
- Admin stub tab for ops (expanded in Unit 12)

## Module map

| Unit | Module | Notes |
|------|--------|-------|
| 1 | Foundation | Flag, schema, neighbours, match scope, shell UI |
| 2 | Profile and verification | Work-email OTP, company domains |
| 3 | Scheduling | Weekly templates + daily overrides |
| 4 | Host and vehicle | Car/bike profiles, seats, docs |
| 5 | Map and routing | Google Maps abstraction, polylines, detour |
| 6 | Matching | Two-stage filter + route overlap |
| 7 | Discovery and booking | Request/accept, seat locks |
| 8 | Ride lifecycle and OTP | Server state machine |
| 9 | Live tracking and safety | Realtime, SOS, trip share |
| 10 | Ratings | Behaviour metrics, blocks |
| 11 | Notifications and cost share | Queue + fuel ledger settlement |
| 12 | Admin and hardening | Analytics, pilot ops |

## Discovery scope (C-ready)

- Table `society_neighbours` stores admin-managed edges.
- Table `cleaner_city_settings.match_scope`: `same_society` | `neighbours` | `city`.
- Helper `cleaner_city_allowed_society_ids(uid)` expands the allowed set for matching RPCs.
- Rows remain owned by `society_id` for RLS; scope expansion is explicit and server-side only.

Default for new society settings: `neighbours` (decision 1B). City mode is a config flip on the same helper.

## Privacy rules

- Approximate pickup / corridor labels in discovery until a ride is confirmed.
- No live location outside active ride participants.
- Badge copy: **Work email verified** only (not employment independently verified).
- Users can pause commute visibility and delete commute profile without deleting Sociva account.
- Office locations are owner-private until booking confirmation flows (later units) grant limited access.

## Ride lifecycle (server-owned)

Planned states (Unit 8):

`published` -> `requested` -> `confirmed` -> `pickup_pending` -> `started` -> `completed` -> `rated`

Also: `rejected`, `cancelled`, `no_show`, `disputed`, `safety_incident`, `verification_failed`

OTP verification and all status transitions are SECURITY DEFINER RPCs. Clients never mark completion locally. Immutable `ride_events` audit every transition.

## Mapping

- Provider: Google Maps (existing `useGoogleMaps` / Directions / Places).
- Spatial: PostGIS `geography(Point, 4326)` plus lat/lng mirrors.
- Matching uses road-network geometry and detour rules (Units 5-6), not straight-line proximity alone.

Initial configurable thresholds:

| Rule | Initial target |
|------|----------------|
| Pickup deviation | 1.5 km |
| Destination deviation | 2 km |
| Departure difference | 30 minutes |
| Max additional detour | 15 minutes |
| Seat availability | At least 1 |
| Route overlap | At least 65% |

## Fuel cost sharing

Unit 1 creates `ride_cost_shares` ledger skeleton only. Settlement UX and Razorpay/wallet wiring are Unit 11 and require legal review so cost sharing does not become an unlicensed taxi operation.

## Dependencies

| Dependency | Status |
|------------|--------|
| Auth + society membership | Ready |
| Feature flags / HelpHub pattern | Ready |
| Google Maps key | Ready |
| PostGIS | Enabled in Unit 1 migration |
| Work-email SMTP/API | Required for Unit 2 - do not fake OTP |
| Razorpay/wallet | Unit 11 |
| Legal review for cost share | External gate before paid settlement |

## Rollback

1. Disable `cleaner_city` for all societies (feature overrides / packages).
2. Book entry card and routes are gated and become unreachable.
3. Optional SQL rollback: `supabase/rollbacks/20261102090000_cleaner_city_foundation.rollback.sql`

## Unit 1 non-goals

No work-email send, schedule editor, Directions product UI, matching engine, ride OTP, or cost collection UI.
