
-- Trigger function: when category_config.transaction_type changes,
-- bulk-update all products in that category with the derived action_type.
CREATE OR REPLACE FUNCTION propagate_category_transaction_type()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  _derived_action text;
  _affected_count int;
BEGIN
  -- Only act when transaction_type actually changed
  IF OLD.transaction_type IS DISTINCT FROM NEW.transaction_type THEN
    _derived_action := CASE NEW.transaction_type
      WHEN 'cart_purchase' THEN 'add_to_cart'
      WHEN 'buy_now' THEN 'buy_now'
      WHEN 'book_slot' THEN 'book'
      WHEN 'request_service' THEN 'request_service'
      WHEN 'request_quote' THEN 'request_quote'
      WHEN 'contact_only' THEN 'contact_seller'
      WHEN 'schedule_visit' THEN 'schedule_visit'
      ELSE 'add_to_cart'
    END;

    UPDATE products
    SET action_type = _derived_action
    WHERE category = NEW.category;

    GET DIAGNOSTICS _affected_count = ROW_COUNT;
    RAISE LOG 'propagate_category_transaction_type: updated % products in category "%" from "%" to "%"',
      _affected_count, NEW.category, OLD.transaction_type, NEW.transaction_type;
  END IF;

  RETURN NEW;
END;
$$;

-- Attach as AFTER UPDATE trigger on category_config
DROP TRIGGER IF EXISTS trg_propagate_category_transaction_type ON category_config;
CREATE TRIGGER trg_propagate_category_transaction_type
  AFTER UPDATE ON category_config
  FOR EACH ROW
  EXECUTE FUNCTION propagate_category_transaction_type();
