-- 6. Wallet / loyalty reverse on rejected (not only cancelled)
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fn_wallet_on_order_cancelled()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  r public.wallet_reservations;
  _siblings_open integer;
BEGIN
  IF NEW.status::text IN ('cancelled', 'rejected')
     AND OLD.status IS DISTINCT FROM NEW.status THEN
    IF NEW.wallet_reservation_id IS NOT NULL THEN
      SELECT * INTO r
      FROM public.wallet_reservations
      WHERE id = NEW.wallet_reservation_id
      FOR UPDATE;

      IF FOUND AND r.status = 'held' THEN
        SELECT COUNT(*) INTO _siblings_open
        FROM public.orders
        WHERE wallet_reservation_id = r.id
          AND id IS DISTINCT FROM NEW.id
          AND status::text NOT IN ('cancelled', 'rejected');

        IF COALESCE(_siblings_open, 0) = 0 THEN
          PERFORM public.release_wallet_reservation(r.id);
        END IF;
      ELSIF FOUND AND r.status = 'committed'
            AND (COALESCE(NEW.wallet_cash_amount, 0) > 0 OR COALESCE(NEW.wallet_promo_amount, 0) > 0) THEN
        PERFORM public.restore_wallet_for_order(
          NEW.id, NEW.wallet_cash_amount, NEW.wallet_promo_amount, 'cancel'
        );
      END IF;
    ELSIF COALESCE(NEW.wallet_cash_amount, 0) > 0 OR COALESCE(NEW.wallet_promo_amount, 0) > 0 THEN
      PERFORM public.restore_wallet_for_order(
        NEW.id, NEW.wallet_cash_amount, NEW.wallet_promo_amount, 'cancel'
      );
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.fn_loyalty_on_order_cancelled()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  r public.loyalty_reservations;
  _siblings_open integer;
BEGIN
  IF NEW.status::text IN ('cancelled', 'rejected')
     AND OLD.status IS DISTINCT FROM NEW.status THEN
    IF NEW.loyalty_reservation_id IS NOT NULL THEN
      SELECT * INTO r
      FROM public.loyalty_reservations
      WHERE id = NEW.loyalty_reservation_id
      FOR UPDATE;

      IF FOUND AND r.status = 'held' THEN
        SELECT COUNT(*) INTO _siblings_open
        FROM public.orders
        WHERE loyalty_reservation_id = r.id
          AND id IS DISTINCT FROM NEW.id
          AND status::text NOT IN ('cancelled', 'rejected');

        IF COALESCE(_siblings_open, 0) = 0 THEN
          PERFORM public.release_loyalty_reservation(r.id);
        END IF;
      ELSIF FOUND AND r.status = 'committed' AND COALESCE(NEW.loyalty_points_redeemed, 0) > 0 THEN
        PERFORM public.restore_loyalty_for_order(NEW.id, NEW.loyalty_points_redeemed, 'cancel');
      END IF;
    ELSIF COALESCE(NEW.loyalty_points_redeemed, 0) > 0 THEN
      PERFORM public.restore_loyalty_for_order(NEW.id, NEW.loyalty_points_redeemed, 'cancel');
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

-- ------------------------------------------------------------
-- 7. Stamp gateway_captured_amount when group is marked paid
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
