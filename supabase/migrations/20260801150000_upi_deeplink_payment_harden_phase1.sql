-- Phase 1: UPI deep-link payment harden
-- 1) confirm_upi_payment: require UTR + screenshot; claim payment without advancing to placed
-- 2) verify_seller_payment: received=true → paid + placed; received=false → cancel + restock

-- ── confirm_upi_payment ──────────────────────────────────────────────────────
DROP FUNCTION IF EXISTS public.confirm_upi_payment(uuid, text);
DROP FUNCTION IF EXISTS public.confirm_upi_payment(uuid, text, text);

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
  _trimmed_shot text;
BEGIN
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

  -- Claim only: stay payment_pending until seller verifies (verify_seller_payment → placed)
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

-- ── verify_seller_payment (boolean overload used by SellerPaymentConfirmation) ─
CREATE OR REPLACE FUNCTION public.verify_seller_payment(
  _order_id uuid,
  _received boolean DEFAULT true
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _order record;
  _seller_user_id uuid;
  _slot_id uuid;
BEGIN
  SELECT id, seller_id, status, payment_status
  INTO _order
  FROM public.orders
  WHERE id = _order_id
  FOR UPDATE;

  IF _order IS NULL THEN
    RAISE EXCEPTION 'Order not found';
  END IF;

  SELECT user_id INTO _seller_user_id
  FROM public.seller_profiles
  WHERE id = _order.seller_id;

  IF _seller_user_id IS NULL OR _seller_user_id != auth.uid() THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;

  IF _order.payment_status NOT IN ('pending', 'buyer_confirmed') THEN
    RAISE EXCEPTION 'No pending payment to verify for this order';
  END IF;

  IF _received THEN
    -- Seller confirms receipt → mark paid and release to seller-actionable placed
    UPDATE public.orders
    SET payment_status = 'paid',
        payment_confirmed_by_seller = true,
        payment_confirmed_at = now(),
        status = CASE
          WHEN _order.status = 'payment_pending' THEN 'placed'::order_status
          ELSE status
        END,
        updated_at = now()
    WHERE id = _order_id;
  ELSE
    -- Seller disputes: cancel + restock (stock restore via trg_restore_stock_on_cancel)
    UPDATE public.orders
    SET payment_status = 'disputed',
        payment_confirmed_by_seller = false,
        payment_confirmed_at = now(),
        status = 'cancelled'::order_status,
        rejection_reason = 'Seller could not verify UPI payment — order cancelled',
        auto_cancel_at = NULL,
        updated_at = now()
    WHERE id = _order_id;

    -- Release any held service slot
    SELECT sb.slot_id INTO _slot_id
    FROM public.service_bookings sb
    WHERE sb.order_id = _order_id
      AND sb.slot_id IS NOT NULL
    LIMIT 1;

    IF _slot_id IS NOT NULL THEN
      PERFORM public.release_service_slot(_slot_id);
      UPDATE public.service_bookings
      SET status = 'cancelled',
          updated_at = now()
      WHERE order_id = _order_id
        AND status IS DISTINCT FROM 'cancelled';
    END IF;
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.verify_seller_payment(uuid, boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.verify_seller_payment(uuid, boolean) TO authenticated;
