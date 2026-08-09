-- validate_order_status_transition: restore acting_as / allowed_actor
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.validate_order_status_transition()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  _raw_pg TEXT;
  _parent_group TEXT;
  _txn_type TEXT;
  _valid BOOLEAN;
  _listing_type TEXT;
  _acting_as TEXT;
BEGIN
  IF OLD.status IS NOT DISTINCT FROM NEW.status THEN RETURN NEW; END IF;
  -- Checkout unpaid hold is managed by payment RPCs (confirm / verify / auto-cancel)
  IF OLD.status::text = 'payment_pending' THEN RETURN NEW; END IF;
  IF current_setting('app.otp_verified', true) = 'true' THEN RETURN NEW; END IF;
  -- service_role cancels / system paths
  IF current_setting('role', true) = 'service_role' THEN RETURN NEW; END IF;

  SELECT sp.primary_group INTO _raw_pg
  FROM public.seller_profiles sp WHERE sp.id = NEW.seller_id;

  _parent_group := resolve_transition_parent_group(_raw_pg);

  IF NEW.transaction_type IS NOT NULL THEN
    _txn_type := NEW.transaction_type;
  ELSE
    SELECT p.listing_type INTO _listing_type
    FROM public.order_items oi JOIN public.products p ON p.id = oi.product_id
    WHERE oi.order_id = NEW.id LIMIT 1;

    IF _listing_type = 'contact_only' THEN _txn_type := 'contact_enquiry';
    ELSIF NEW.order_type = 'enquiry' THEN
      IF _parent_group IN ('education_learning','events') THEN _txn_type := 'service_booking';
      ELSE _txn_type := 'request_service'; END IF;
    ELSIF NEW.order_type = 'booking' THEN _txn_type := 'service_booking';
    ELSIF NEW.fulfillment_type = 'self_pickup' THEN _txn_type := 'self_fulfillment';
    ELSIF NEW.fulfillment_type = 'seller_delivery' THEN _txn_type := 'seller_delivery';
    ELSIF NEW.fulfillment_type = 'delivery' AND COALESCE(NEW.delivery_handled_by,'seller') = 'seller' THEN _txn_type := 'seller_delivery';
    ELSIF NEW.fulfillment_type = 'delivery' AND NEW.delivery_handled_by = 'platform' THEN _txn_type := 'cart_purchase';
    ELSE _txn_type := 'self_fulfillment'; END IF;
  END IF;

  _acting_as := nullif(current_setting('app.acting_as', true), '');

  IF _acting_as IS NOT NULL THEN
    SELECT EXISTS (
      SELECT 1 FROM public.category_status_transitions
      WHERE parent_group = _parent_group AND transaction_type = _txn_type
        AND from_status = OLD.status::text AND to_status = NEW.status::text
        AND (allowed_actor = _acting_as OR position(_acting_as IN allowed_actor) > 0)
    ) INTO _valid;

    IF NOT _valid AND _parent_group != 'default' THEN
      SELECT EXISTS (
        SELECT 1 FROM public.category_status_transitions
        WHERE parent_group = 'default' AND transaction_type = _txn_type
          AND from_status = OLD.status::text AND to_status = NEW.status::text
          AND (allowed_actor = _acting_as OR position(_acting_as IN allowed_actor) > 0)
      ) INTO _valid;
    END IF;
  ELSE
    SELECT EXISTS (
      SELECT 1 FROM public.category_status_transitions
      WHERE parent_group = _parent_group AND transaction_type = _txn_type
        AND from_status = OLD.status::text AND to_status = NEW.status::text
    ) INTO _valid;

    IF NOT _valid AND _parent_group != 'default' THEN
      SELECT EXISTS (
        SELECT 1 FROM public.category_status_transitions
        WHERE parent_group = 'default' AND transaction_type = _txn_type
          AND from_status = OLD.status::text AND to_status = NEW.status::text
      ) INTO _valid;
    END IF;
  END IF;

  IF NOT _valid THEN
    RAISE EXCEPTION 'Invalid status transition from "%" to "%" (parent_group=%, txn_type=%, actor=%)',
      OLD.status, NEW.status, _parent_group, _txn_type, COALESCE(_acting_as, 'any');
  END IF;

  RETURN NEW;
END;
$function$;

-- ------------------------------------------------------------
-- Auto-accept: also fire on payment_pending → placed UPDATE
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.handle_order_auto_accept()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_seller RECORD;
  v_today_count int;
  v_current_day text;
