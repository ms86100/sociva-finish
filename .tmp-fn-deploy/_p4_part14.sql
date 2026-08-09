-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.stamp_checkout_group_capture(
  _group_id uuid,
  _razorpay_payment_id text,
  _razorpay_order_id text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_capture numeric;
BEGIN
  IF _group_id IS NULL THEN
    RETURN;
  END IF;

  SELECT ROUND(SUM(COALESCE(o.frozen_total, o.total_amount, 0))::numeric, 2)
  INTO v_capture
  FROM public.orders o
  WHERE o.checkout_group_id = _group_id;

  UPDATE public.checkout_groups
  SET payment_status = 'paid',
      razorpay_payment_id = COALESCE(_razorpay_payment_id, razorpay_payment_id),
      razorpay_order_id = COALESCE(_razorpay_order_id, razorpay_order_id),
      gateway_captured_amount = COALESCE(gateway_captured_amount, v_capture),
      updated_at = now()
  WHERE id = _group_id;

  PERFORM public.refresh_checkout_group_totals(_group_id);
END;
$function$;

REVOKE ALL ON FUNCTION public.stamp_checkout_group_capture(uuid, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.stamp_checkout_group_capture(uuid, text, text) TO service_role;
