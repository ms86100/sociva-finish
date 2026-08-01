-- Index for payment_records by seller (earnings page)
CREATE INDEX IF NOT EXISTS idx_payment_records_seller_created
ON payment_records(seller_id, created_at DESC);

-- Index for service_availability_schedules by seller (store-level only)
CREATE INDEX IF NOT EXISTS idx_service_schedules_seller_active
ON service_availability_schedules(seller_id, is_active) WHERE product_id IS NULL;

-- Refresh stats
ANALYZE payment_records;
ANALYZE service_listings;
ANALYZE service_availability_schedules;
ANALYZE coupons;