BEGIN
  -- INSERT with placed, or UPDATE payment_pending → placed (payment confirm)
  IF TG_OP = 'UPDATE' THEN
    IF NEW.status::text <> 'placed'
       OR OLD.status::text IS NOT DISTINCT FROM NEW.status::text
       OR OLD.status::text <> 'payment_pending' THEN
      RETURN NEW;
    END IF;
  ELSIF NEW.status::text <> 'placed' THEN
    RETURN NEW;
  END IF;

  IF COALESCE(NEW.auto_accepted, false) THEN
    RETURN NEW;
  END IF;

  SELECT auto_accept_enabled, operating_days, availability_start, availability_end, daily_order_limit
  INTO v_seller
  FROM public.seller_profiles
  WHERE id = NEW.seller_id;

  IF NOT FOUND OR NOT v_seller.auto_accept_enabled THEN
    RETURN NEW;
  END IF;

  v_current_day := lower(trim(to_char(now() AT TIME ZONE 'Asia/Kolkata', 'Day')));
  IF v_seller.operating_days IS NOT NULL AND array_length(v_seller.operating_days, 1) > 0 THEN
    IF NOT (v_current_day = ANY(v_seller.operating_days)) THEN
      RETURN NEW;
    END IF;
  END IF;

  IF v_seller.availability_start IS NOT NULL AND v_seller.availability_end IS NOT NULL THEN
    IF (now() AT TIME ZONE 'Asia/Kolkata')::time < v_seller.availability_start
       OR (now() AT TIME ZONE 'Asia/Kolkata')::time > v_seller.availability_end THEN
      RETURN NEW;
    END IF;
  END IF;

  IF v_seller.daily_order_limit IS NOT NULL AND v_seller.daily_order_limit > 0 THEN
    SELECT count(*) INTO v_today_count
    FROM public.orders
    WHERE seller_id = NEW.seller_id
      AND created_at >= (now() AT TIME ZONE 'Asia/Kolkata')::date
      AND status NOT IN ('cancelled', 'returned');

    IF v_today_count >= v_seller.daily_order_limit THEN
      RETURN NEW;
    END IF;
  END IF;

  NEW.status := 'preparing';
  NEW.auto_accepted := true;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_order_auto_accept ON public.orders;
CREATE TRIGGER trg_order_auto_accept
  BEFORE INSERT OR UPDATE OF status ON public.orders
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_order_auto_accept();

-- Notify seller when auto-accept happens on UPDATE (INSERT path already covered)
CREATE OR REPLACE FUNCTION public.log_auto_accept_activity()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  _seller_user_id uuid;
  _buyer_name text;
BEGIN
  IF NEW.auto_accepted IS TRUE AND (TG_OP = 'INSERT' OR COALESCE(OLD.auto_accepted, false) IS DISTINCT FROM true) THEN
    INSERT INTO public.order_activity (order_id, actor_type, action, details)
    VALUES (
      NEW.id,
      'system',
      'auto_accepted',
      jsonb_build_object(
        'message', 'Order was automatically accepted by the system',
        'from_status', CASE WHEN TG_OP = 'UPDATE' THEN OLD.status::text ELSE 'placed' END,
        'to_status', NEW.status::text
      )
    );

    -- Ensure seller is notified (especially UPDATE path after payment confirm)
    SELECT user_id INTO _seller_user_id FROM public.seller_profiles WHERE id = NEW.seller_id;
    SELECT name INTO _buyer_name FROM public.profiles WHERE id = NEW.buyer_id;
    IF _seller_user_id IS NOT NULL THEN
      INSERT INTO public.notification_queue (user_id, title, body, type, reference_path, payload)
      VALUES (
        _seller_user_id,
        'Order Auto-Accepted',
        COALESCE(_buyer_name, 'Customer') || ' placed an order worth Rs ' || COALESCE(NEW.total_amount, 0) || '. Auto-accepted — start preparing!',
        'order',
        '/seller/orders/' || NEW.id,
        jsonb_build_object(
          'order_id', NEW.id,
          'buyer_name', _buyer_name,
          'total', NEW.total_amount,
          'auto_accepted', true,
          'target_role', 'seller'
        )
      );
    END IF;
  END IF;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_log_auto_accept_activity ON public.orders;
CREATE TRIGGER trg_log_auto_accept_activity
  AFTER INSERT OR UPDATE OF status, auto_accepted ON public.orders
  FOR EACH ROW
  WHEN (NEW.auto_accepted = true)
  EXECUTE FUNCTION public.log_auto_accept_activity();

-- ------------------------------------------------------------
-- Allow needs_manual_review for 72h stuck-refund escalation (no blind complete)
-- ------------------------------------------------------------
ALTER TABLE public.refund_requests
  DROP CONSTRAINT IF EXISTS refund_state_check;
ALTER TABLE public.refund_requests
  ADD CONSTRAINT refund_state_check CHECK (refund_state IN (
    'requested','approved','rejected',
    'refund_initiated','refund_processing',
    'refund_completed','refund_failed',
    'needs_manual_review'
  ));
