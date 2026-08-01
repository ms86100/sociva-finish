
CREATE OR REPLACE FUNCTION public.buyer_cancel_pending_orders(_order_ids uuid[])
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _affected integer := 0;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  IF _order_ids IS NULL OR coalesce(array_length(_order_ids, 1), 0) = 0 THEN
    RETURN 0;
  END IF;

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
  RETURN _affected;
END;
$$;
