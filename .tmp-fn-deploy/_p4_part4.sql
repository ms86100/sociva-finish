-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.compute_child_gateway_refund_amount(_order_id uuid)
RETURNS numeric
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  o public.orders;
  v_child numeric;
  v_capture numeric;
  v_already numeric;
  v_remaining numeric;
  v_other_open integer;
BEGIN
  SELECT * INTO o FROM public.orders WHERE id = _order_id;
  IF NOT FOUND THEN
    RETURN 0;
  END IF;

  v_child := ROUND(COALESCE(o.frozen_total, o.total_amount, 0)::numeric, 2);
  IF v_child <= 0 THEN
    RETURN 0;
  END IF;

  -- Singleton / no shared capture: refund this child's residual only
  IF o.checkout_group_id IS NULL OR o.razorpay_payment_id IS NULL THEN
    RETURN GREATEST(v_child, 0);
  END IF;

  SELECT
    COALESCE(cg.gateway_captured_amount,
      (SELECT ROUND(SUM(COALESCE(sib.frozen_total, sib.total_amount, 0))::numeric, 2)
       FROM public.orders sib
       WHERE sib.checkout_group_id = o.checkout_group_id
         AND sib.razorpay_payment_id IS NOT DISTINCT FROM o.razorpay_payment_id)),
    COALESCE(cg.amount_refunded, 0)
  INTO v_capture, v_already
  FROM public.checkout_groups cg
  WHERE cg.id = o.checkout_group_id;

  v_capture := COALESCE(v_capture, v_child);
  v_already := COALESCE(v_already, 0);
  v_remaining := ROUND(GREATEST(v_capture - v_already, 0)::numeric, 2);

  -- Other siblings still holding / mid-refund on the same capture
  SELECT COUNT(*) INTO v_other_open
  FROM public.orders sib
  WHERE sib.checkout_group_id = o.checkout_group_id
    AND sib.id IS DISTINCT FROM o.id
    AND sib.razorpay_payment_id IS NOT DISTINCT FROM o.razorpay_payment_id
    AND sib.payment_status IN (
      'paid', 'buyer_confirmed', 'seller_verified', 'completed',
      'refund_initiated', 'refund_processing'
    );

  IF COALESCE(v_other_open, 0) = 0 THEN
    -- Last child: clear remaining capture (avoids paise dust / rounding under-refund)
    RETURN v_remaining;
  END IF;

  RETURN ROUND(LEAST(v_child, v_remaining)::numeric, 2);
END;
$function$;

REVOKE ALL ON FUNCTION public.compute_child_gateway_refund_amount(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.compute_child_gateway_refund_amount(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.compute_child_gateway_refund_amount(uuid) TO authenticated;

