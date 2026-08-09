-- ============================================================
-- P4: Partial refunds for checkout groups (child share of capture)
-- - Track amount_refunded on checkout_groups
-- - Compute child gateway refund (last-child gets remainder)
-- - Fix auto-refund refund_state=approved (processor gate)
-- - complete_refund: stamp group totals; fix payment_status; no double wallet/loyalty
-- - Wallet/loyalty cancel triggers also fire on rejected
-- ============================================================

-- ------------------------------------------------------------
-- 1. checkout_groups refund ledger fields
-- ------------------------------------------------------------
ALTER TABLE public.checkout_groups
  ADD COLUMN IF NOT EXISTS amount_refunded numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS gateway_captured_amount numeric;

COMMENT ON COLUMN public.checkout_groups.amount_refunded IS
  'Sum of completed gateway refunds against the shared Razorpay capture.';
COMMENT ON COLUMN public.checkout_groups.gateway_captured_amount IS
  'Residual INR captured via Razorpay for this group (sum of child total_amount at pay).';

-- ------------------------------------------------------------
-- 2. Compute child gateway refund amount (partial vs last-child)
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

-- ------------------------------------------------------------
-- 3. Gateway context for refund-processor (payment id + capped amount)
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

-- ------------------------------------------------------------
