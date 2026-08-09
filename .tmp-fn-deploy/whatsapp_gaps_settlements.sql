-- 5) Settlement notifications on seller_settlements (eligible / paid)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.enqueue_seller_settlement_notification()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  _seller_user_id uuid;
  _title text;
  _body text;
  _status text;
  _amount numeric;
BEGIN
  SELECT user_id INTO _seller_user_id FROM seller_profiles WHERE id = NEW.seller_id;
  IF _seller_user_id IS NULL THEN RETURN NEW; END IF;

  _amount := COALESCE(NEW.net_amount, 0);
  _status := COALESCE(NEW.settlement_status, NEW.status);

  IF TG_OP = 'INSERT' THEN
    _title := '💰 Settlement pending';
    _body := 'A settlement of ₹' || _amount || ' was created and will become eligible after cooldown.';
    _status := 'settlement_pending';
  ELSIF TG_OP = 'UPDATE'
    AND COALESCE(NEW.settlement_status, NEW.status) IS DISTINCT FROM COALESCE(OLD.settlement_status, OLD.status)
  THEN
    IF COALESCE(NEW.settlement_status, NEW.status) IN ('eligible') THEN
      _title := '✅ Settlement eligible';
      _body := '₹' || _amount || ' is now eligible for payout.';
      _status := 'settlement_eligible';
    ELSIF COALESCE(NEW.settlement_status, NEW.status) IN ('settled', 'released', 'paid') THEN
      _title := '💸 Settlement paid';
      _body := '₹' || _amount || ' has been released to your account.';
      _status := 'settlement_paid';
    ELSE
      RETURN NEW;
    END IF;
  ELSE
    RETURN NEW;
  END IF;

  INSERT INTO notification_queue (user_id, title, body, type, reference_path, payload)
  VALUES (
    _seller_user_id,
    _title,
    _body,
    'settlement',
    '/seller/settlements',
    jsonb_build_object(
      'settlementId', NEW.id,
      'settlement_id', NEW.id,
      'orderId', NEW.order_id,
      'order_id', NEW.order_id,
      'amount', _amount,
      'status', _status,
      'target_role', 'seller',
      'wa_template', 'sociva_payment_update'
    )
  );

  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_seller_settlement_notification ON public.seller_settlements;
CREATE TRIGGER trg_seller_settlement_notification
  AFTER INSERT OR UPDATE OF settlement_status, status ON public.seller_settlements
  FOR EACH ROW
  EXECUTE FUNCTION public.enqueue_seller_settlement_notification();

-- Keep payment_settlements "released" notify (period settlements) with WA hints
CREATE OR REPLACE FUNCTION public.enqueue_settlement_notification()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  _seller_user_id uuid;
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.status = 'released' AND OLD.status IS DISTINCT FROM 'released' THEN
    SELECT user_id INTO _seller_user_id FROM seller_profiles WHERE id = NEW.seller_id;
    IF _seller_user_id IS NOT NULL THEN
      INSERT INTO notification_queue (user_id, title, body, type, reference_path, payload)
      VALUES (
        _seller_user_id,
        'Payment Released',
        'Rs ' || COALESCE(NEW.amount, 0) || ' has been released to your account',
        'settlement',
        '/seller/settlements',
        jsonb_build_object(
          'settlement_id', NEW.id,
          'amount', COALESCE(NEW.amount, 0),
          'status', 'settlement_paid',
          'target_role', 'seller',
          'wa_template', 'sociva_payment_update'
        )
      );
    END IF;
  ELSIF TG_OP = 'INSERT' THEN
    SELECT user_id INTO _seller_user_id FROM seller_profiles WHERE id = NEW.seller_id;
    IF _seller_user_id IS NOT NULL THEN
      INSERT INTO notification_queue (user_id, title, body, type, reference_path, payload)
      VALUES (
        _seller_user_id,
        '💰 Payment Settlement Created',
        'A settlement of ₹' || COALESCE(NEW.amount, 0) || ' has been initiated.',
        'settlement',
        '/seller/settlements',
        jsonb_build_object(
          'settlementId', NEW.id,
          'amount', COALESCE(NEW.amount, 0),
          'status', 'settlement_pending',
          'target_role', 'seller',
          'wa_template', 'sociva_payment_update'
        )
      );
    END IF;
  END IF;
  RETURN NEW;
END;
$function$;

-- ---------------------------------------------------------------------------
