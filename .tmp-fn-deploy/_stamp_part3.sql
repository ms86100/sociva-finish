-- validate_order_status_transition: heal before EXISTS check; honor acting_as when set
CREATE OR REPLACE FUNCTION public.validate_order_status_transition()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  _raw_pg TEXT;
  _parent_group TEXT;
  _txn_type TEXT;
  _valid BOOLEAN;
  _listing_type TEXT;
  _acting_as TEXT;
BEGIN
  IF OLD.status IS NOT DISTINCT FROM NEW.status THEN RETURN NEW; END IF;
  IF OLD.status::text = 'payment_pending' THEN RETURN NEW; END IF;
  IF current_setting('app.otp_verified', true) = 'true' THEN RETURN NEW; END IF;
  IF current_setting('role', true) = 'service_role' THEN RETURN NEW; END IF;

  SELECT sp.primary_group INTO _raw_pg
  FROM public.seller_profiles sp WHERE sp.id = NEW.seller_id;

  _parent_group := resolve_transition_parent_group(_raw_pg);

  IF NEW.transaction_type IS NOT NULL THEN
    _txn_type := public.heal_order_transaction_type(
      NEW.transaction_type,
      NEW.fulfillment_type,
      NEW.delivery_handled_by
    );
  ELSE
    SELECT p.listing_type INTO _listing_type
    FROM public.order_items oi JOIN public.products p ON p.id = oi.product_id
    WHERE oi.order_id = NEW.id LIMIT 1;

    IF _listing_type = 'contact_only' THEN _txn_type := 'contact_enquiry';
    ELSIF NEW.order_type = 'enquiry' THEN
      IF _parent_group IN ('education_learning','events') THEN _txn_type := 'service_booking';
      ELSE _txn_type := 'request_service'; END IF;
    ELSIF NEW.order_type = 'booking' THEN _txn_type := 'service_booking';
    ELSIF NEW.fulfillment_type = 'self_pickup' THEN _txn_type := 'self_fulfillment';
    ELSIF NEW.fulfillment_type = 'seller_delivery' THEN _txn_type := 'seller_delivery';
    ELSIF NEW.fulfillment_type = 'delivery' AND COALESCE(NEW.delivery_handled_by,'seller') = 'seller' THEN
      _txn_type := 'seller_delivery';
    ELSIF NEW.fulfillment_type = 'delivery' AND NEW.delivery_handled_by = 'platform' THEN
      _txn_type := 'cart_purchase';
    ELSE _txn_type := 'self_fulfillment'; END IF;
  END IF;

  -- Persist healed stamp on the row being updated
  NEW.transaction_type := _txn_type;

  _acting_as := nullif(current_setting('app.acting_as', true), '');

  IF _acting_as IS NOT NULL THEN
    SELECT EXISTS (
      SELECT 1 FROM public.category_status_transitions
      WHERE parent_group = _parent_group AND transaction_type = _txn_type
        AND from_status = OLD.status::text AND to_status = NEW.status::text
        AND (allowed_actor = _acting_as OR position(_acting_as IN allowed_actor) > 0)
    ) INTO _valid;

    IF NOT _valid AND _parent_group != 'default' THEN
      SELECT EXISTS (
        SELECT 1 FROM public.category_status_transitions
        WHERE parent_group = 'default' AND transaction_type = _txn_type
          AND from_status = OLD.status::text AND to_status = NEW.status::text
          AND (allowed_actor = _acting_as OR position(_acting_as IN allowed_actor) > 0)
      ) INTO _valid;
    END IF;
  ELSE
    SELECT EXISTS (
      SELECT 1 FROM public.category_status_transitions
      WHERE parent_group = _parent_group AND transaction_type = _txn_type
        AND from_status = OLD.status::text AND to_status = NEW.status::text
    ) INTO _valid;

    IF NOT _valid AND _parent_group != 'default' THEN
      SELECT EXISTS (
        SELECT 1 FROM public.category_status_transitions
        WHERE parent_group = 'default' AND transaction_type = _txn_type
          AND from_status = OLD.status::text AND to_status = NEW.status::text
      ) INTO _valid;
    END IF;
  END IF;

  IF NOT _valid THEN
    RAISE EXCEPTION 'Invalid status transition from "%" to "%" (parent_group=%, txn_type=%, actor=%)',
      OLD.status, NEW.status, _parent_group, _txn_type, COALESCE(_acting_as, 'any');
  END IF;

  RETURN NEW;
END;
$function$;

