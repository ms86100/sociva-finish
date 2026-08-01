-- Phase 3c: confirm_cod_payment advances awaiting_cod_confirmation → completed
CREATE OR REPLACE FUNCTION public.confirm_cod_payment(_order_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_order RECORD;
  v_existing_payment_record_id uuid;
BEGIN
  SELECT o.id, o.buyer_id, o.seller_id, o.total_amount, o.payment_type, o.payment_status, o.society_id, o.status
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
      status = CASE
        WHEN status = 'awaiting_cod_confirmation'::order_status THEN 'completed'::order_status
        ELSE status
      END,
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
$function$;
