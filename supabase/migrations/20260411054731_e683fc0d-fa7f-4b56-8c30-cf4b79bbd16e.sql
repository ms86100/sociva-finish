CREATE OR REPLACE FUNCTION public.verify_seller_payment(
  _order_id uuid,
  _received boolean DEFAULT true
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _order record;
  _seller_user_id uuid;
BEGIN
  SELECT id, seller_id, payment_status
  INTO _order
  FROM orders
  WHERE id = _order_id
  FOR UPDATE;

  IF _order IS NULL THEN
    RAISE EXCEPTION 'Order not found';
  END IF;

  SELECT user_id INTO _seller_user_id
  FROM seller_profiles
  WHERE id = _order.seller_id;

  IF _seller_user_id IS NULL OR _seller_user_id != auth.uid() THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;

  IF _order.payment_status NOT IN ('pending', 'buyer_confirmed') THEN
    RAISE EXCEPTION 'No pending payment to verify for this order';
  END IF;

  UPDATE orders
  SET payment_status = CASE WHEN _received THEN 'paid' ELSE 'disputed' END,
      payment_confirmed_by_seller = _received,
      payment_confirmed_at = now(),
      updated_at = now()
  WHERE id = _order_id;
END;
$$;