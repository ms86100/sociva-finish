CREATE OR REPLACE FUNCTION public.sync_order_to_delivery_assignment()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF OLD.status IS NOT DISTINCT FROM NEW.status THEN RETURN NEW; END IF;
  IF COALESCE(NEW.delivery_handled_by, 'seller') = 'platform' THEN RETURN NEW; END IF;
  IF NEW.status::text IN ('on_the_way', 'delivered') THEN
    UPDATE public.delivery_assignments
    SET status = NEW.status::text,
        updated_at = now(),
        delivered_at = CASE WHEN NEW.status::text = 'delivered' THEN now() ELSE delivered_at END,
        otp_verified = CASE WHEN NEW.status::text = 'delivered' THEN true ELSE otp_verified END
    WHERE order_id = NEW.id;
  END IF;
  RETURN NEW;
END;
$function$;