CREATE OR REPLACE FUNCTION public.auto_create_parcel_on_delivery()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  _buyer_id uuid;
  _buyer_flat text;
  _seller_name text;
  _resolved_society_id uuid;
  _existing_parcel_id uuid;
BEGIN
  IF OLD.status IS NOT DISTINCT FROM NEW.status THEN
    RETURN NEW;
  END IF;

  IF NEW.status != 'delivered' THEN
    RETURN NEW;
  END IF;

  SELECT o.buyer_id, o.society_id, sp.business_name, sp.society_id
    INTO _buyer_id, _resolved_society_id, _seller_name, _resolved_society_id
  FROM public.orders o
  LEFT JOIN public.seller_profiles sp ON sp.id = o.seller_id
  WHERE o.id = NEW.order_id;

  SELECT p.flat_number, COALESCE(NEW.society_id, _resolved_society_id, p.society_id)
    INTO _buyer_flat, _resolved_society_id
  FROM public.profiles p
  WHERE p.id = _buyer_id;

  _resolved_society_id := COALESCE(NEW.society_id, _resolved_society_id);

  IF _buyer_id IS NULL THEN
    RAISE WARNING 'auto_create_parcel_on_delivery: missing buyer for order %', NEW.order_id;
    RETURN NEW;
  END IF;

  IF _resolved_society_id IS NULL THEN
    RAISE WARNING 'auto_create_parcel_on_delivery: skipping parcel creation for order % because society_id could not be resolved', NEW.order_id;
    RETURN NEW;
  END IF;

  SELECT pe.id
    INTO _existing_parcel_id
  FROM public.parcel_entries pe
  WHERE pe.resident_id = _buyer_id
    AND pe.description = 'Order #' || LEFT(NEW.order_id::text, 8)
  ORDER BY pe.created_at DESC
  LIMIT 1;

  IF _existing_parcel_id IS NOT NULL THEN
    RETURN NEW;
  END IF;

  INSERT INTO public.parcel_entries (
    society_id,
    resident_id,
    flat_number,
    courier_name,
    description,
    status
  )
  VALUES (
    _resolved_society_id,
    _buyer_id,
    _buyer_flat,
    COALESCE(_seller_name, 'Sociva Order'),
    'Order #' || LEFT(NEW.order_id::text, 8),
    'received'
  );

  RETURN NEW;
END;
$function$;