-- Ensure required columns exist
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS payment_screenshot_url text;
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS upi_transaction_ref text;

-- Drop old overload(s)
DROP FUNCTION IF EXISTS public.confirm_upi_payment(uuid, text);
DROP FUNCTION IF EXISTS public.confirm_upi_payment(uuid, text, text);

-- Recreate with 3-param signature matching Sociva
CREATE FUNCTION public.confirm_upi_payment(
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
BEGIN
  _trimmed_ref := COALESCE(trim(_upi_transaction_ref), '');

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
  SET upi_transaction_ref = CASE WHEN _trimmed_ref = '' THEN upi_transaction_ref ELSE _trimmed_ref END,
      payment_screenshot_url = COALESCE(_payment_screenshot_url, payment_screenshot_url),
      payment_status = 'buyer_confirmed',
      status = CASE WHEN _order.status = 'payment_pending' THEN 'placed'::order_status ELSE status END,
      updated_at = now()
  WHERE id = _order_id;
END;
$$;