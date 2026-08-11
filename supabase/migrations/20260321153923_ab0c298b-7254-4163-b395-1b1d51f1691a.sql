
CREATE OR REPLACE FUNCTION public.buyer_cancel_pending_orders(_order_ids uuid[])
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _affected integer := 0;
  _order_record public.orders%ROWTYPE;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  IF _order_ids IS NULL OR coalesce(array_length(_order_ids, 1), 0) = 0 THEN
    RETURN 0;
  END IF;

  -- Cancel orders that are still payment_pending (not yet captured)
  UPDATE public.orders
  SET
    status = 'cancelled',
    rejection_reason = 'Order automatically cancelled — payment was not completed',
    updated_at = now(),
    auto_cancel_at = null
  WHERE id = ANY(_order_ids)
    AND buyer_id = auth.uid()
    AND payment_status = 'pending';

  GET DIAGNOSTICS _affected = ROW_COUNT;

  -- Restore stock for each cancelled order idempotently
  FOREACH order_id IN ARRAY _order_ids LOOP
    -- Get the order items for this order
    FOR item_record IN
      SELECT oi.id, oi.product_id, oi.quantity, oi.stock_restored
      FROM public.order_items oi
      WHERE oi.order_id = order_id
    LOOP
      -- Only restore stock if not already restored (idempotent)
      IF COALESCE(item_record.stock_restored, false) = false THEN
        UPDATE public.products p
        SET
          stock_quantity = p.stock_quantity + item_record.quantity,
          is_available = CASE
            WHEN p.stock_quantity + item_record.quantity > 0 THEN true
            ELSE p.is_available
          END
        WHERE id = item_record.product_id;

        UPDATE public.order_items oi
        SET stock_restored = true
        WHERE id = item_record.id;
      END IF;
    END LOOP;
  END LOOP;

  RETURN _affected;
END;
$$;
