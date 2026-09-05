-- BUG-20: Seller cannot Reject unaccepted seller_delivery orders.
-- placed→cancelled existed for buyer + system only; UI canSellerReject requires
-- allowed_actor='seller'. Align with self_pickup / delivery / self_fulfillment.

BEGIN;

INSERT INTO public.category_status_transitions (
  parent_group, transaction_type, from_status, to_status, allowed_actor, is_side_action, display_label
)
SELECT v.parent_group, v.transaction_type, 'placed', 'cancelled', 'seller', true, 'Reject'
FROM (VALUES
  ('default', 'seller_delivery'),
  ('food_beverages', 'seller_delivery')
) AS v(parent_group, transaction_type)
WHERE NOT EXISTS (
  SELECT 1
  FROM public.category_status_transitions t
  WHERE t.parent_group = v.parent_group
    AND t.transaction_type = v.transaction_type
    AND t.from_status = 'placed'
    AND t.to_status = 'cancelled'
    AND t.allowed_actor = 'seller'
);

COMMIT;
