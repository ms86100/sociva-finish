-- P0: Abandoned online checkout was holding stock forever.
-- create_multi_vendor_orders only set auto_cancel_at for preorders; regular
-- payment_pending Razorpay/UPI holds had NULL TTL, so auto_cancel_expired_unpaid_orders
-- never released inventory / low-stock / is_available=false side effects.
--
-- Also: buyer_cancel_pending_orders and auto_cancel_expired_unpaid_orders were
-- missing app.acting_as, so the fail-closed status gate blocked cancels (Cancel button no-op).

BEGIN;

CREATE OR REPLACE FUNCTION public.stamp_unpaid_online_auto_cancel()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF NEW.status = 'payment_pending'::public.order_status
     AND COALESCE(NEW.payment_status, 'pending') = 'pending'
     AND COALESCE(NEW.payment_type, '') IS DISTINCT FROM 'cod'
     AND NEW.auto_cancel_at IS NULL THEN
    NEW.auto_cancel_at := now() + interval '45 minutes';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_stamp_unpaid_online_auto_cancel ON public.orders;
CREATE TRIGGER trg_stamp_unpaid_online_auto_cancel
  BEFORE INSERT ON public.orders
  FOR EACH ROW
  EXECUTE FUNCTION public.stamp_unpaid_online_auto_cancel();

COMMENT ON FUNCTION public.stamp_unpaid_online_auto_cancel() IS
  'Ensures unpaid online payment_pending orders get a 45m auto_cancel_at so abandoned Razorpay/UPI holds release stock.';

-- Backfill any already-stuck unpaid holds (cancel ASAP on next cron if already past window)
UPDATE public.orders
SET auto_cancel_at = CASE
      WHEN created_at + interval '45 minutes' <= now() THEN now()
      ELSE created_at + interval '45 minutes'
    END,
    updated_at = now()
WHERE status = 'payment_pending'::public.order_status
  AND payment_status = 'pending'
  AND COALESCE(payment_type, '') IS DISTINCT FROM 'cod'
  AND auto_cancel_at IS NULL;

-- Harden buyer cancel: set acting_as so status gate allows payment_pending → cancelled
CREATE OR REPLACE FUNCTION public.buyer_cancel_pending_orders(
  _order_ids uuid[]
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  _affected integer := 0;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  IF _order_ids IS NULL OR coalesce(array_length(_order_ids, 1), 0) = 0 THEN
    RETURN 0;
  END IF;

  -- Required by validate_order_status_transition fail-closed gate
  PERFORM set_config('app.acting_as', 'buyer', true);

  UPDATE public.orders
  SET
    status = 'cancelled',
    rejection_reason = 'Order was cancelled as payment was not completed',
    updated_at = now(),
    auto_cancel_at = null
  WHERE id = ANY(_order_ids)
    AND buyer_id = auth.uid()
    AND status = 'payment_pending'::public.order_status
    AND payment_status = 'pending';

  GET DIAGNOSTICS _affected = ROW_COUNT;
  RETURN _affected;
END;
$$;

-- Cron cancel also needs acting_as = system
CREATE OR REPLACE FUNCTION public.auto_cancel_expired_unpaid_orders()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  cancelled_ids uuid[] := '{}';
  r record;
BEGIN
  PERFORM set_config('app.acting_as', 'system', true);

  FOR r IN
    SELECT o.id
    FROM public.orders o
    WHERE o.auto_cancel_at IS NOT NULL
      AND o.auto_cancel_at < now()
      AND o.status = 'payment_pending'::order_status
      AND o.payment_status = 'pending'
      AND COALESCE(o.payment_type, '') <> 'cod'
    FOR UPDATE OF o SKIP LOCKED
  LOOP
    UPDATE public.orders
    SET status = 'cancelled'::order_status,
        rejection_reason = 'Order was cancelled as payment was not completed in time',
        auto_cancel_at = NULL,
        updated_at = now()
    WHERE id = r.id
      AND status = 'payment_pending'::order_status
      AND payment_status = 'pending';

    IF FOUND THEN
      cancelled_ids := array_append(cancelled_ids, r.id);
    END IF;
  END LOOP;

  RETURN jsonb_build_object(
    'cancelled_count', COALESCE(array_length(cancelled_ids, 1), 0),
    'cancelled_ids', to_jsonb(cancelled_ids)
  );
END;
$$;

COMMIT;
