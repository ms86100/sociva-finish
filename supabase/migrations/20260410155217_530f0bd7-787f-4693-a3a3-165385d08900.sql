CREATE OR REPLACE FUNCTION public.validate_order_status_transition()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  _parent_group text;
  _txn_type text;
  _valid boolean;
  _listing_type text;
BEGIN
  -- No-op if status unchanged
  IF OLD.status IS NOT DISTINCT FROM NEW.status THEN
    RETURN NEW;
  END IF;

  -- Allow transitions out of payment_pending (managed by RPCs)
  IF OLD.status::text = 'payment_pending' THEN
    RETURN NEW;
  END IF;

  -- OTP-verified delivery completion can skip intermediate steps
  IF current_setting('app.otp_verified', true) = 'true' THEN
    RETURN NEW;
  END IF;

  -- Service-role can always cancel
  IF NEW.status::text = 'cancelled' THEN
    IF current_setting('role', true) = 'service_role' THEN
      RETURN NEW;
    END IF;
  END IF;

  -- Resolve parent_group from seller_profiles
  SELECT sp.primary_group INTO _parent_group
  FROM public.seller_profiles sp
  WHERE sp.id = NEW.seller_id;

  -- Resolve listing_type from order_items -> products (for contact_only detection)
  SELECT p.listing_type INTO _listing_type
  FROM public.order_items oi
  JOIN public.products p ON p.id = oi.product_id
  WHERE oi.order_id = NEW.id
  LIMIT 1;

  -- Resolve transaction_type from order fields (NOT from order_items.category)
  IF _listing_type = 'contact_only' THEN
    _txn_type := 'contact_enquiry';
  ELSIF NEW.order_type = 'enquiry' THEN
    IF COALESCE(_parent_group, 'default') IN ('classes', 'events') THEN
      _txn_type := 'service_booking';
    ELSE
      _txn_type := 'request_service';
    END IF;
  ELSIF NEW.order_type = 'booking' THEN
    _txn_type := 'service_booking';
  ELSIF NEW.fulfillment_type = 'self_pickup' THEN
    _txn_type := 'self_fulfillment';
  ELSIF NEW.fulfillment_type = 'seller_delivery' THEN
    _txn_type := 'seller_delivery';
  ELSIF NEW.fulfillment_type = 'delivery' AND COALESCE(NEW.delivery_handled_by, 'seller') = 'seller' THEN
    _txn_type := 'seller_delivery';
  ELSIF NEW.fulfillment_type = 'delivery' AND NEW.delivery_handled_by = 'platform' THEN
    _txn_type := 'cart_purchase';
  ELSE
    _txn_type := 'self_fulfillment';
  END IF;

  -- Check transition validity with resolved parent_group + transaction_type
  SELECT EXISTS (
    SELECT 1 FROM public.category_status_transitions
    WHERE parent_group = COALESCE(_parent_group, 'default')
      AND transaction_type = _txn_type
      AND from_status = OLD.status::text
      AND to_status = NEW.status::text
  ) INTO _valid;

  -- Fallback to 'default' parent_group
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
    RAISE EXCEPTION 'Invalid status transition from "%" to "%" (parent_group=%, txn_type=%)',
      OLD.status, NEW.status, COALESCE(_parent_group, 'default'), _txn_type;
  END IF;

  RETURN NEW;
END;
$function$;