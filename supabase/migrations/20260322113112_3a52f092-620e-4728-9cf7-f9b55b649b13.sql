-- Fix: Skip transition validation for payment_pending → placed
-- payment_pending is a pre-flow state managed by RPCs, not the workflow engine
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

  -- payment_pending is a pre-flow state; transitions out of it are managed by RPCs
  IF OLD.status::text = 'payment_pending' THEN
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