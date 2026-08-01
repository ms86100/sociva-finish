
CREATE OR REPLACE FUNCTION public.sync_order_to_delivery_assignment()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF OLD.status IS NOT DISTINCT FROM NEW.status THEN
    RETURN NEW;
  END IF;

  -- Only sync for seller-handled delivery orders (NULL defaults to 'seller')
  IF COALESCE(NEW.delivery_handled_by, 'seller') = 'platform' THEN
    RETURN NEW;
  END IF;

  -- Sync relevant statuses to delivery_assignments
  IF NEW.status IN ('on_the_way', 'delivered') THEN
    UPDATE public.delivery_assignments
    SET status = NEW.status,
        updated_at = now(),
        delivered_at = CASE WHEN NEW.status = 'delivered' THEN now() ELSE delivered_at END
    WHERE order_id = NEW.id;
  END IF;

  RETURN NEW;
END;
$$;
