
-- ============================================================
-- Fix 1: Recreate validate_order_status_transition trigger
-- Change 'book_slot' → 'service_booking' for classes/events
-- ============================================================
CREATE OR REPLACE FUNCTION public.validate_order_status_transition()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $function$
DECLARE
  _parent_group text;
  _txn_type text;
  _valid boolean;
BEGIN
  IF OLD.status IS NOT DISTINCT FROM NEW.status THEN
    RETURN NEW;
  END IF;
  IF NEW.status::text = 'cancelled' THEN
    IF current_setting('role', true) = 'service_role' THEN
      RETURN NEW;
    END IF;
  END IF;
  SELECT sp.primary_group INTO _parent_group
  FROM public.seller_profiles sp
  WHERE sp.id = NEW.seller_id;

  IF NEW.order_type = 'enquiry' THEN
    IF _parent_group IN ('classes', 'events') THEN _txn_type := 'service_booking';
    ELSE _txn_type := 'request_service'; END IF;
  ELSIF NEW.order_type = 'booking' THEN _txn_type := 'service_booking';
  ELSIF NEW.fulfillment_type IN ('self_pickup') THEN _txn_type := 'self_fulfillment';
  ELSIF NEW.fulfillment_type = 'delivery' AND COALESCE(NEW.delivery_handled_by, 'seller') = 'seller' THEN _txn_type := 'seller_delivery';
  ELSIF NEW.fulfillment_type = 'seller_delivery' THEN _txn_type := 'seller_delivery';
  ELSIF NEW.fulfillment_type = 'delivery' AND NEW.delivery_handled_by = 'platform' THEN _txn_type := 'cart_purchase';
  ELSE _txn_type := 'self_fulfillment'; END IF;

  SELECT EXISTS (
    SELECT 1 FROM public.category_status_transitions
    WHERE parent_group = COALESCE(_parent_group, 'default')
      AND transaction_type = _txn_type
      AND from_status = OLD.status::text
      AND to_status = NEW.status::text
  ) INTO _valid;

  IF NOT _valid AND _parent_group IS NOT NULL THEN
    SELECT EXISTS (
      SELECT 1 FROM public.category_status_transitions
      WHERE parent_group = 'default'
        AND transaction_type = _txn_type
        AND from_status = OLD.status::text
        AND to_status = NEW.status::text
    ) INTO _valid;
  END IF;

  IF NOT _valid THEN
    RAISE EXCEPTION 'Invalid status transition from "%" to "%" for parent_group=% txn_type=%',
      OLD.status, NEW.status, COALESCE(_parent_group, 'default'), _txn_type;
  END IF;

  RETURN NEW;
END;
$function$;

-- ============================================================
-- Fix 2: Backfill delivery_handled_by for existing delivery orders
-- ============================================================
UPDATE public.orders
SET delivery_handled_by = 'seller'
WHERE fulfillment_type = 'delivery'
  AND delivery_handled_by IS NULL;

-- ============================================================
-- Fix 3: Seed food_beverages/self_fulfillment flows + transitions
-- ============================================================
INSERT INTO public.category_status_flows
  (parent_group, transaction_type, status_key, sort_order, actor, is_terminal, is_success, requires_otp, display_label, color, icon, buyer_hint, is_deprecated)
VALUES
  ('food_beverages', 'self_fulfillment', 'placed',    10, 'buyer',  false, true,  false, 'Placed',    'bg-blue-100 text-blue-700',      'ShoppingCart',  'Your order has been placed. Waiting for seller to accept.', false),
  ('food_beverages', 'self_fulfillment', 'accepted',  20, 'seller', false, true,  false, 'Accepted',  'bg-green-100 text-green-700',     'ThumbsUp',      'Your order has been accepted.',                             false),
  ('food_beverages', 'self_fulfillment', 'preparing', 30, 'seller', false, true,  false, 'Preparing', 'bg-yellow-100 text-yellow-700',   'ChefHat',       'Your order is being prepared.',                             false),
  ('food_beverages', 'self_fulfillment', 'ready',     40, 'seller', false, true,  false, 'Ready',     'bg-emerald-100 text-emerald-700', 'Package',       'Your order is ready for pickup!',                           false),
  ('food_beverages', 'self_fulfillment', 'completed', 50, 'seller', true,  true,  false, 'Completed', 'bg-green-100 text-green-800',     'CheckCircle2',  'Order completed. Leave a review!',                          false),
  ('food_beverages', 'self_fulfillment', 'cancelled', 60, 'admin',  true,  false, false, 'Cancelled', 'bg-red-100 text-red-700',         'XCircle',       'This order has been cancelled.',                             false)
ON CONFLICT DO NOTHING;

INSERT INTO public.category_status_transitions
  (parent_group, transaction_type, from_status, to_status, allowed_actor, is_side_action)
VALUES
  ('food_beverages', 'self_fulfillment', 'placed',    'accepted',  'seller', false),
  ('food_beverages', 'self_fulfillment', 'placed',    'cancelled', 'seller', false),
  ('food_beverages', 'self_fulfillment', 'placed',    'cancelled', 'buyer',  false),
  ('food_beverages', 'self_fulfillment', 'placed',    'cancelled', 'admin',  false),
  ('food_beverages', 'self_fulfillment', 'accepted',  'preparing', 'seller', false),
  ('food_beverages', 'self_fulfillment', 'accepted',  'cancelled', 'seller', false),
  ('food_beverages', 'self_fulfillment', 'accepted',  'cancelled', 'buyer',  false),
  ('food_beverages', 'self_fulfillment', 'accepted',  'cancelled', 'admin',  false),
  ('food_beverages', 'self_fulfillment', 'preparing', 'ready',     'seller', false),
  ('food_beverages', 'self_fulfillment', 'preparing', 'cancelled', 'admin',  false),
  ('food_beverages', 'self_fulfillment', 'ready',     'completed', 'seller', false),
  ('food_beverages', 'self_fulfillment', 'ready',     'completed', 'buyer',  false),
  ('food_beverages', 'self_fulfillment', 'ready',     'cancelled', 'admin',  false)
ON CONFLICT DO NOTHING;
