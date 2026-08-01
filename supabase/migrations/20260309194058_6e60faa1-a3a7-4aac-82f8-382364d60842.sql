
-- Add unique constraint on service_availability_schedules for upsert
ALTER TABLE public.service_availability_schedules
  ADD CONSTRAINT uq_service_availability_seller_product_day
  UNIQUE (seller_id, product_id, day_of_week);

-- Add unique constraint on service_slots for upsert
ALTER TABLE public.service_slots
  ADD CONSTRAINT uq_service_slots_seller_product_date_time
  UNIQUE (seller_id, product_id, slot_date, start_time);
