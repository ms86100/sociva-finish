# A Cleaner City - API contracts (Unit 1 planning)

Unit 1 ships schema, RLS, and `cleaner_city_allowed_society_ids` only. The RPCs below are **planned contracts** for later units. Do not invent client stubs that pretend they work.

## Unit 1 (shipped)

| Name | Type | Purpose |
|------|------|---------|
| `cleaner_city_allowed_society_ids(p_uid uuid DEFAULT auth.uid())` | RPC / SQL helper | Returns society UUID array for match scope: self, self+neighbours, or all active societies |

## Unit 2 - Profile and work verification

| Name | Purpose |
|------|---------|
| `cleaner_city_upsert_commute_profile(...)` | Create/update commute profile; requires approved resident + feature |
| `cleaner_city_request_work_email_otp(p_email text)` | Edge + DB: send OTP only if domain in `company_domains` status=`approved` |
| `cleaner_city_verify_work_email_otp(p_email text, p_code text)` | Verify OTP, write `work_verifications`, never store plaintext OTP long-term |
| `cleaner_city_admin_upsert_company_domain(...)` | Admin approve/reject domains |

## Unit 3 - Scheduling

| Name | Purpose |
|------|---------|
| `cleaner_city_set_commute_template(...)` | Weekly recurring plan |
| `cleaner_city_set_commute_override(p_date date, ...)` | One-day override / WFH / leave; does not rewrite other days |
| `cleaner_city_pause_commute(p_paused boolean)` | Pause discovery without deleting profile |
| `cleaner_city_effective_schedule(p_user_id uuid, p_date date)` | Resolve override over template |

## Unit 4 - Host and vehicle

| Name | Purpose |
|------|---------|
| `cleaner_city_upsert_vehicle(...)` | Car/bike profile; bike seat cap enforced |
| `cleaner_city_publish_commute(...)` | Publish seats for a date; requires verified work email + vehicle when host |

## Units 5-6 - Routing and matching

| Name | Purpose |
|------|---------|
| `cleaner_city_store_route_geometry(...)` | Cache encoded polyline / geography |
| `cleaner_city_find_matches(p_date date, p_direction text, ...)` | Two-stage match; uses `cleaner_city_allowed_society_ids`; returns explainable scores |
| Edge: route/detour calculator | Google Routes behind abstraction; no per-user spam |

## Unit 7 - Booking

| Name | Purpose |
|------|---------|
| `cleaner_city_request_ride(p_publication_id uuid)` | Guest request; seat hold |
| `cleaner_city_respond_ride_request(p_request_id uuid, p_accept boolean)` | Host accept/reject |
| `cleaner_city_cancel_ride(p_ride_id uuid, p_reason text)` | Either party cancel with audit |

## Unit 8 - Lifecycle and OTP

| Name | Purpose |
|------|---------|
| `cleaner_city_generate_ride_otp(p_ride_id uuid)` | Unique OTP; attempt limits |
| `cleaner_city_start_ride(p_ride_id uuid, p_otp text)` | Server validates OTP; records start |
| `cleaner_city_complete_ride(p_ride_id uuid)` | Host end; guest confirm / dispute path |
| `cleaner_city_append_ride_event(...)` | Internal immutable event writer |

## Units 9-11 - Tracking, ratings, cost share

| Name | Purpose |
|------|---------|
| `cleaner_city_upsert_ride_location(...)` | Active-ride-only location writes |
| `cleaner_city_report_incident(...)` | SOS / incident |
| `cleaner_city_submit_rating(...)` | Mutual ratings for participants only |
| `cleaner_city_propose_cost_share(...)` | Fuel share proposal (ledger) |
| `cleaner_city_confirm_cost_share(...)` | Confirm; settlement deferred to legal-approved Unit 11 flow |

## Notifications

Use existing `notification_queue` with dedicated types (e.g. `cleaner_city_ride_request`, `cleaner_city_ride_update`). Prefer idempotency keys. Audience for marketing blasts remains all valid device tokens when used; ride ops notify participants only.

## Authorization rules (all units)

- Caller must be authenticated.
- Society membership via `get_user_society_id`.
- Feature gate: `can_access_feature(society_id, 'cleaner_city')`.
- Work-email verified before publish/book (Unit 2+).
- Cross-society reads only through match RPCs using `cleaner_city_allowed_society_ids`, never broad table SELECT of private office locations.
