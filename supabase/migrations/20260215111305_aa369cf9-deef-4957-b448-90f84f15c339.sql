
-- Step 1: Map transaction_type to action_type values
-- transaction_type -> action_type mapping:
-- cart_purchase -> add_to_cart
-- buy_now -> buy_now
-- book_slot -> book
-- request_service -> request_service
-- request_quote -> request_quote
-- contact_only -> contact_seller
-- schedule_visit -> schedule_visit

-- Fix all existing products whose action_type doesn't match their category config
UPDATE products p
SET action_type = CASE cc.transaction_type
  WHEN 'cart_purchase' THEN 'add_to_cart'
  WHEN 'buy_now' THEN 'buy_now'
  WHEN 'book_slot' THEN 'book'
  WHEN 'request_service' THEN 'request_service'
  WHEN 'request_quote' THEN 'request_quote'
  WHEN 'contact_only' THEN 'contact_seller'
  WHEN 'schedule_visit' THEN 'schedule_visit'
  ELSE 'add_to_cart'
END
FROM category_config cc
WHERE cc.category = p.category::text
  AND p.action_type = 'add_to_cart'
  AND cc.supports_cart = false;

-- Step 2: Create trigger to auto-derive action_type from category_config on product insert/update
CREATE OR REPLACE FUNCTION public.sync_product_action_type()
  RETURNS trigger
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public'
AS $fn$
DECLARE
  _transaction_type text;
  _derived_action text;
BEGIN
  -- Look up category's transaction_type
  SELECT cc.transaction_type INTO _transaction_type
  FROM category_config cc WHERE cc.category = NEW.category::text;

  IF _transaction_type IS NOT NULL THEN
    _derived_action := CASE _transaction_type
      WHEN 'cart_purchase' THEN 'add_to_cart'
      WHEN 'buy_now' THEN 'buy_now'
      WHEN 'book_slot' THEN 'book'
      WHEN 'request_service' THEN 'request_service'
      WHEN 'request_quote' THEN 'request_quote'
      WHEN 'contact_only' THEN 'contact_seller'
      WHEN 'schedule_visit' THEN 'schedule_visit'
      ELSE 'add_to_cart'
    END;

    -- Always override to match category config
    NEW.action_type := _derived_action;
  END IF;

  RETURN NEW;
END;
$fn$;

-- Drop if exists to avoid duplicate
DROP TRIGGER IF EXISTS trg_sync_product_action_type ON products;

CREATE TRIGGER trg_sync_product_action_type
  BEFORE INSERT OR UPDATE OF category ON products
  FOR EACH ROW
  EXECUTE FUNCTION public.sync_product_action_type();
