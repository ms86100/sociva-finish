CREATE OR REPLACE FUNCTION public.confirm_cod_payment(_order_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE _order record;
BEGIN
  SELECT * INTO _order FROM orders WHERE id = _order_id;
  IF _order IS NULL THEN RAISE EXCEPTION 'Order not found'; END IF;
  IF NOT EXISTS (SELECT 1 FROM seller_profiles WHERE id = _order.seller_id AND user_id = auth.uid()) THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;
  IF _order.payment_type != 'cod' THEN RAISE EXCEPTION 'Not a COD order'; END IF;
  UPDATE orders SET payment_status = 'paid', payment_confirmed_at = now(), updated_at = now() WHERE id = _order_id;
  INSERT INTO payment_records (order_id, buyer_id, seller_id, amount, payment_method, status)
    VALUES (_order_id, _order.buyer_id, _order.seller_id, _order.total_amount, 'cod', 'completed')
    ON CONFLICT DO NOTHING;
END;
$$;