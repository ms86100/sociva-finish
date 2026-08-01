-- Fix 2 (P0): Add status precondition to delivered sync case
-- Fix 3 (P1): Add actor enforcement to validate_order_status_transition

-- FIX 2: Replace sync_delivery_to_order_status to add AND status = 'on_the_way' on delivered case
CREATE OR REPLACE FUNCTION public.sync_delivery_to_order_status()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  IF OLD.status IS NOT DISTINCT FROM NEW.status THEN
    RETURN NEW;
  END IF;

  CASE NEW.status
    WHEN 'picked_up' THEN
      UPDATE public.orders SET status = 'picked_up'
        WHERE id = NEW.order_id AND status = 'ready';
    WHEN 'at_gate' THEN
      UPDATE public.orders SET status = 'on_the_way'
        WHERE id = NEW.order_id AND status = 'picked_up';
    WHEN 'delivered' THEN
      -- P0 FIX: Only sync if order is at on_the_way, preventing silent drift
      UPDATE public.orders SET status = 'delivered'
        WHERE id = NEW.order_id AND status = 'on_the_way';
    ELSE
      NULL;
  END CASE;

  RETURN NEW;
END;
$$;

-- FIX 3: Replace validate_order_status_transition to add actor enforcement
-- Delivery/system actor transitions blocked for non-service-role callers
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
  -- Allow cancellation from any state
  IF NEW.status = 'cancelled' THEN
    RETURN NEW;
  END IF;

  -- Skip if status hasn't changed
  IF OLD.status IS NOT DISTINCT FROM NEW.status THEN
    RETURN NEW;
  END IF;

  -- Get category and transaction type for this order
  SELECT p.category, p.transaction_type, cc.parent_group
    INTO _category, _txn_type, _parent_group
    FROM public.products p
    JOIN public.category_config cc ON cc.category = p.category
    JOIN public.order_items oi ON oi.product_id = p.id
    WHERE oi.order_id = NEW.id
    LIMIT 1;

  -- Look up sort orders
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

  -- Backwards compatibility: if status not in flow config, allow
  IF _current_sort IS NULL OR _new_sort IS NULL THEN
    RETURN NEW;
  END IF;

  -- Enforce sequential transitions
  IF _new_sort != _current_sort + 1 THEN
    RAISE EXCEPTION 'Invalid status transition from % to % (sort % -> %)',
      OLD.status, NEW.status, _current_sort, _new_sort;
  END IF;

  -- P1 FIX: Block delivery/system actor transitions from non-service-role callers
  -- Service role (used by triggers and edge functions) can transition any actor
  -- Regular authenticated users (sellers/buyers) cannot set delivery/system statuses
  IF _new_actor IN ('delivery', 'system') THEN
    IF current_setting('role', true) != 'service_role' THEN
      RAISE EXCEPTION 'Status % can only be set by the delivery system, not directly',
        NEW.status;
    END IF;
  END IF;

  RETURN NEW;
END;
$$;