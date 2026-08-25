-- Add third payment_gateway_mode: off (COD-only).
-- Online rails stay mutually exclusive: off | upi_deep_link | razorpay.
-- Critical: get_public_payment_mode must NOT map off → upi_deep_link.

BEGIN;

CREATE OR REPLACE FUNCTION public.get_public_payment_mode()
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT CASE
    WHEN s.is_active = true AND s.value IN ('off', 'upi_deep_link', 'razorpay') THEN s.value
    ELSE 'upi_deep_link'
  END
  FROM (SELECT 1) AS seed
  LEFT JOIN public.admin_settings s
    ON s.key = 'payment_gateway_mode'
  LIMIT 1;
$$;

COMMENT ON FUNCTION public.get_public_payment_mode() IS
  'Returns active public checkout mode: off | upi_deep_link | razorpay. Never exposes credential values.';

CREATE OR REPLACE FUNCTION public.set_payment_gateway_mode(
  p_mode text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_admin(auth.uid()) THEN
    RAISE EXCEPTION 'Admin access required' USING ERRCODE = '42501';
  END IF;

  IF p_mode IS NULL OR p_mode NOT IN ('off', 'razorpay', 'upi_deep_link') THEN
    RAISE EXCEPTION 'Invalid payment mode. Allowed: off, razorpay, upi_deep_link';
  END IF;

  INSERT INTO public.admin_settings (key, value, description, is_active)
  VALUES (
    'payment_gateway_mode',
    p_mode,
    'Checkout payment mode: off (COD-only), upi_deep_link, or razorpay',
    true
  )
  ON CONFLICT (key) DO UPDATE
    SET value      = EXCLUDED.value,
        description = EXCLUDED.description,
        is_active  = true,
        updated_at = now();
END;
$$;

-- Gate Deep UPI claim path on platform mode
CREATE OR REPLACE FUNCTION public.confirm_upi_payment(
  _order_id uuid,
  _upi_transaction_ref text,
  _payment_screenshot_url text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _order record;
  _trimmed_ref text;
  _trimmed_shot text;
  _mode text;
BEGIN
  _mode := public.get_public_payment_mode();
  IF _mode IS DISTINCT FROM 'upi_deep_link' THEN
    RAISE EXCEPTION 'Direct UPI payments are disabled by the platform';
  END IF;

  _trimmed_ref := COALESCE(trim(_upi_transaction_ref), '');
  _trimmed_shot := COALESCE(trim(_payment_screenshot_url), '');

  IF _trimmed_ref = '' THEN
    RAISE EXCEPTION 'UTR / transaction reference is required';
  END IF;

  IF _trimmed_shot = '' THEN
    RAISE EXCEPTION 'Payment screenshot is required';
  END IF;

  SELECT id, buyer_id, status, payment_status
  INTO _order
  FROM public.orders
  WHERE id = _order_id
  FOR UPDATE;

  IF _order IS NULL THEN
    RAISE EXCEPTION 'Order not found';
  END IF;

  IF _order.buyer_id != auth.uid() THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;

  IF _order.status NOT IN ('placed', 'accepted', 'payment_pending') THEN
    RAISE EXCEPTION 'Order is not in a payable state';
  END IF;

  IF _order.payment_status NOT IN ('pending') THEN
    RAISE EXCEPTION 'Payment already processed';
  END IF;

  UPDATE public.orders
  SET upi_transaction_ref = _trimmed_ref,
      payment_screenshot_url = _trimmed_shot,
      payment_status = 'buyer_confirmed',
      auto_cancel_at = NULL,
      updated_at = now()
  WHERE id = _order_id;
END;
$$;

REVOKE ALL ON FUNCTION public.confirm_upi_payment(uuid, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.confirm_upi_payment(uuid, text, text) TO authenticated;

COMMIT;
