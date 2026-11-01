# Units 6-8 exit gate

## Unit 6 matching

- `cleaner_city_find_matches` - society scope via `cleaner_city_allowed_society_ids`
- Stage 1: seats, departure window, corridor distance
- Stage 2: detour minutes (haversine fallback); 5B not same-office-only
- UI: `/cleaner-city/find`

## Unit 7 booking

- `cleaner_city_request_ride` - atomic seat hold
- `cleaner_city_respond_ride_request` - accept/reject + release
- `cleaner_city_cancel_ride` - either party + audit event

## Unit 8 lifecycle

- `cleaner_city_generate_ride_otp` / `start_ride` / `complete_ride`
- Server-owned transitions; OTP attempt limits; immutable `ride_events`
