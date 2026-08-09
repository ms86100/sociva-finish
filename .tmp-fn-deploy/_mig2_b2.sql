CREATE OR REPLACE FUNCTION public.create_settlement_on_delivery_impl(p_old orders, p_new orders)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _cooldown_hours integer;
  _platform_fee numeric;
  _gross numeric;
  _net numeric;
  _society_id uuid;
  _loyalty_subsidy numeric;
  _wallet_cash numeric;
  _wallet_promo numeric;
  _gross_before numeric;
BEGIN
  IF p_old.status IS NOT DISTINCT FROM p_new.status THEN RETURN; END IF;
  IF p_new.status NOT IN ('delivered', 'completed') THEN RETURN; END IF;

  IF EXISTS (SELECT 1 FROM public.seller_settlements WHERE order_id = p_new.id) THEN
    RETURN;
  END IF;

  SELECT COALESCE(value::integer, 48) INTO _cooldown_hours
  FROM public.system_settings WHERE key = 'settlement_cooldown_hours';
  IF _cooldown_hours IS NULL THEN _cooldown_hours := 48; END IF;

  SELECT COALESCE(pr.platform_fee, 0) INTO _platform_fee
  FROM public.payment_records pr WHERE pr.order_id = p_new.id LIMIT 1;
  IF _platform_fee IS NULL THEN _platform_fee := 0; END IF;

  _loyalty_subsidy := COALESCE(p_new.loyalty_discount_amount, 0);
  _wallet_cash := COALESCE(p_new.wallet_cash_amount, 0);
  _wallet_promo := COALESCE(p_new.wallet_promo_amount, 0);
  -- Seller GMV = what buyer would have paid without loyalty/wallet credits
  _gross_before := COALESCE(p_new.total_amount, 0) + _loyalty_subsidy + _wallet_cash + _wallet_promo;
  _gross := _gross_before;
  _net := _gross - _platform_fee;

  SELECT society_id INTO _society_id FROM public.profiles WHERE id = p_new.buyer_id;

  INSERT INTO public.seller_settlements (
    order_id, seller_id, society_id,
    gross_amount, platform_fee, delivery_fee_share, net_amount,
    platform_loyalty_subsidy, gross_before_loyalty,
    wallet_cash_applied, wallet_promo_applied,
    settlement_status, eligible_at
  ) VALUES (
    p_new.id, p_new.seller_id, COALESCE(_society_id, p_new.buyer_society_id),
    _gross, _platform_fee, COALESCE(p_new.delivery_fee, 0), _net,
    _loyalty_subsidy, COALESCE(p_new.total_amount, 0) + _loyalty_subsidy,
    _wallet_cash, _wallet_promo,
    'pending',
    now() + (_cooldown_hours || ' hours')::interval
  );
END;
$$;

-- ------------------------------------------------------------
-- Cancel: release wallet hold or restore committed spend
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
  IF NEW.status = 'cancelled' AND OLD.status IS DISTINCT FROM NEW.status THEN
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
          AND status IS DISTINCT FROM 'cancelled';

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

DROP TRIGGER IF EXISTS trg_wallet_on_order_cancelled ON public.orders;
CREATE TRIGGER trg_wallet_on_order_cancelled
  AFTER UPDATE OF status ON public.orders
  FOR EACH ROW
  EXECUTE FUNCTION public.fn_wallet_on_order_cancelled();

-- ------------------------------------------------------------
-- request_refund: optional Sociva Credit destination
-- ------------------------------------------------------------
DROP FUNCTION IF EXISTS public.request_refund(uuid, text, text, text[]);

