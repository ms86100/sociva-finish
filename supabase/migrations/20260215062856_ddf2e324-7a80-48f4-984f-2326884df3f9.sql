
ALTER TABLE public.seller_profiles
  ADD COLUMN IF NOT EXISTS fulfillment_mode text NOT NULL DEFAULT 'self_pickup',
  ADD COLUMN IF NOT EXISTS delivery_note text DEFAULT NULL;

-- Validation trigger
CREATE OR REPLACE FUNCTION public.validate_fulfillment_mode()
  RETURNS trigger
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public'
AS $$
BEGIN
  IF NEW.fulfillment_mode NOT IN ('self_pickup', 'delivery', 'both') THEN
    RAISE EXCEPTION 'Invalid fulfillment_mode: %. Must be self_pickup, delivery, or both', NEW.fulfillment_mode;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_validate_fulfillment_mode
  BEFORE INSERT OR UPDATE ON public.seller_profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.validate_fulfillment_mode();
