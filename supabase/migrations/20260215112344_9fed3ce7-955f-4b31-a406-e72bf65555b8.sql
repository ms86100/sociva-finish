
-- Phase 1: Add marketplace-grade columns to products table
ALTER TABLE public.products
  ADD COLUMN IF NOT EXISTS mrp numeric,
  ADD COLUMN IF NOT EXISTS brand text,
  ADD COLUMN IF NOT EXISTS unit_type text,
  ADD COLUMN IF NOT EXISTS price_per_unit text,
  ADD COLUMN IF NOT EXISTS stock_quantity integer,
  ADD COLUMN IF NOT EXISTS secondary_images text[],
  ADD COLUMN IF NOT EXISTS bullet_features text[],
  ADD COLUMN IF NOT EXISTS specifications jsonb,
  ADD COLUMN IF NOT EXISTS ingredients text,
  ADD COLUMN IF NOT EXISTS serving_size text,
  ADD COLUMN IF NOT EXISTS spice_level text,
  ADD COLUMN IF NOT EXISTS cuisine_type text,
  ADD COLUMN IF NOT EXISTS warranty_period text,
  ADD COLUMN IF NOT EXISTS service_scope text,
  ADD COLUMN IF NOT EXISTS visit_charge numeric,
  ADD COLUMN IF NOT EXISTS minimum_charge numeric,
  ADD COLUMN IF NOT EXISTS delivery_time_text text,
  ADD COLUMN IF NOT EXISTS tags text[],
  ADD COLUMN IF NOT EXISTS discount_percentage numeric GENERATED ALWAYS AS (
    CASE WHEN mrp IS NOT NULL AND mrp > 0 AND price IS NOT NULL AND price < mrp
      THEN ROUND(((mrp - price) / mrp) * 100)
      ELSE NULL
    END
  ) STORED;

-- Validate spice_level values
CREATE OR REPLACE FUNCTION public.validate_product_spice_level()
  RETURNS trigger
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public'
AS $function$
BEGIN
  IF NEW.spice_level IS NOT NULL AND NEW.spice_level NOT IN ('mild', 'medium', 'hot', 'extra_hot') THEN
    RAISE EXCEPTION 'Invalid spice_level: %. Must be mild, medium, hot, or extra_hot', NEW.spice_level;
  END IF;
  RETURN NEW;
END;
$function$;

CREATE TRIGGER trg_validate_spice_level
  BEFORE INSERT OR UPDATE ON public.products
  FOR EACH ROW
  EXECUTE FUNCTION public.validate_product_spice_level();
