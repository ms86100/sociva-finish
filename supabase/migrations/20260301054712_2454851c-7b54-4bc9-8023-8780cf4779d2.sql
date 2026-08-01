
-- P0 FIX 1: Add rider_id to delivery_assignments (references pool riders, NOT 3PL partners)
ALTER TABLE public.delivery_assignments 
  ADD COLUMN rider_id UUID REFERENCES public.delivery_partner_pool(id);

-- P0 FIX 2: Add user_id to delivery_partner_pool (links pool rider to auth user)
ALTER TABLE public.delivery_partner_pool 
  ADD COLUMN user_id UUID REFERENCES auth.users(id);

CREATE UNIQUE INDEX IF NOT EXISTS idx_delivery_partner_pool_user_id 
  ON public.delivery_partner_pool(user_id) WHERE user_id IS NOT NULL;

-- P1 FIX 3: Replace sync trigger with logging on silent failures + bypass flag
CREATE OR REPLACE FUNCTION public.sync_delivery_to_order_status()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  _rows_affected int;
BEGIN
  IF OLD.status IS NOT DISTINCT FROM NEW.status THEN
    RETURN NEW;
  END IF;

  -- Set flag so validation trigger allows delivery/system actor transitions
  PERFORM set_config('app.delivery_sync', 'true', true);

  _rows_affected := 0;

  CASE NEW.status
    WHEN 'picked_up' THEN
      UPDATE public.orders SET status = 'picked_up'
        WHERE id = NEW.order_id AND status = 'ready';
      GET DIAGNOSTICS _rows_affected = ROW_COUNT;
    WHEN 'at_gate' THEN
      UPDATE public.orders SET status = 'on_the_way'
        WHERE id = NEW.order_id AND status = 'picked_up';
      GET DIAGNOSTICS _rows_affected = ROW_COUNT;
    WHEN 'delivered' THEN
      UPDATE public.orders SET status = 'delivered'
        WHERE id = NEW.order_id AND status = 'on_the_way';
      GET DIAGNOSTICS _rows_affected = ROW_COUNT;
    ELSE
      _rows_affected := 1;
  END CASE;

  -- Log when sync fails (order was not at expected status)
  IF _rows_affected = 0 THEN
    RAISE WARNING 'sync_delivery_to_order_status: 0 rows updated for assignment=%, delivery_status=%, order_id=%',
      NEW.id, NEW.status, NEW.order_id;
    INSERT INTO public.delivery_tracking_logs (assignment_id, status, source, note)
      VALUES (NEW.id, NEW.status, 'system', 
        'Sync failed: order not at expected status for transition to ' || NEW.status);
  END IF;

  RETURN NEW;
END;
$$;

-- P1/P2 FIX 4: Replace validation trigger - use app.delivery_sync flag instead of role check
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

  SELECT p.category, p.transaction_type, cc.parent_group
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

  -- Backwards compatibility: if status not in flow config, allow
  IF _current_sort IS NULL OR _new_sort IS NULL THEN
    RETURN NEW;
  END IF;

  -- Enforce sequential transitions
  IF _new_sort != _current_sort + 1 THEN
    RAISE EXCEPTION 'Invalid status transition from % to % (sort % -> %)',
      OLD.status, NEW.status, _current_sort, _new_sort;
  END IF;

  -- Actor enforcement: delivery/system statuses blocked for regular users
  -- Allow if: (a) called from sync trigger via set_config flag, or (b) service_role session
  IF _new_actor IN ('delivery', 'system') THEN
    IF coalesce(current_setting('app.delivery_sync', true), '') != 'true'
       AND current_setting('role', true) != 'service_role' THEN
      RAISE EXCEPTION 'Status "%" can only be set by the delivery system, not directly', NEW.status;
    END IF;
  END IF;

  RETURN NEW;
END;
$$;
