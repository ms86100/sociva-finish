-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.resolve_refund_gateway_context(p_refund_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  r public.refund_requests;
  o public.orders;
  v_payment_id text;
  v_amount numeric;
  v_group_id uuid;
  v_already numeric := 0;
  v_capture numeric := 0;
BEGIN
  SELECT * INTO r FROM public.refund_requests WHERE id = p_refund_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'refund_not_found');
  END IF;

  SELECT * INTO o FROM public.orders WHERE id = r.order_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'order_not_found');
  END IF;

  v_group_id := o.checkout_group_id;
  v_payment_id := NULLIF(o.razorpay_payment_id, '');

  IF v_payment_id IS NULL AND v_group_id IS NOT NULL THEN
    SELECT NULLIF(cg.razorpay_payment_id, '') INTO v_payment_id
    FROM public.checkout_groups cg
    WHERE cg.id = v_group_id;
  END IF;

  v_amount := public.compute_child_gateway_refund_amount(o.id);
  -- Never exceed the refund_request amount (source of truth for this attempt)
  IF COALESCE(r.amount, 0) > 0 THEN
    v_amount := LEAST(v_amount, ROUND(r.amount::numeric, 2));
  END IF;

  IF v_group_id IS NOT NULL THEN
    SELECT COALESCE(cg.amount_refunded, 0),
           COALESCE(cg.gateway_captured_amount, cg.total_amount, 0)
    INTO v_already, v_capture
    FROM public.checkout_groups cg
    WHERE cg.id = v_group_id;
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'refund_id', r.id,
    'order_id', o.id,
    'checkout_group_id', v_group_id,
    'razorpay_payment_id', v_payment_id,
    'amount', v_amount,
    'requested_amount', r.amount,
    'group_amount_refunded', v_already,
    'group_gateway_captured', v_capture,
    'is_partial', (v_group_id IS NOT NULL AND COALESCE(v_capture, 0) > COALESCE(v_amount, 0) + 0.009)
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.resolve_refund_gateway_context(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.resolve_refund_gateway_context(uuid) TO service_role;

