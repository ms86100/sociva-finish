
-- Fix: restore_stock_on_order_cancel references 'refunded' which is NOT in the order_status enum.
-- This causes EVERY order status update to fail with:
--   "invalid input value for enum order_status: 'refunded'"
-- Fix: remove 'refunded' from the check since it doesn't exist as a valid status.

CREATE OR REPLACE FUNCTION public.restore_stock_on_order_cancel()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF NEW.status = 'cancelled'
     AND OLD.status != 'cancelled' THEN
    UPDATE products
    SET
      stock_quantity = stock_quantity + oi.quantity,
      is_available = CASE
        WHEN stock_quantity IS NOT NULL AND stock_quantity + oi.quantity > 0 THEN true
        ELSE is_available
      END
    FROM order_items oi
    WHERE oi.order_id = NEW.id
      AND oi.product_id = products.id
      AND products.stock_quantity IS NOT NULL;
  END IF;
  RETURN NEW;
END;
$$;
