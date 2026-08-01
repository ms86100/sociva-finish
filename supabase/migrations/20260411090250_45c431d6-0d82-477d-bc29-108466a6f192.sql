
-- 1. Backfill missing delivery_assignments with valid status mapping
INSERT INTO delivery_assignments (order_id, society_id, delivery_fee, idempotency_key, rider_name, rider_phone, status, delivery_lat, delivery_lng, eta_minutes, delivery_code)
SELECT
  o.id,
  COALESCE(bp.society_id, o.society_id, sp.society_id),
  COALESCE(o.delivery_fee, 0),
  'backfill_' || o.id::text || '_' || extract(epoch from now())::text,
  sp.business_name,
  p.phone,
  CASE o.status::text
    WHEN 'picked_up' THEN 'picked_up'
    WHEN 'on_the_way' THEN 'en_route'
    WHEN 'at_gate' THEN 'en_route'
    WHEN 'delivered' THEN 'delivered'
    ELSE 'assigned'
  END,
  sp.latitude,
  sp.longitude,
  15,
  LPAD(FLOOR(RANDOM() * 10000)::TEXT, 4, '0')
FROM orders o
JOIN seller_profiles sp ON sp.id = o.seller_id
JOIN profiles p ON p.id = sp.user_id
LEFT JOIN profiles bp ON bp.id = o.buyer_id
WHERE o.fulfillment_type IN ('delivery', 'seller_delivery')
  AND COALESCE(o.delivery_handled_by, 'seller') = 'seller'
  AND o.status IN ('picked_up', 'on_the_way', 'at_gate', 'delivered')
  AND NOT EXISTS (SELECT 1 FROM delivery_assignments da WHERE da.order_id = o.id);

-- 2. Workflow cleanup: make delivered terminal, remove completed and payment_pending
UPDATE category_status_flows
SET is_terminal = true, is_success = true
WHERE transaction_type = 'seller_delivery'
  AND parent_group = 'food_beverages'
  AND status_key = 'delivered';

DELETE FROM category_status_flows
WHERE transaction_type = 'seller_delivery'
  AND parent_group = 'food_beverages'
  AND status_key IN ('completed', 'payment_pending');

DELETE FROM category_status_transitions
WHERE transaction_type = 'seller_delivery'
  AND parent_group = 'food_beverages'
  AND (from_status = 'delivered' AND to_status = 'completed');
