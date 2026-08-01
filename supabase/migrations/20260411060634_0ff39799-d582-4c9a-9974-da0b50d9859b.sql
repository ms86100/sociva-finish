CREATE OR REPLACE FUNCTION public.confirm_cod_payment(_order_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_order RECORD;
BEGIN
  SELECT o.id, o.seller_id, o.payment_type, o.payment_status
  INTO v_order
  FROM public.orders o
  WHERE o.id = _order_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Order not found';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.seller_profiles sp
    WHERE sp.id = v_order.seller_id
      AND sp.user_id = auth.uid()
  ) THEN
    RAISE EXCEPTION 'Only the seller can confirm COD payment';
  END IF;

  IF COALESCE(v_order.payment_type, '') <> 'cod' THEN
    RAISE EXCEPTION 'This order is not a COD order';
  END IF;

  IF v_order.payment_status = 'paid' THEN
    RETURN;
  END IF;

  UPDATE public.orders
  SET payment_status = 'paid',
      payment_confirmed_at = now(),
      payment_confirmed_by_seller = true,
      updated_at = now()
  WHERE id = _order_id;
END;
$$;