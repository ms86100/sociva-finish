CREATE OR REPLACE FUNCTION public.validate_order_status_transition()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE _valid boolean;
BEGIN
  IF OLD.status IS NOT DISTINCT FROM NEW.status THEN RETURN NEW; END IF;

  SELECT EXISTS (
    SELECT 1 FROM category_status_transitions
    WHERE from_status = OLD.status::text
      AND to_status = NEW.status::text
      AND transaction_type = COALESCE(
        (SELECT transaction_type FROM category_config
         WHERE category = (SELECT category FROM order_items
                           WHERE order_id = NEW.id LIMIT 1)),
        'cart_purchase')
  ) INTO _valid;

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