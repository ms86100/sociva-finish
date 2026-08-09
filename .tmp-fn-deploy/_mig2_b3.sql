CREATE OR REPLACE FUNCTION public.request_refund(
  p_order_id uuid,
  p_reason text,
  p_category text DEFAULT 'order_issue'::text,
  p_evidence_urls text[] DEFAULT NULL::text[],
  p_refund_destination text DEFAULT 'original_payment'::text
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_order record;
  v_refund_id uuid;
  v_seller_user uuid;
  v_dest text;
  v_valid_categories text[] := ARRAY[
    'order_issue','quality_issue','wrong_item','not_received','seller_cancelled','other'
  ];
BEGIN
  IF p_category IS NULL OR NOT (p_category = ANY(v_valid_categories)) THEN
    RAISE EXCEPTION 'Invalid refund category: %', COALESCE(p_category, 'NULL');
  END IF;

  v_dest := lower(COALESCE(NULLIF(trim(p_refund_destination), ''), 'original_payment'));
  IF v_dest NOT IN ('original_payment', 'wallet') THEN
    RAISE EXCEPTION 'Invalid refund destination: %', v_dest;
  END IF;

  SELECT id, buyer_id, seller_id, society_id, total_amount, frozen_total, payment_status, status,
         payment_type, wallet_cash_amount, wallet_promo_amount
  INTO v_order
  FROM orders
  WHERE id = p_order_id AND buyer_id = auth.uid();

  IF v_order IS NULL THEN
    RAISE EXCEPTION 'Order not found or does not belong to you';
  END IF;

  IF v_order.payment_status NOT IN ('paid', 'buyer_confirmed', 'seller_verified', 'completed') THEN
    RAISE EXCEPTION 'No payment found for this order';
  END IF;

  IF EXISTS (SELECT 1 FROM refund_requests WHERE order_id = p_order_id AND status NOT IN ('rejected', 'completed')) THEN
    RAISE EXCEPTION 'A refund request already exists for this order';
  END IF;

  -- COD / wallet-only: prefer wallet credit when destination not forced to original
  IF v_dest = 'original_payment'
     AND lower(COALESCE(v_order.payment_type, '')) IN ('cod', 'cash') THEN
    v_dest := 'wallet';
  END IF;

  -- Refundable = residual paid (gateway/COD) + wallet applied on this order
  -- (frozen_total wins when set; else reconstruct buyer economic outlay)
  INSERT INTO refund_requests (
    order_id, buyer_id, seller_id, society_id, amount, reason, category,
    evidence_urls, refund_method, refund_destination, wallet_credit_amount
  )
  VALUES (
    p_order_id,
    v_order.buyer_id,
    v_order.seller_id,
    v_order.society_id,
    COALESCE(
      NULLIF(v_order.frozen_total, 0),
      COALESCE(v_order.total_amount, 0)
        + COALESCE(v_order.wallet_cash_amount, 0)
        + COALESCE(v_order.wallet_promo_amount, 0)
    ),
    p_reason,
    p_category,
    p_evidence_urls,
    CASE WHEN v_dest = 'wallet' THEN 'wallet' ELSE 'original_payment' END,
    v_dest,
    CASE WHEN v_dest = 'wallet' THEN COALESCE(
      NULLIF(v_order.frozen_total, 0),
      COALESCE(v_order.total_amount, 0)
        + COALESCE(v_order.wallet_cash_amount, 0)
        + COALESCE(v_order.wallet_promo_amount, 0)
    ) ELSE NULL END
  )
  RETURNING id INTO v_refund_id;

  IF NOT EXISTS (SELECT 1 FROM dispute_tickets WHERE order_id = p_order_id AND status != 'resolved') THEN
    INSERT INTO dispute_tickets (order_id, raised_by, against_user, reason, category, status, society_id)
    VALUES (p_order_id, auth.uid(), v_order.seller_id, p_reason, p_category, 'open', v_order.society_id);
  END IF;

  SELECT sp.user_id INTO v_seller_user
  FROM seller_profiles sp
  WHERE sp.id = v_order.seller_id;

  IF v_seller_user IS NOT NULL THEN
    INSERT INTO public.notification_queue (user_id, title, body, type, reference_path, payload)
    VALUES (
      v_seller_user,
      'Refund requested',
      'A buyer requested a refund. Reason: ' || left(coalesce(p_reason, ''), 120),
      'order',
      '/orders/' || p_order_id,
      jsonb_build_object(
        'orderId', p_order_id,
        'refundId', v_refund_id,
        'status', 'refund_requested',
        'target_role', 'seller',
        'wa_template', 'sociva_refund_update',
        'refund_destination', v_dest
      )
    );
  END IF;

  RETURN v_refund_id;
END;
$function$;

GRANT EXECUTE ON FUNCTION public.request_refund(uuid, text, text, text[], text) TO authenticated, service_role;

-- ------------------------------------------------------------
-- complete_refund: loyalty clawback + wallet restore + optional wallet credit msg
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.complete_refund(p_refund_id uuid, p_gateway_ref text, p_gateway_status text)
RETURNS refund_requests
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  r public.refund_requests;
  v_before text;
  o public.orders;
  _paid numeric;
  _frac numeric;
  _restore integer;
  _wallet_cash numeric;
  _wallet_promo numeric;
  _notify_body text;
BEGIN
  SELECT * INTO r FROM public.refund_requests WHERE id = p_refund_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Refund not found'; END IF;
  v_before := r.refund_state;
  IF r.refund_state NOT IN ('refund_initiated','refund_processing') THEN
    RAISE EXCEPTION 'Refund cannot be completed from state: %', r.refund_state;
  END IF;

  UPDATE public.payment_ledger
  SET status = 'success',
      reference_id = p_gateway_ref,
      gateway_response = jsonb_build_object('status', p_gateway_status),
      updated_at = now()
  WHERE refund_id = p_refund_id AND status = 'pending';

  UPDATE public.refund_requests
  SET refund_state = 'refund_completed',
      status = 'settled',
      settled_at = now(),
      gateway_refund_id = p_gateway_ref,
      gateway_status = p_gateway_status,
      updated_at = now()
  WHERE id = p_refund_id
  RETURNING * INTO r;

  UPDATE public.orders
  SET payment_status = 'refunded',
      updated_at = now()
  WHERE id = r.order_id
    AND payment_status = 'paid';

  UPDATE public.payment_records
  SET payment_status = 'refunded'
  WHERE order_id = r.order_id
    AND payment_status = 'paid';

  SELECT * INTO o FROM public.orders WHERE id = r.order_id;
  IF FOUND THEN
    _paid := NULLIF(COALESCE(o.total_amount, 0) + COALESCE(o.wallet_cash_amount, 0) + COALESCE(o.wallet_promo_amount, 0) + COALESCE(o.loyalty_discount_amount, 0), 0);
    -- Prefer paid residual for fraction; fall back to refund vs merchandise+credits
    IF COALESCE(o.total_amount, 0) > 0 THEN
      _paid := o.total_amount;
    END IF;
    IF _paid IS NOT NULL AND COALESCE(r.amount, 0) > 0 THEN
      _frac := LEAST(GREATEST(r.amount / NULLIF(_paid, 0), 0), 1);
    ELSE
      _frac := 1;
    END IF;

    PERFORM public.reverse_loyalty_earn_for_order(o.id, _frac);

    _restore := FLOOR(COALESCE(o.loyalty_points_redeemed, 0) * _frac)::integer;
    IF _restore > 0 THEN
      PERFORM public.restore_loyalty_for_order(o.id, _restore, 'refund');
    END IF;

    -- Restore wallet spend proportionally (skip when destination=wallet;
    -- credit_wallet_from_refund already covers the full economic refund)
    IF COALESCE(r.refund_destination, 'original_payment') <> 'wallet' THEN
      _wallet_cash := ROUND(COALESCE(o.wallet_cash_amount, 0) * _frac, 2);
      _wallet_promo := ROUND(COALESCE(o.wallet_promo_amount, 0) * _frac, 2);
      IF _wallet_cash > 0 OR _wallet_promo > 0 THEN
        PERFORM public.restore_wallet_for_order(o.id, _wallet_cash, _wallet_promo, 'refund');
      END IF;
    END IF;
  END IF;

  IF COALESCE(r.refund_destination, 'original_payment') = 'wallet' THEN
    _notify_body := 'Your refund of INR ' || r.amount || ' was credited instantly as Sociva Credit. Usable on Sociva only (not withdrawable). Ref: ' || p_gateway_ref;
  ELSE
    _notify_body := 'Your refund of INR ' || r.amount || ' has been settled to your original payment method. Ref: ' || p_gateway_ref;
  END IF;

  INSERT INTO public.refund_audit_log(refund_id, action, actor_role, before_state, after_state, metadata)
  VALUES (p_refund_id, 'complete', 'system', v_before, 'refund_completed',
          jsonb_build_object(
            'gateway_ref', p_gateway_ref,
            'gateway_status', p_gateway_status,
            'refund_destination', r.refund_destination
          ));

  INSERT INTO public.notification_queue(user_id, title, body, type, reference_path, payload)
  VALUES (r.buyer_id,
          'Refund completed',
          _notify_body,
          'order',
          '/orders/' || r.order_id,
          jsonb_build_object(
            'orderId', r.order_id,
            'refundId', r.id,
            'status', 'refund_completed',
            'target_role', 'buyer',
            'refund_destination', r.refund_destination
          ));

  RETURN r;
END;
$function$;

-- Wallet-path helper used by refund-processor (skip Razorpay)
CREATE OR REPLACE FUNCTION public.complete_wallet_refund(p_refund_id uuid)
RETURNS refund_requests
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  r public.refund_requests;
  _credit jsonb;
BEGIN
  SELECT * INTO r FROM public.refund_requests WHERE id = p_refund_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Refund not found'; END IF;

  IF r.refund_state = 'refund_completed' THEN
    RETURN r;
  END IF;

  IF r.refund_state <> 'approved' AND r.refund_state NOT IN ('refund_initiated', 'refund_processing') THEN
    RAISE EXCEPTION 'Refund cannot be wallet-completed from state: %', r.refund_state;
  END IF;

  IF COALESCE(r.refund_destination, 'original_payment') <> 'wallet' THEN
    RAISE EXCEPTION 'Refund destination is not wallet';
  END IF;

  -- Move to initiated if still approved
  IF r.refund_state = 'approved' THEN
    UPDATE public.refund_requests
    SET refund_state = 'refund_initiated',
        status = 'processing',
        processed_at = now(),
        updated_at = now()
    WHERE id = p_refund_id
    RETURNING * INTO r;
  END IF;

  _credit := public.credit_wallet_from_refund(p_refund_id);
  IF COALESCE((_credit->>'success')::boolean, false) IS NOT TRUE THEN
    RAISE EXCEPTION 'wallet credit failed: %', coalesce(_credit->>'error', 'unknown');
  END IF;

  RETURN public.complete_refund(
    p_refund_id,
    COALESCE(_credit->>'txn_id', 'wallet_' || p_refund_id::text),
    'wallet_credited'
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.complete_wallet_refund(uuid) TO service_role;