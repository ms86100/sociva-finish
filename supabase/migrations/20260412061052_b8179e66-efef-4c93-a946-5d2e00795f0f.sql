
-- Low stock alert + auto-pause trigger
CREATE OR REPLACE FUNCTION public.handle_low_stock_alert()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_seller_user_id uuid;
  v_society_id uuid;
BEGIN
  -- Only act when stock_quantity actually changed
  IF OLD.stock_quantity IS NOT DISTINCT FROM NEW.stock_quantity THEN
    RETURN NEW;
  END IF;

  -- Only act if stock_quantity and low_stock_threshold are set
  IF NEW.stock_quantity IS NULL OR NEW.low_stock_threshold IS NULL THEN
    RETURN NEW;
  END IF;

  -- Auto-pause at zero stock
  IF NEW.stock_quantity <= 0 AND NEW.is_available = true THEN
    NEW.is_available := false;
  END IF;

  -- Low stock notification (at or below threshold, but above zero)
  IF NEW.stock_quantity <= NEW.low_stock_threshold AND NEW.stock_quantity > 0
     AND (OLD.stock_quantity IS NULL OR OLD.stock_quantity > NEW.low_stock_threshold) THEN
    -- Get seller's user_id and society_id
    SELECT sp.user_id, sp.society_id
      INTO v_seller_user_id, v_society_id
      FROM seller_profiles sp
     WHERE sp.id = NEW.seller_id;

    IF v_seller_user_id IS NOT NULL THEN
      INSERT INTO notification_queue (user_id, title, body, type, action_url, society_id)
      VALUES (
        v_seller_user_id,
        'Low Stock Alert',
        format('%s has only %s left in stock', NEW.name, NEW.stock_quantity),
        'low_stock',
        '/seller/products',
        v_society_id
      );
    END IF;
  END IF;

  -- Zero stock notification
  IF NEW.stock_quantity <= 0 AND (OLD.stock_quantity IS NULL OR OLD.stock_quantity > 0) THEN
    SELECT sp.user_id, sp.society_id
      INTO v_seller_user_id, v_society_id
      FROM seller_profiles sp
     WHERE sp.id = NEW.seller_id;

    IF v_seller_user_id IS NOT NULL THEN
      INSERT INTO notification_queue (user_id, title, body, type, action_url, society_id)
      VALUES (
        v_seller_user_id,
        'Product Out of Stock',
        format('%s is now out of stock and has been paused automatically', NEW.name),
        'out_of_stock',
        '/seller/products',
        v_society_id
      );
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

-- Create the trigger
DROP TRIGGER IF EXISTS trg_low_stock_alert ON products;
CREATE TRIGGER trg_low_stock_alert
  BEFORE UPDATE ON products
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_low_stock_alert();
