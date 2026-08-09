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

