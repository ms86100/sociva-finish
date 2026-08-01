CREATE OR REPLACE FUNCTION public.sync_order_to_delivery_assignment()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  mapped_status text;
BEGIN
  IF OLD.status IS NOT DISTINCT FROM NEW.status THEN RETURN NEW; END IF;
  IF COALESCE(NEW.delivery_handled_by, 'seller') = 'platform' THEN RETURN NEW; END IF;

  -- Map order_status values to delivery_assignment allowed statuses
  mapped_status := CASE NEW.status::text
    WHEN 'on_the_way' THEN 'en_route'
    WHEN 'delivered'  THEN 'delivered'
    WHEN 'picked_up'  THEN 'picked_up'
    ELSE NULL
  END;

  IF mapped_status IS NULL THEN RETURN NEW; END IF;

  UPDATE public.delivery_assignments
  SET status = mapped_status,
      updated_at = now(),
      picked_up_at = CASE WHEN mapped_status = 'picked_up' AND picked_up_at IS NULL THEN now() ELSE picked_up_at END,
      delivered_at = CASE WHEN mapped_status = 'delivered' THEN now() ELSE delivered_at END,
      otp_verified = CASE WHEN mapped_status = 'delivered' THEN true ELSE otp_verified END
  WHERE order_id = NEW.id;

  RETURN NEW;
END;
$$;