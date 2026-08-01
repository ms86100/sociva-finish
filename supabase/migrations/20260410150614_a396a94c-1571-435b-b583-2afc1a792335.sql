CREATE OR REPLACE FUNCTION public.validate_order_status_transition()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE _valid boolean;
  _tx_type text;
BEGIN
  IF OLD.status IS NOT DISTINCT FROM NEW.status THEN RETURN NEW; END IF;

  -- Resolve transaction_type safely (single value)
  SELECT cc.transaction_type INTO _tx_type
  FROM category_config cc
  WHERE cc.category = (
    SELECT oi.category FROM order_items oi WHERE oi.order_id = NEW.id LIMIT 1
  )
  LIMIT 1;

  _tx_type := COALESCE(_tx_type, 'cart_purchase');

  -- Check transition validity with resolved transaction_type
  SELECT EXISTS (
    SELECT 1 FROM category_status_transitions
    WHERE from_status = OLD.status::text
      AND to_status = NEW.status::text
      AND transaction_type = _tx_type
  ) INTO _valid;

  -- Fallback: check without transaction_type filter
  IF NOT _valid THEN
    SELECT EXISTS (
      SELECT 1 FROM category_status_transitions
      WHERE from_status = OLD.status::text
        AND to_status = NEW.status::text
    ) INTO _valid;
  END IF;

  IF NOT _valid THEN
    RAISE EXCEPTION 'Invalid status transition from % to %',
      OLD.status, NEW.status;
  END IF;
  RETURN NEW;
END;
$function$;