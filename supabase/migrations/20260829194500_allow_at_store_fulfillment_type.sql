-- Allow at_store (UI location) as orders.fulfillment_type alongside at_seller.
CREATE OR REPLACE FUNCTION public.validate_order_fulfillment_type()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $function$
BEGIN
  IF NEW.fulfillment_type IS NOT NULL AND NEW.fulfillment_type NOT IN (
    'self_pickup', 'delivery', 'seller_delivery', 'digital',
    'at_seller', 'at_store', 'at_buyer', 'home_visit', 'online'
  ) THEN
    RAISE EXCEPTION 'Invalid fulfillment_type';
  END IF;
  RETURN NEW;
END;
$function$;
