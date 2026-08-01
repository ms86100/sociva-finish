-- 1. Enable delivery OTP on the 'delivered' step for seller_delivery
UPDATE category_status_flows
SET otp_type = 'delivery', requires_otp = true
WHERE transaction_type = 'seller_delivery'
  AND status_key = 'delivered';

-- 2. Backfill missing delivery assignment for the affected order
INSERT INTO delivery_assignments (
  order_id, society_id, status, rider_id, rider_name, rider_phone,
  delivery_code, delivery_fee,
  last_location_lat, last_location_lng,
  delivery_lat, delivery_lng
)
SELECT
  o.id,
  NULL,
  o.status,
  sp.user_id,
  sp.business_name,
  p.phone,
  LPAD(FLOOR(RANDOM() * 10000)::TEXT, 4, '0'),
  COALESCE(o.delivery_fee, 0),
  sp.latitude,
  sp.longitude,
  o.delivery_lat,
  o.delivery_lng
FROM orders o
JOIN seller_profiles sp ON sp.id = o.seller_id
JOIN profiles p ON p.id = sp.user_id
WHERE o.id = '7d164e3d-db00-43c6-a4fa-278299122180'
  AND NOT EXISTS (SELECT 1 FROM delivery_assignments da WHERE da.order_id = o.id);