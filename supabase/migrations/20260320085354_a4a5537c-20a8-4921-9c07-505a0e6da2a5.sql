
-- Service-level RPC for completing delivery from edge functions (service role)
-- Sets app.otp_verified flag atomically so triggers pass
CREATE OR REPLACE FUNCTION public.service_complete_delivery(
  _assignment_id uuid,
  _order_id uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Set the OTP verified flag FIRST so triggers allow the transition
  PERFORM set_config('app.otp_verified', 'true', true);

  -- Update delivery assignment to delivered
  UPDATE public.delivery_assignments
  SET
    status = 'delivered',
    delivered_at = now(),
    otp_hash = null,
    updated_at = now()
  WHERE id = _assignment_id;

  -- Update order to delivered
  UPDATE public.orders
  SET
    status = 'delivered',
    needs_attention = false,
    needs_attention_reason = null,
    updated_at = now()
  WHERE id = _order_id;

  -- Reset flag
  PERFORM set_config('app.otp_verified', 'false', true);
END;
$$;
