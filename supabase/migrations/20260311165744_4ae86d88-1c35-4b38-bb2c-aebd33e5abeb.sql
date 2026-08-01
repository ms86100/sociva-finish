
-- RPC: Buyer confirms UPI payment and submits UTR
CREATE OR REPLACE FUNCTION public.confirm_upi_payment(
  _order_id uuid,
  _upi_transaction_ref text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  _order record;
BEGIN
  -- Validate UTR
  IF _upi_transaction_ref IS NULL OR length(trim(_upi_transaction_ref)) < 6 THEN
    RAISE EXCEPTION 'Invalid transaction reference';
  END IF;

  -- Fetch order and verify ownership
  SELECT id, buyer_id, status, payment_status
  INTO _order
  FROM public.orders
  WHERE id = _order_id
  FOR UPDATE;

  IF _order IS NULL THEN
    RAISE EXCEPTION 'Order not found';
  END IF;

  IF _order.buyer_id != auth.uid() THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;

  IF _order.status NOT IN ('placed', 'accepted') THEN
    RAISE EXCEPTION 'Order is not in a payable state';
  END IF;

  IF _order.payment_status NOT IN ('pending') THEN
    RAISE EXCEPTION 'Payment already processed';
  END IF;

  -- Update only the allowed fields
  UPDATE public.orders
  SET upi_transaction_ref = trim(_upi_transaction_ref),
      payment_status = 'buyer_confirmed',
      updated_at = now()
  WHERE id = _order_id;
END;
$$;

-- RPC: Seller verifies UPI payment
CREATE OR REPLACE FUNCTION public.verify_seller_payment(
  _order_id uuid,
  _received boolean
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  _order record;
  _seller_user_id uuid;
BEGIN
  -- Fetch order
  SELECT id, seller_id, payment_status
  INTO _order
  FROM public.orders
  WHERE id = _order_id
  FOR UPDATE;

  IF _order IS NULL THEN
    RAISE EXCEPTION 'Order not found';
  END IF;

  -- Verify caller is the seller
  SELECT user_id INTO _seller_user_id
  FROM public.seller_profiles
  WHERE id = _order.seller_id;

  IF _seller_user_id IS NULL OR _seller_user_id != auth.uid() THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;

  IF _order.payment_status != 'buyer_confirmed' THEN
    RAISE EXCEPTION 'No pending payment confirmation for this order';
  END IF;

  -- Update payment verification
  UPDATE public.orders
  SET payment_status = CASE WHEN _received THEN 'paid' ELSE 'disputed' END,
      payment_confirmed_by_seller = _received,
      payment_confirmed_at = now(),
      updated_at = now()
  WHERE id = _order_id;
END;
$$;
