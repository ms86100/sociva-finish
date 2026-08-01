
-- Alert seller when stock drops below threshold
CREATE OR REPLACE FUNCTION public.fn_alert_seller_low_stock()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _threshold integer;
  _seller_user_id uuid;
BEGIN
  -- Only if stock actually decreased
  IF NEW.stock_quantity IS NULL OR OLD.stock_quantity IS NULL THEN RETURN NEW; END IF;
  IF NEW.stock_quantity >= OLD.stock_quantity THEN RETURN NEW; END IF;
  
  -- Get threshold: product-level or seller-level default
  _threshold := COALESCE(
    NEW.low_stock_threshold,
    (SELECT low_stock_alert_threshold FROM seller_profiles WHERE id = NEW.seller_id),
    5
  );
  
  -- Only alert if crossed the threshold (was above, now at or below)
  IF OLD.stock_quantity > _threshold AND NEW.stock_quantity <= _threshold AND NEW.stock_quantity > 0 THEN
    SELECT user_id INTO _seller_user_id FROM seller_profiles WHERE id = NEW.seller_id;
    
    IF _seller_user_id IS NOT NULL THEN
      INSERT INTO notification_queue (user_id, title, body, type, reference_path, payload)
      VALUES (
        _seller_user_id,
        '⚠️ Low Stock Alert',
        NEW.name || ' has only ' || NEW.stock_quantity || ' left. Restock soon!',
        'low_stock',
        '/seller/products',
        jsonb_build_object('product_id', NEW.id, 'stock_quantity', NEW.stock_quantity, 'threshold', _threshold)
      );
    END IF;
  END IF;
  
  -- Also alert when stock hits 0
  IF NEW.stock_quantity = 0 AND OLD.stock_quantity > 0 THEN
    SELECT user_id INTO _seller_user_id FROM seller_profiles WHERE id = NEW.seller_id;
    
    IF _seller_user_id IS NOT NULL THEN
      INSERT INTO notification_queue (user_id, title, body, type, reference_path, payload)
      VALUES (
        _seller_user_id,
        '🚨 Out of Stock',
        NEW.name || ' is now out of stock and hidden from buyers.',
        'out_of_stock',
        '/seller/products',
        jsonb_build_object('product_id', NEW.id)
      );
    END IF;
  END IF;
  
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_alert_seller_low_stock ON public.products;
CREATE TRIGGER trg_alert_seller_low_stock
  AFTER UPDATE OF stock_quantity ON public.products
  FOR EACH ROW
  EXECUTE FUNCTION fn_alert_seller_low_stock();
