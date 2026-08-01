
-- Fix 1: Update confirm_cod_payment to use valid payment_collection and payment_mode values
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

  INSERT INTO public.payment_records (
    order_id, buyer_id, seller_id, amount, payment_method, payment_status,
    platform_fee, net_amount, payment_collection, payment_mode, society_id
  ) VALUES (
    v_order.id, v_order.buyer_id, v_order.seller_id, v_order.total_amount,
    'cod', 'paid', 0, v_order.total_amount,
    'doorstep', 'cod', v_order.society_id
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

-- Fix 2: Update fn_populate_payment_record to use valid payment_mode values
CREATE OR REPLACE FUNCTION public.fn_populate_payment_record()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.payment_status IS DISTINCT FROM OLD.payment_status
     AND NEW.payment_status IN ('buyer_confirmed', 'paid', 'completed', 'seller_verified')
  THEN
    INSERT INTO payment_records (
      order_id, buyer_id, seller_id, amount, payment_method, payment_status,
      transaction_reference, society_id, payment_mode, payment_collection,
      razorpay_payment_id, idempotency_key
    ) VALUES (
      NEW.id, NEW.buyer_id, NEW.seller_id, NEW.total_amount,
      COALESCE(NEW.payment_type, 'cod'), NEW.payment_status,
      NEW.razorpay_payment_id, NEW.society_id,
      CASE WHEN NEW.payment_type IN ('upi', 'card', 'razorpay') THEN 'upi' ELSE 'cod' END,
      CASE WHEN NEW.payment_type IN ('upi', 'card', 'razorpay') THEN 'online' ELSE 'doorstep' END,
      NEW.razorpay_payment_id,
      'pay_' || NEW.id || '_' || NEW.payment_status
    )
    ON CONFLICT (idempotency_key) DO UPDATE SET
      payment_status = EXCLUDED.payment_status,
      updated_at = now();
  END IF;

  IF NEW.payment_status IS DISTINCT FROM OLD.payment_status
     AND NEW.payment_status IN ('refund_initiated', 'refund_processing', 'refunded')
  THEN
    UPDATE payment_records
    SET payment_status = NEW.payment_status, updated_at = now()
    WHERE order_id = NEW.id;
  END IF;

  RETURN NEW;
END;
$$;

-- Fix 3: Also fix stale payment_records with invalid values
UPDATE public.payment_records SET payment_mode = 'cod' WHERE payment_mode = 'offline';
UPDATE public.payment_records SET payment_collection = 'doorstep' WHERE payment_collection = 'direct';
