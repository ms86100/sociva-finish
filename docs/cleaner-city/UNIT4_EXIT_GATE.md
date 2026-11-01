# Unit 4 exit gate

## Shipped

- `cleaner_city_upsert_vehicle` - car/bike; bike seats exactly 1
- `cleaner_city_deactivate_vehicle` - cancels future open publications
- `vehicle_documents` + `cleaner_city_upsert_vehicle_document`
- `cleaner_city_publish_commute` / `cleaner_city_cancel_publication`
- UI: `/cleaner-city/vehicle`, `/cleaner-city/offer`

## Exit criteria

- No publish without verified work email + host/both role + active vehicle
- Seats cannot exceed vehicle capacity; bike max 1 passenger seat
- Invalid capacity rejected server-side
