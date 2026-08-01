
-- Migrate existing fulfillment_mode values
UPDATE public.seller_profiles SET fulfillment_mode = 'seller_delivery' WHERE fulfillment_mode = 'delivery';
UPDATE public.seller_profiles SET fulfillment_mode = 'pickup_and_seller_delivery' WHERE fulfillment_mode = 'both';

-- Backfill delivery_handled_by
UPDATE public.seller_profiles SET delivery_handled_by = 'seller'
  WHERE fulfillment_mode IN ('seller_delivery', 'pickup_and_seller_delivery');
UPDATE public.seller_profiles SET delivery_handled_by = 'platform'
  WHERE fulfillment_mode IN ('platform_delivery', 'pickup_and_platform_delivery');
UPDATE public.seller_profiles SET delivery_handled_by = NULL
  WHERE fulfillment_mode = 'self_pickup' OR fulfillment_mode IS NULL;

-- Create updated validation trigger
CREATE OR REPLACE FUNCTION public.validate_fulfillment_mode()
RETURNS trigger LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  IF NEW.fulfillment_mode NOT IN ('self_pickup', 'seller_delivery', 'platform_delivery', 'pickup_and_seller_delivery', 'pickup_and_platform_delivery') THEN
    RAISE EXCEPTION 'Invalid fulfillment_mode: %. Must be self_pickup, seller_delivery, platform_delivery, pickup_and_seller_delivery, or pickup_and_platform_delivery', NEW.fulfillment_mode;
  END IF;
  IF NEW.fulfillment_mode IN ('seller_delivery', 'pickup_and_seller_delivery') THEN
    NEW.delivery_handled_by := 'seller';
  ELSIF NEW.fulfillment_mode IN ('platform_delivery', 'pickup_and_platform_delivery') THEN
    NEW.delivery_handled_by := 'platform';
  ELSE
    NEW.delivery_handled_by := NULL;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_validate_fulfillment_mode
  BEFORE INSERT OR UPDATE OF fulfillment_mode ON public.seller_profiles
  FOR EACH ROW EXECUTE FUNCTION public.validate_fulfillment_mode();
