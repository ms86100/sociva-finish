
-- Clean up duplicate seller-level schedules (keep the newest)
DELETE FROM public.service_availability_schedules a
USING public.service_availability_schedules b
WHERE a.seller_id = b.seller_id
  AND a.day_of_week = b.day_of_week
  AND a.product_id IS NULL
  AND b.product_id IS NULL
  AND a.created_at < b.created_at;

-- Clean up duplicate product-level schedules (keep the newest)
DELETE FROM public.service_availability_schedules a
USING public.service_availability_schedules b
WHERE a.seller_id = b.seller_id
  AND a.product_id = b.product_id
  AND a.day_of_week = b.day_of_week
  AND a.product_id IS NOT NULL
  AND a.created_at < b.created_at;

-- Now create partial unique indexes
CREATE UNIQUE INDEX IF NOT EXISTS uq_service_availability_seller_day_null_product
  ON public.service_availability_schedules (seller_id, day_of_week)
  WHERE product_id IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_service_availability_seller_product_day_notnull
  ON public.service_availability_schedules (seller_id, product_id, day_of_week)
  WHERE product_id IS NOT NULL;
