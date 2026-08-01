
-- Add action_type and contact_phone to products table
ALTER TABLE public.products
  ADD COLUMN IF NOT EXISTS action_type text NOT NULL DEFAULT 'add_to_cart',
  ADD COLUMN IF NOT EXISTS contact_phone text;

-- Validate action_type values
CREATE OR REPLACE FUNCTION public.validate_product_action_type()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  -- Validate action_type enum
  IF NEW.action_type NOT IN (
    'add_to_cart', 'buy_now', 'book', 'request_service',
    'request_quote', 'contact_seller', 'schedule_visit', 'make_offer'
  ) THEN
    RAISE EXCEPTION 'Invalid action_type: %. Must be one of: add_to_cart, buy_now, book, request_service, request_quote, contact_seller, schedule_visit, make_offer', NEW.action_type;
  END IF;

  -- If contact_seller, phone is mandatory
  IF NEW.action_type = 'contact_seller' AND (NEW.contact_phone IS NULL OR TRIM(NEW.contact_phone) = '') THEN
    RAISE EXCEPTION 'contact_phone is required when action_type is contact_seller';
  END IF;

  -- If add_to_cart or buy_now, price is required
  IF NEW.action_type IN ('add_to_cart', 'buy_now') AND (NEW.price IS NULL OR NEW.price <= 0) THEN
    RAISE EXCEPTION 'Price is required when action_type is % ', NEW.action_type;
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_validate_product_action_type
  BEFORE INSERT OR UPDATE ON public.products
  FOR EACH ROW
  EXECUTE FUNCTION public.validate_product_action_type();

-- Update cart validation to also check product-level action_type
CREATE OR REPLACE FUNCTION public.validate_cart_item_category()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  _supports_cart boolean;
  _category text;
  _action_type text;
BEGIN
  -- Look up product's category and action_type
  SELECT p.category, COALESCE(p.action_type, 'add_to_cart')
  INTO _category, _action_type
  FROM products p WHERE p.id = NEW.product_id;

  IF _category IS NULL THEN
    RAISE EXCEPTION 'Product not found';
  END IF;

  -- Product-level action_type overrides category behavior
  IF _action_type NOT IN ('add_to_cart', 'buy_now') THEN
    RAISE EXCEPTION 'This product does not support cart purchases. The seller has configured it for: %. Use the appropriate flow instead.', _action_type;
  END IF;

  -- Also check category-level supports_cart as a safety net
  SELECT cc.supports_cart INTO _supports_cart
  FROM category_config cc WHERE cc.category = _category;

  IF _supports_cart IS NOT TRUE AND _action_type = 'add_to_cart' THEN
    RAISE EXCEPTION 'This product category does not support cart purchases. Use the appropriate booking or enquiry flow instead.';
  END IF;

  RETURN NEW;
END;
$$;
