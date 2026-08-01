
-- Phase 1.1: Add transaction control columns to category_config
ALTER TABLE public.category_config
  ADD COLUMN IF NOT EXISTS transaction_type text NOT NULL DEFAULT 'cart_purchase',
  ADD COLUMN IF NOT EXISTS primary_button_label text NOT NULL DEFAULT 'Add to Cart',
  ADD COLUMN IF NOT EXISTS requires_price boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS requires_availability boolean NOT NULL DEFAULT false;

-- Phase 1.3a: Validate transaction_type values
CREATE OR REPLACE FUNCTION public.validate_transaction_type()
  RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
BEGIN
  IF NEW.transaction_type NOT IN (
    'cart_purchase', 'buy_now', 'book_slot',
    'request_service', 'request_quote', 'contact_only', 'schedule_visit'
  ) THEN
    RAISE EXCEPTION 'Invalid transaction_type: %. Must be one of: cart_purchase, buy_now, book_slot, request_service, request_quote, contact_only, schedule_visit', NEW.transaction_type;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_validate_transaction_type
  BEFORE INSERT OR UPDATE ON public.category_config
  FOR EACH ROW EXECUTE FUNCTION public.validate_transaction_type();

-- Phase 1.3b: Enforce cart insertion only for cart-eligible categories
CREATE OR REPLACE FUNCTION public.validate_cart_item_category()
  RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE
  _supports_cart boolean;
  _category text;
BEGIN
  -- Look up the product's category
  SELECT p.category INTO _category
  FROM products p WHERE p.id = NEW.product_id;

  IF _category IS NULL THEN
    RAISE EXCEPTION 'Product not found';
  END IF;

  -- Check if category supports cart
  SELECT cc.supports_cart INTO _supports_cart
  FROM category_config cc WHERE cc.category = _category;

  IF _supports_cart IS NOT TRUE THEN
    RAISE EXCEPTION 'This product category does not support cart purchases. Use the appropriate booking or enquiry flow instead.';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_validate_cart_item_category
  BEFORE INSERT ON public.cart_items
  FOR EACH ROW EXECUTE FUNCTION public.validate_cart_item_category();

-- Phase 1.3c: Enforce requires_price on products
CREATE OR REPLACE FUNCTION public.validate_product_price_requirement()
  RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE
  _requires_price boolean;
BEGIN
  SELECT cc.requires_price INTO _requires_price
  FROM category_config cc WHERE cc.category = NEW.category::text;

  IF _requires_price IS TRUE AND (NEW.price IS NULL OR NEW.price <= 0) THEN
    RAISE EXCEPTION 'Price is required for category "%"', NEW.category;
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_validate_product_price
  BEFORE INSERT OR UPDATE ON public.products
  FOR EACH ROW EXECUTE FUNCTION public.validate_product_price_requirement();
