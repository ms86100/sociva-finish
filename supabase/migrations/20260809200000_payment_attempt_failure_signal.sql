-- Payment attempt failure signal
--
-- Gap: payment.failed webhook records the attempt but emits nothing to the
-- frontend. The orders row never changes, so Realtime has nothing to push,
-- and the buyer stares at "Verifying payment..." with no indication an
-- attempt just failed.
--
-- Fix: two new nullable columns on orders that are updated by the webhook on
-- every failed attempt. Realtime fires → frontend switches banner copy from
-- "Verifying payment..." to "Last payment attempt failed — retry or cancel."
-- The order status stays payment_pending so the buyer can retry; the
-- authoritative paid transition still comes from payment.captured / webhook.

BEGIN;

ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS last_payment_error       TEXT,
  ADD COLUMN IF NOT EXISTS last_payment_failed_at   TIMESTAMPTZ;

-- Called by the webhook (service_role only) when payment.failed fires.
-- Only touches orders still in payment_pending — never overwrites a paid order.
CREATE OR REPLACE FUNCTION public.record_payment_attempt_failure(
  p_order_ids          uuid[],
  p_failure_code       text,
  p_failure_description text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  UPDATE public.orders
  SET
    last_payment_error     = COALESCE(p_failure_description, p_failure_code, 'Payment attempt failed'),
    last_payment_failed_at = now(),
    updated_at             = now()
  WHERE
    id = ANY(p_order_ids)
    AND status = 'payment_pending'
    AND payment_status NOT IN ('paid', 'completed', 'seller_verified');
END;
$$;

REVOKE ALL ON FUNCTION public.record_payment_attempt_failure(uuid[], text, text) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.record_payment_attempt_failure(uuid[], text, text) TO service_role;

COMMIT;
