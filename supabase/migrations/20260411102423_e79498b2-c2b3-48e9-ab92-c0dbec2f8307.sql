CREATE OR REPLACE FUNCTION public.validate_and_normalize_payment_record()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.payment_collection IS NULL
     OR NEW.payment_collection IN ('direct', 'platform', 'seller_direct', 'cod_only') THEN
    IF COALESCE(NEW.payment_method, '') = 'cod'
       OR COALESCE(NEW.payment_mode, '') = 'cod' THEN
      NEW.payment_collection := 'doorstep';
    ELSE
      NEW.payment_collection := 'online';
    END IF;
  END IF;

  IF NEW.payment_mode IS NULL
     OR NEW.payment_mode IN ('offline', 'online') THEN
    IF COALESCE(NEW.payment_method, '') = 'cod'
       OR NEW.payment_collection = 'doorstep' THEN
      NEW.payment_mode := 'cod';
    ELSIF COALESCE(NEW.payment_method, '') IN ('upi', 'card', 'wallet', 'razorpay') THEN
      NEW.payment_mode := NEW.payment_method;
    ELSIF NEW.razorpay_payment_id IS NOT NULL THEN
      NEW.payment_mode := 'razorpay';
    ELSE
      NEW.payment_mode := 'online';
    END IF;
  END IF;

  IF NEW.payment_collection NOT IN ('online', 'doorstep') THEN
    RAISE EXCEPTION 'Invalid payment_collection';
  END IF;

  IF NEW.payment_mode NOT IN ('cod', 'online', 'upi', 'card', 'wallet', 'razorpay') THEN
    RAISE EXCEPTION 'Invalid payment_mode';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_validate_payment_collection ON public.payment_records;
DROP TRIGGER IF EXISTS trg_validate_payment_mode ON public.payment_records;
DROP TRIGGER IF EXISTS trg_validate_payment_record_fields ON public.payment_records;

CREATE TRIGGER trg_validate_payment_record_fields
BEFORE INSERT OR UPDATE ON public.payment_records
FOR EACH ROW
EXECUTE FUNCTION public.validate_and_normalize_payment_record();

ALTER TABLE public.payment_records
  ALTER COLUMN payment_collection SET DEFAULT 'online',
  ALTER COLUMN payment_mode SET DEFAULT 'online';

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

  UPDATE public.orders
  SET payment_status = 'paid',
      payment_confirmed_at = COALESCE(payment_confirmed_at, now()),
      payment_confirmed_by_seller = true,
      updated_at = now()
  WHERE id = _order_id;

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
    'doorstep',
    'cod',
    v_order.society_id
  )
  ON CONFLICT (order_id) DO UPDATE
  SET buyer_id = EXCLUDED.buyer_id,
      seller_id = EXCLUDED.seller_id,
      amount = EXCLUDED.amount,
      payment_method = 'cod',
      payment_status = 'paid',
      platform_fee = COALESCE(public.payment_records.platform_fee, 0),
      net_amount = EXCLUDED.net_amount,
      payment_collection = 'doorstep',
      payment_mode = 'cod',
      society_id = COALESCE(public.payment_records.society_id, EXCLUDED.society_id),
      updated_at = now();
END;
$$;

CREATE OR REPLACE FUNCTION public.fn_populate_payment_record()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_payment_collection text;
  v_payment_mode text;
BEGIN
  IF NEW.payment_status IS DISTINCT FROM OLD.payment_status
     AND NEW.payment_status IN ('buyer_confirmed', 'paid', 'completed', 'seller_verified')
  THEN
    v_payment_collection := CASE
      WHEN COALESCE(NEW.payment_type, 'cod') = 'cod' THEN 'doorstep'
      ELSE 'online'
    END;

    v_payment_mode := CASE
      WHEN COALESCE(NEW.payment_type, 'cod') = 'cod' THEN 'cod'
      WHEN NEW.payment_type IN ('upi', 'card', 'wallet', 'razorpay') THEN NEW.payment_type
      WHEN NEW.razorpay_payment_id IS NOT NULL THEN 'razorpay'
      ELSE 'online'
    END;

    INSERT INTO public.payment_records (
      order_id,
      buyer_id,
      seller_id,
      amount,
      payment_method,
      payment_status,
      transaction_reference,
      society_id,
      payment_mode,
      payment_collection,
      razorpay_payment_id,
      idempotency_key
    ) VALUES (
      NEW.id,
      NEW.buyer_id,
      NEW.seller_id,
      NEW.total_amount,
      COALESCE(NEW.payment_type, 'cod'),
      NEW.payment_status,
      NEW.razorpay_payment_id,
      NEW.society_id,
      v_payment_mode,
      v_payment_collection,
      NEW.razorpay_payment_id,
      'pay_' || NEW.id || '_' || NEW.payment_status
    )
    ON CONFLICT (order_id) DO UPDATE SET
      buyer_id = EXCLUDED.buyer_id,
      seller_id = EXCLUDED.seller_id,
      amount = EXCLUDED.amount,
      payment_method = EXCLUDED.payment_method,
      payment_status = EXCLUDED.payment_status,
      transaction_reference = COALESCE(EXCLUDED.transaction_reference, public.payment_records.transaction_reference),
      society_id = COALESCE(public.payment_records.society_id, EXCLUDED.society_id),
      payment_mode = EXCLUDED.payment_mode,
      payment_collection = EXCLUDED.payment_collection,
      razorpay_payment_id = COALESCE(EXCLUDED.razorpay_payment_id, public.payment_records.razorpay_payment_id),
      idempotency_key = EXCLUDED.idempotency_key,
      updated_at = now();
  END IF;

  IF NEW.payment_status IS DISTINCT FROM OLD.payment_status
     AND NEW.payment_status IN ('refund_initiated', 'refund_processing', 'refunded')
  THEN
    UPDATE public.payment_records
    SET payment_status = NEW.payment_status,
        updated_at = now()
    WHERE order_id = NEW.id;
  END IF;

  RETURN NEW;
END;
$$;