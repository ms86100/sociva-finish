CREATE OR REPLACE FUNCTION public.confirm_cod_payment(_order_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_order RECORD;
  v_existing_payment_record_id uuid;
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

  SELECT pr.id
  INTO v_existing_payment_record_id
  FROM public.payment_records pr
  WHERE pr.order_id = v_order.id
  ORDER BY pr.created_at ASC, pr.id ASC
  LIMIT 1
  FOR UPDATE;

  IF v_existing_payment_record_id IS NOT NULL THEN
    UPDATE public.payment_records
    SET buyer_id = v_order.buyer_id,
        seller_id = v_order.seller_id,
        amount = v_order.total_amount,
        payment_method = 'cod',
        payment_status = 'paid',
        platform_fee = COALESCE(platform_fee, 0),
        net_amount = v_order.total_amount,
        payment_collection = 'doorstep',
        payment_mode = 'cod',
        society_id = COALESCE(society_id, v_order.society_id),
        updated_at = now()
    WHERE id = v_existing_payment_record_id;
  ELSE
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
      society_id,
      idempotency_key
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
      v_order.society_id,
      'cod_' || v_order.id::text
    );
  END IF;
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
  v_existing_payment_record_id uuid;
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

    SELECT pr.id
    INTO v_existing_payment_record_id
    FROM public.payment_records pr
    WHERE pr.order_id = NEW.id
    ORDER BY pr.created_at ASC, pr.id ASC
    LIMIT 1;

    IF v_existing_payment_record_id IS NOT NULL THEN
      UPDATE public.payment_records
      SET buyer_id = NEW.buyer_id,
          seller_id = NEW.seller_id,
          amount = NEW.total_amount,
          payment_method = COALESCE(NEW.payment_type, 'cod'),
          payment_status = NEW.payment_status,
          transaction_reference = COALESCE(NEW.razorpay_payment_id, transaction_reference),
          society_id = COALESCE(society_id, NEW.society_id),
          payment_mode = v_payment_mode,
          payment_collection = v_payment_collection,
          razorpay_payment_id = COALESCE(NEW.razorpay_payment_id, razorpay_payment_id),
          idempotency_key = COALESCE(idempotency_key, 'pay_' || NEW.id || '_' || NEW.payment_status),
          updated_at = now()
      WHERE id = v_existing_payment_record_id;
    ELSE
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
      );
    END IF;
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