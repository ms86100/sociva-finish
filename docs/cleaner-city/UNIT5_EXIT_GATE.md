# Unit 5 exit gate

## Shipped

- `cleaner_city_upsert_office_location` (owner-private)
- Publication route geometry columns + `cleaner_city_store_route_geometry`
- Haversine + detour estimate RPCs for matching fallback
- Client routing abstraction (`src/lib/cleaner-city/routing.ts`)
- UI: `/cleaner-city/route` pin picker + route preview

## Exit criteria

- Office pins remain owner-private via RLS
- Directions abstracted behind Google with haversine fallback
- Polylines encodable/cacheable on publications
