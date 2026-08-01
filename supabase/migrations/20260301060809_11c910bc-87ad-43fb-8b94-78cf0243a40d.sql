
-- Fix the trigger: replace p.transaction_type with cc.transaction_type
CREATE OR REPLACE FUNCTION public.validate_order_status_transition()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  _category text;
  _txn_type text;
  _parent_group text;
  _current_sort int;
  _new_sort int;
  _new_actor text;
BEGIN
  IF NEW.status = 'cancelled' THEN RETURN NEW; END IF;
  IF OLD.status IS NOT DISTINCT FROM NEW.status THEN RETURN NEW; END IF;

  SELECT p.category, cc.transaction_type, cc.parent_group
    INTO _category, _txn_type, _parent_group
    FROM public.products p
    JOIN public.category_config cc ON cc.category = p.category
    JOIN public.order_items oi ON oi.product_id = p.id
    WHERE oi.order_id = NEW.id
    LIMIT 1;

  SELECT sort_order INTO _current_sort
    FROM public.category_status_flows
    WHERE parent_group = _parent_group
      AND transaction_type = _txn_type
      AND status_key = OLD.status;

  SELECT sort_order, actor INTO _new_sort, _new_actor
    FROM public.category_status_flows
    WHERE parent_group = _parent_group
      AND transaction_type = _txn_type
      AND status_key = NEW.status;

  IF _current_sort IS NULL OR _new_sort IS NULL THEN
    RETURN NEW;
  END IF;

  IF _new_sort != _current_sort + 1 THEN
    RAISE EXCEPTION 'Invalid status transition from % to % (sort % -> %)',
      OLD.status, NEW.status, _current_sort, _new_sort;
  END IF;

  IF _new_actor IN ('delivery', 'system') THEN
    IF coalesce(current_setting('app.delivery_sync', true), '') != 'true'
       AND current_setting('role', true) != 'service_role' THEN
      RAISE EXCEPTION 'Status "%" can only be set by the delivery system, not directly', NEW.status;
    END IF;
  END IF;

  RETURN NEW;
END;
$$;
