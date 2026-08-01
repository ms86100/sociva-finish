
-- Fix search_path on enforce_cart_stock_limit
CREATE OR REPLACE FUNCTION public.enforce_cart_stock_limit()
RETURNS TRIGGER LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE _stock integer;
BEGIN
  SELECT stock_quantity INTO _stock FROM public.products WHERE id = NEW.product_id;
  IF _stock IS NOT NULL AND NEW.quantity > _stock THEN
    NEW.quantity := _stock;
  END IF;
  IF NEW.quantity <= 0 THEN
    RETURN NULL;
  END IF;
  RETURN NEW;
END; $$;
