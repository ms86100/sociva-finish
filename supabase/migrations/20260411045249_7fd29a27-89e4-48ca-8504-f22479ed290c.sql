
INSERT INTO delivery_assignments (order_id, society_id, status, rider_id, rider_name)
SELECT
  o.id,
  COALESCE(o.society_id, '00000000-0000-0000-0000-000000000000'),
  'assigned',
  o.seller_id,
  sp.business_name
FROM orders o
LEFT JOIN seller_profiles sp ON sp.id = o.seller_id
WHERE o.transaction_type = 'seller_delivery'
  AND o.delivery_handled_by = 'seller'
  AND o.status IN ('picked_up', 'on_the_way')
  AND NOT EXISTS (
    SELECT 1 FROM delivery_assignments da WHERE da.order_id = o.id
  );
