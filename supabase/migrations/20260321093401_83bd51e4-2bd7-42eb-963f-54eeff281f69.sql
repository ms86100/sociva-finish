
-- Bug 1: Decrement stock on order_items insert
CREATE OR REPLACE FUNCTION public.decrement_stock_on_order_item()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE products
  SET
    stock_quantity = GREATEST(stock_quantity - NEW.quantity, 0),
    is_available = CASE
      WHEN stock_quantity IS NOT NULL AND GREATEST(stock_quantity - NEW.quantity, 0) = 0 THEN false
      ELSE is_available
    END
  WHERE id = NEW.product_id
    AND stock_quantity IS NOT NULL;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_decrement_stock_on_order_item
  AFTER INSERT ON public.order_items
  FOR EACH ROW
  EXECUTE FUNCTION public.decrement_stock_on_order_item();

-- Bug 9: Restore stock when order is cancelled or refunded
CREATE OR REPLACE FUNCTION public.restore_stock_on_order_cancel()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.status IN ('cancelled', 'refunded')
     AND OLD.status NOT IN ('cancelled', 'refunded') THEN
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

CREATE TRIGGER trg_restore_stock_on_order_cancel
  AFTER UPDATE ON public.orders
  FOR EACH ROW
  EXECUTE FUNCTION public.restore_stock_on_order_cancel();
