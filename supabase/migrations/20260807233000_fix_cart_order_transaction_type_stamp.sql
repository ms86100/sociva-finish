-- Fix cart order workflow stamp drift:
-- add_to_cart was always stamping cart_purchase via action_type_workflow_map,
-- ignoring fulfillment / delivery_handled_by. Seller-delivery orders then loaded
-- the platform cart_purchase machine; UI offered delivery-actor ready→picked_up
-- and seller_advance_order rejected it.
--
-- Intended stamp (restore 20260403164346):
--   self_pickup              → self_fulfillment
--   delivery + seller        → seller_delivery
--   delivery + platform      → cart_purchase
-- action_type_workflow_map remains the checkout_mode/CTA baseline only.

CREATE OR REPLACE FUNCTION public.resolve_cart_order_transaction_type(
  p_fulfillment_type text,
  p_delivery_handled_by text
)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path TO 'public'
AS $$
  SELECT CASE
    WHEN p_fulfillment_type = 'self_pickup' THEN 'self_fulfillment'
    WHEN p_fulfillment_type = 'seller_delivery' THEN 'seller_delivery'
    WHEN p_fulfillment_type = 'delivery'
         AND COALESCE(p_delivery_handled_by, 'seller') = 'seller' THEN 'seller_delivery'
    WHEN p_fulfillment_type = 'delivery'
         AND p_delivery_handled_by = 'platform' THEN 'cart_purchase'
    ELSE 'cart_purchase'
  END;
$$;

COMMENT ON FUNCTION public.resolve_cart_order_transaction_type(text, text) IS
  'Fulfillment-aware cart checkout workflow key (self_fulfillment / seller_delivery / cart_purchase).';

CREATE OR REPLACE FUNCTION public.heal_order_transaction_type(
  p_stored text,
  p_fulfillment_type text,
  p_delivery_handled_by text
)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path TO 'public'
AS $$
  SELECT CASE
    WHEN p_stored IS NULL THEN
      public.resolve_cart_order_transaction_type(p_fulfillment_type, p_delivery_handled_by)
    WHEN p_stored = 'cart_purchase'
         AND p_fulfillment_type = 'self_pickup' THEN 'self_fulfillment'
    WHEN p_stored = 'cart_purchase'
         AND p_fulfillment_type IN ('delivery', 'seller_delivery')
         AND COALESCE(p_delivery_handled_by, 'seller') = 'seller' THEN 'seller_delivery'
    ELSE p_stored
  END;
$$;

COMMENT ON FUNCTION public.heal_order_transaction_type(text, text, text) IS
  'Corrects known-wrong cart_purchase stamps for seller-delivery / self-pickup orders.';

-- ---------------------------------------------------------------------------
-- Backfill wrong stamps (transaction_type only — never mutates status).
-- Prefer shared prefix (placed/accepted/preparing/ready/…). Mid-transit and
-- terminal rows also get stamp-only heal so remaining edges / display match;
-- status is left unchanged so in-flight courier state is not rewritten.
-- Platform delivery (delivery_handled_by=platform) stays cart_purchase.
-- ---------------------------------------------------------------------------
UPDATE public.orders o
SET transaction_type = public.heal_order_transaction_type(
      o.transaction_type,
      o.fulfillment_type,
      o.delivery_handled_by
    ),
    updated_at = now()
WHERE o.order_type = 'purchase'
  AND o.transaction_type IS DISTINCT FROM public.heal_order_transaction_type(
        o.transaction_type,
        o.fulfillment_type,
        o.delivery_handled_by
      );

