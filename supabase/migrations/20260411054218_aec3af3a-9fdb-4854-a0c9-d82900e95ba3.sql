CREATE OR REPLACE FUNCTION public.confirm_cod_payment(_order_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_order RECORD;
BEGIN
  SELECT o.id, o.buyer_id, o.seller_id, o.total_amount, o.payment_type, o.payment_status, o.society_id
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

  IF v_order.payment_type <> 'cod' THEN
    RAISE EXCEPTION 'This order is not a COD order';
  END IF;

  UPDATE public.orders
  SET payment_status = 'paid',
      payment_confirmed_at = now(),
      payment_confirmed_by_seller = true,
      updated_at = now()
  WHERE id = _order_id
    AND payment_status IS DISTINCT FROM 'paid';

  INSERT INTO public.payment_records (
    order_id,
    buyer_id,
    seller_id,
    amount,
    payment_method,
    payment_status,
    platform_fee,
    net_amount,
    payment_collection,
    payment_mode,
    society_id
  ) VALUES (
    v_order.id,
    v_order.buyer_id,
    v_order.seller_id,
    v_order.total_amount,
    'cod',
    'paid',
    0,
    v_order.total_amount,
    'direct',
    'offline',
    v_order.society_id
  )
  ON CONFLICT (order_id) DO UPDATE
  SET payment_status = 'paid',
      payment_method = 'cod',
      amount = EXCLUDED.amount,
      net_amount = COALESCE(public.payment_records.net_amount, EXCLUDED.net_amount),
      payment_collection = COALESCE(public.payment_records.payment_collection, EXCLUDED.payment_collection),
      payment_mode = COALESCE(public.payment_records.payment_mode, EXCLUDED.payment_mode),
      society_id = COALESCE(public.payment_records.society_id, EXCLUDED.society_id),
      updated_at = now();
END;
$$;