ALTER TABLE public.order_items
ADD COLUMN IF NOT EXISTS subtotal numeric,
ADD COLUMN IF NOT EXISTS product_image text;

CREATE OR REPLACE FUNCTION public.fn_order_items_apply_snapshot_defaults()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _product_name text;
  _product_image text;
BEGIN
  IF NEW.product_id IS NOT NULL
     AND (
       NEW.product_name IS NULL
       OR btrim(COALESCE(NEW.product_name, '')) = ''
       OR NEW.product_image IS NULL
     ) THEN
    SELECT p.name, p.image_url
    INTO _product_name, _product_image
    FROM public.products p
    WHERE p.id = NEW.product_id;
  END IF;

  NEW.product_name := COALESCE(
    NULLIF(btrim(COALESCE(NEW.product_name, '')), ''),
    _product_name,
    'Unknown Product'
  );

  IF NEW.product_image IS NULL THEN
    NEW.product_image := _product_image;
  END IF;

  IF NEW.subtotal IS NULL
     AND NEW.quantity IS NOT NULL
     AND NEW.unit_price IS NOT NULL THEN
    NEW.subtotal := NEW.quantity * NEW.unit_price;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_order_items_apply_snapshot_defaults ON public.order_items;

CREATE TRIGGER trg_order_items_apply_snapshot_defaults
BEFORE INSERT OR UPDATE ON public.order_items
FOR EACH ROW
EXECUTE FUNCTION public.fn_order_items_apply_snapshot_defaults();