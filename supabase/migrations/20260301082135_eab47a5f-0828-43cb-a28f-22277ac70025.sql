
-- C1: Restore stock when order is cancelled
-- This trigger increments stock_quantity for each order_item when the parent order transitions to 'cancelled'
CREATE OR REPLACE FUNCTION public.restore_stock_on_cancel()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  -- Only fire when status changes TO 'cancelled' from a non-cancelled status
  IF NEW.status = 'cancelled' AND (OLD.status IS DISTINCT FROM 'cancelled') THEN
    UPDATE products p
    SET stock_quantity = p.stock_quantity + oi.quantity,
        is_available = true
    FROM order_items oi
    WHERE oi.order_id = NEW.id
      AND oi.product_id = p.id
      AND p.stock_quantity IS NOT NULL;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_restore_stock_on_cancel ON orders;

CREATE TRIGGER trg_restore_stock_on_cancel
  AFTER UPDATE OF status ON orders
  FOR EACH ROW
  WHEN (NEW.status = 'cancelled' AND OLD.status IS DISTINCT FROM 'cancelled')
  EXECUTE FUNCTION public.restore_stock_on_cancel();
