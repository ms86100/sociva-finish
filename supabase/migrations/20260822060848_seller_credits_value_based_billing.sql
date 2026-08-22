-- Sociva Credits: value-based billing.
-- Rates, grace, thresholds, and no-show policy come only from admin tables.
-- Bookings: reserve at confirmation, resolve at appointment + admin grace.
-- Do not invent a second booking workflow. Do not post into finance.ledger.

CREATE TABLE IF NOT EXISTS public.seller_credit_settings (
  key text PRIMARY KEY,
  value text,
  updated_by uuid,
  updated_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO public.seller_credit_settings(key, value)
VALUES
  ('booking_resolution_grace_minutes', NULL),
  ('buyer_no_show_policy', NULL)
ON CONFLICT (key) DO NOTHING;

ALTER TABLE public.seller_credit_settings ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.seller_credit_settings FROM PUBLIC, anon;

CREATE POLICY seller_credit_settings_admin_read ON public.seller_credit_settings
  FOR SELECT TO authenticated
  USING (public.is_admin(auth.uid()));

ALTER TABLE public.seller_credit_reservations
  ADD COLUMN IF NOT EXISTS reserved_at timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS committed_at timestamptz,
  ADD COLUMN IF NOT EXISTS released_at timestamptz,
  ADD COLUMN IF NOT EXISTS resolution_reason text;

UPDATE public.seller_credit_reservations
SET reserved_at = created_at
WHERE reserved_at IS NULL;

UPDATE public.seller_credit_reservations
SET committed_at = COALESCE(committed_at, updated_at, created_at)
WHERE status = 'committed' AND committed_at IS NULL;

UPDATE public.seller_credit_reservations
SET released_at = COALESCE(released_at, updated_at, created_at)
WHERE status = 'released' AND released_at IS NULL;

ALTER TABLE public.seller_credit_reservations
  DROP CONSTRAINT IF EXISTS seller_credit_reservations_terminal_chk;

ALTER TABLE public.seller_credit_reservations
  ADD CONSTRAINT seller_credit_reservations_terminal_chk CHECK (
    (status = 'held' AND committed_at IS NULL AND released_at IS NULL)
    OR (status = 'committed' AND committed_at IS NOT NULL AND released_at IS NULL)
    OR (status = 'released' AND released_at IS NOT NULL AND committed_at IS NULL)
  );

CREATE OR REPLACE FUNCTION public.seller_credit_setting(p_key text)
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT NULLIF(btrim(value), '')
  FROM public.seller_credit_settings
  WHERE key = p_key;
$$;

CREATE OR REPLACE FUNCTION public.seller_credit_customer_reason(p_event_type text)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE
    WHEN p_event_type = 'ORDER_COMPLETED'
      THEN 'SELLER_CREDIT_INSUFFICIENT: This seller is currently unavailable for new orders.'
    ELSE 'SELLER_CREDIT_INSUFFICIENT: This seller is currently unavailable for new requests.'
  END;
$$;

CREATE OR REPLACE FUNCTION public.seller_credit_health_for(p_available numeric)
RETURNS text
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
  v_low numeric;
  v_healthy numeric;
BEGIN
  SELECT value INTO v_low FROM public.seller_credit_thresholds WHERE key = 'low_min';
  SELECT value INTO v_healthy FROM public.seller_credit_thresholds WHERE key = 'healthy_min';

  IF p_available <= 0 THEN
    RETURN 'exhausted';
  END IF;
  IF v_low IS NOT NULL AND p_available < v_low THEN
    RETURN 'critical';
  END IF;
  IF v_healthy IS NOT NULL AND p_available < v_healthy THEN
    RETURN 'low';
  END IF;
  RETURN 'healthy';
END;
$$;

CREATE OR REPLACE FUNCTION public.seller_credit_format_inr(p_amount numeric)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT '₹' || trim(to_char(COALESCE(p_amount, 0), 'FM999999990.00'));
$$;

CREATE OR REPLACE FUNCTION public.seller_credit_booking_when(p_date date, p_time time)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE
    WHEN p_date IS NULL THEN NULL
    ELSE to_char(p_date, 'DD Mon YYYY')
      || CASE WHEN p_time IS NULL THEN '' ELSE ', ' || to_char(p_time, 'HH12:MI AM') END
  END;
$$;

CREATE OR REPLACE FUNCTION public.seller_credit_can_accept(
  p_seller_id uuid,
  p_event_type text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_rule record;
  v_acct public.seller_credit_accounts;
BEGIN
  SELECT * INTO v_rule FROM public.seller_credit_rule(p_event_type);
  IF NOT COALESCE(v_rule.enabled, false) OR COALESCE(v_rule.amount, 0) <= 0 THEN
    RETURN jsonb_build_object('ok', true, 'gated', false, 'required', 0, 'available', 0);
  END IF;

  v_acct := public.seller_credit_ensure_account(p_seller_id);
  RETURN jsonb_build_object(
    'ok', v_acct.available >= v_rule.amount,
    'gated', true,
    'required', v_rule.amount,
    'available', v_acct.available,
    'reason', CASE
      WHEN v_acct.available >= v_rule.amount THEN NULL
      ELSE public.seller_credit_customer_reason(p_event_type)
    END
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.record_seller_billable_event(
  p_seller_id uuid,
  p_event_type text,
  p_reference_type text,
  p_reference_id text,
  p_mode text,
  p_description text DEFAULT NULL,
  p_created_by uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_rule record;
  v_acct public.seller_credit_accounts;
  v_res public.seller_credit_reservations;
  v_health text;
  v_old_health text;
BEGIN
  IF p_mode NOT IN ('charge', 'reserve', 'commit', 'release') THEN
    RAISE EXCEPTION 'invalid credit mode';
  END IF;

  SELECT * INTO v_rule FROM public.seller_credit_rule(p_event_type);
  IF p_mode IN ('charge', 'reserve')
     AND (NOT COALESCE(v_rule.enabled, false) OR COALESCE(v_rule.amount, 0) <= 0) THEN
    RETURN jsonb_build_object('ok', true, 'skipped', true, 'reason', 'disabled');
  END IF;

  v_acct := public.seller_credit_ensure_account(p_seller_id);
  v_old_health := v_acct.last_health;

  IF p_mode = 'charge' THEN
    IF EXISTS (
      SELECT 1 FROM public.seller_credit_ledger
      WHERE type = 'event_charge'
        AND event_type = p_event_type
        AND reference_type = p_reference_type
        AND reference_id = p_reference_id
    ) THEN
      RETURN jsonb_build_object('ok', true, 'idempotent', true);
    END IF;
    IF v_acct.available < v_rule.amount THEN
      RAISE EXCEPTION '%', public.seller_credit_customer_reason(p_event_type);
    END IF;
    UPDATE public.seller_credit_accounts
    SET available = available - v_rule.amount,
        lifetime_consumed = lifetime_consumed + v_rule.amount,
        updated_at = now()
    WHERE seller_id = p_seller_id
    RETURNING * INTO v_acct;
    INSERT INTO public.seller_credit_ledger(
      seller_id, type, event_type, amount, configured_price, charged_amount,
      balance_after, reference_type, reference_id, description, created_by
    ) VALUES (
      p_seller_id, 'event_charge', p_event_type, -v_rule.amount, v_rule.amount, v_rule.amount,
      v_acct.available, p_reference_type, p_reference_id,
      COALESCE(p_description, public.seller_credit_format_inr(v_rule.amount) || ' charged'),
      p_created_by
    );

  ELSIF p_mode = 'reserve' THEN
    IF EXISTS (
      SELECT 1 FROM public.seller_credit_reservations
      WHERE event_type = p_event_type
        AND reference_type = p_reference_type
        AND reference_id = p_reference_id
        AND status IN ('held', 'committed')
    ) THEN
      RETURN jsonb_build_object('ok', true, 'idempotent', true);
    END IF;
    IF v_acct.available < v_rule.amount THEN
      RAISE EXCEPTION '%', public.seller_credit_customer_reason(p_event_type);
    END IF;
    UPDATE public.seller_credit_accounts
    SET available = available - v_rule.amount,
        reserved = reserved + v_rule.amount,
        updated_at = now()
    WHERE seller_id = p_seller_id
    RETURNING * INTO v_acct;
    INSERT INTO public.seller_credit_reservations(
      seller_id, event_type, reference_type, reference_id, amount, configured_price,
      status, reserved_at, resolution_reason
    ) VALUES (
      p_seller_id, p_event_type, p_reference_type, p_reference_id, v_rule.amount, v_rule.amount,
      'held', now(), NULL
    );
    INSERT INTO public.seller_credit_ledger(
      seller_id, type, event_type, amount, configured_price, charged_amount,
      balance_after, reference_type, reference_id, description, created_by
    ) VALUES (
      p_seller_id, 'reservation', p_event_type, -v_rule.amount, v_rule.amount, 0,
      v_acct.available, p_reference_type, p_reference_id,
      COALESCE(p_description, public.seller_credit_format_inr(v_rule.amount) || ' reserved'),
      p_created_by
    );

  ELSIF p_mode = 'commit' THEN
    SELECT * INTO v_res
    FROM public.seller_credit_reservations
    WHERE event_type = p_event_type
      AND reference_type = p_reference_type
      AND reference_id = p_reference_id
      AND status = 'held'
    FOR UPDATE;
    IF NOT FOUND THEN
      RETURN jsonb_build_object('ok', true, 'skipped', true, 'reason', 'no_reservation');
    END IF;
    IF EXISTS (
      SELECT 1 FROM public.seller_credit_ledger
      WHERE type = 'event_charge'
        AND event_type = p_event_type
        AND reference_type = p_reference_type
        AND reference_id = p_reference_id
    ) THEN
      RETURN jsonb_build_object('ok', true, 'idempotent', true);
    END IF;
    UPDATE public.seller_credit_reservations
    SET status = 'committed',
        committed_at = now(),
        released_at = NULL,
        resolution_reason = COALESCE(p_description, 'committed'),
        updated_at = now()
    WHERE id = v_res.id;
    UPDATE public.seller_credit_accounts
    SET reserved = reserved - v_res.amount,
        lifetime_consumed = lifetime_consumed + v_res.amount,
        updated_at = now()
    WHERE seller_id = p_seller_id
    RETURNING * INTO v_acct;
    INSERT INTO public.seller_credit_ledger(
      seller_id, type, event_type, amount, configured_price, charged_amount,
      balance_after, reference_type, reference_id, description, created_by
    ) VALUES (
      p_seller_id, 'event_charge', p_event_type, -v_res.amount, v_res.configured_price, v_res.amount,
      v_acct.available, p_reference_type, p_reference_id,
      COALESCE(p_description, public.seller_credit_format_inr(v_res.amount) || ' charged'),
      p_created_by
    );

  ELSIF p_mode = 'release' THEN
    SELECT * INTO v_res
    FROM public.seller_credit_reservations
    WHERE event_type = p_event_type
      AND reference_type = p_reference_type
      AND reference_id = p_reference_id
      AND status = 'held'
    FOR UPDATE;
    IF NOT FOUND THEN
      RETURN jsonb_build_object('ok', true, 'skipped', true, 'reason', 'no_reservation');
    END IF;
    UPDATE public.seller_credit_reservations
    SET status = 'released',
        released_at = now(),
        committed_at = NULL,
        resolution_reason = COALESCE(p_description, 'released'),
        updated_at = now()
    WHERE id = v_res.id;
    UPDATE public.seller_credit_accounts
    SET reserved = reserved - v_res.amount,
        available = available + v_res.amount,
        updated_at = now()
    WHERE seller_id = p_seller_id
    RETURNING * INTO v_acct;
    INSERT INTO public.seller_credit_ledger(
      seller_id, type, event_type, amount, configured_price, charged_amount,
      balance_after, reference_type, reference_id, description, created_by
    ) VALUES (
      p_seller_id, 'reservation_release', p_event_type, v_res.amount, v_res.configured_price, 0,
      v_acct.available, p_reference_type, p_reference_id,
      COALESCE(p_description, public.seller_credit_format_inr(v_res.amount) || ' reservation released'),
      p_created_by
    );
  END IF;

  v_health := public.seller_credit_health_for(v_acct.available);
  UPDATE public.seller_credit_accounts
  SET last_health = v_health, updated_at = now()
  WHERE seller_id = p_seller_id;
  PERFORM public.seller_credit_maybe_notify_health(p_seller_id, v_old_health, v_health, v_acct.available);

  RETURN jsonb_build_object('ok', true, 'available', v_acct.available, 'reserved', v_acct.reserved);
END;
$$;

CREATE OR REPLACE FUNCTION public.seller_credit_apply_booking_outcome(
  p_seller_id uuid,
  p_order_id uuid,
  p_outcome text,
  p_description text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_policy text;
BEGIN
  IF p_outcome = 'reserve' THEN
    RETURN public.record_seller_billable_event(
      p_seller_id, 'SERVICE_BOOKING', 'order', p_order_id::text, 'reserve', p_description, NULL
    );
  ELSIF p_outcome = 'commit' THEN
    RETURN public.record_seller_billable_event(
      p_seller_id, 'SERVICE_BOOKING', 'order', p_order_id::text, 'commit', p_description, NULL
    );
  ELSIF p_outcome = 'release' THEN
    RETURN public.record_seller_billable_event(
      p_seller_id, 'SERVICE_BOOKING', 'order', p_order_id::text, 'release', p_description, NULL
    );
  ELSIF p_outcome = 'no_show' THEN
    v_policy := public.seller_credit_setting('buyer_no_show_policy');
    IF v_policy = 'release' THEN
      RETURN public.record_seller_billable_event(
        p_seller_id, 'SERVICE_BOOKING', 'order', p_order_id::text, 'release',
        COALESCE(p_description, 'Buyer no-show — reservation released'), NULL
      );
    ELSIF v_policy = 'charge' THEN
      RETURN public.record_seller_billable_event(
        p_seller_id, 'SERVICE_BOOKING', 'order', p_order_id::text, 'commit',
        COALESCE(p_description, 'Buyer no-show — reserved credits committed'), NULL
      );
    END IF;
    RETURN jsonb_build_object('ok', true, 'skipped', true, 'reason', 'buyer_no_show_policy_unset');
  END IF;
  RETURN jsonb_build_object('ok', false, 'reason', 'unknown_outcome');
END;
$$;

CREATE OR REPLACE FUNCTION public.seller_credit_on_order_insert()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_event text;
  v_gate jsonb;
BEGIN
  IF NEW.seller_id IS NULL THEN
    RETURN NEW;
  END IF;
  v_event := public.seller_credit_event_for_order(NEW);
  IF v_event = 'ENQUIRY_CREATED' THEN
    PERFORM public.record_seller_billable_event(
      NEW.seller_id, v_event, 'order', NEW.id::text, 'charge',
      'New enquiry delivered to seller', NEW.buyer_id
    );
  ELSIF v_event = 'SERVICE_BOOKING' THEN
    v_gate := public.seller_credit_can_accept(NEW.seller_id, v_event);
    IF COALESCE((v_gate->>'ok')::boolean, false) IS NOT TRUE THEN
      RAISE EXCEPTION '%', COALESCE(v_gate->>'reason', public.seller_credit_customer_reason(v_event));
    END IF;
  ELSE
    PERFORM public.record_seller_billable_event(
      NEW.seller_id, v_event, 'order', NEW.id::text, 'reserve',
      'Reserved for successful order', NEW.buyer_id
    );
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.seller_credit_on_order_status()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_event text;
BEGIN
  IF NEW.status IS NOT DISTINCT FROM OLD.status OR NEW.seller_id IS NULL THEN
    RETURN NEW;
  END IF;
  v_event := public.seller_credit_event_for_order(NEW);
  IF v_event = 'ENQUIRY_CREATED' THEN
    RETURN NEW;
  END IF;
  IF v_event = 'SERVICE_BOOKING' THEN
    IF NEW.status IN ('completed', 'delivered', 'buyer_received') THEN
      PERFORM public.seller_credit_apply_booking_outcome(
        NEW.seller_id, NEW.id, 'commit', 'Service booking completed'
      );
    ELSIF NEW.status IN ('cancelled', 'rejected', 'failed', 'returned') THEN
      PERFORM public.seller_credit_apply_booking_outcome(
        NEW.seller_id, NEW.id, 'release', 'Booking reservation released — cancelled'
      );
    ELSIF NEW.status = 'no_show' THEN
      PERFORM public.seller_credit_apply_booking_outcome(
        NEW.seller_id, NEW.id, 'no_show', NULL
      );
    END IF;
    RETURN NEW;
  END IF;
  IF NEW.status IN ('completed', 'delivered', 'buyer_received') THEN
    PERFORM public.record_seller_billable_event(
      NEW.seller_id, v_event, 'order', NEW.id::text, 'commit',
      'Successful order', NULL
    );
  ELSIF NEW.status IN ('cancelled', 'rejected', 'failed', 'returned') THEN
    PERFORM public.record_seller_billable_event(
      NEW.seller_id, v_event, 'order', NEW.id::text, 'release',
      'Order reservation released', NULL
    );
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.seller_credit_on_service_booking()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_when text;
  v_short text;
  v_gate jsonb;
BEGIN
  IF NEW.seller_id IS NULL OR NEW.order_id IS NULL THEN
    RETURN NEW;
  END IF;
  v_short := upper(left(replace(NEW.id::text, '-', ''), 8));
  v_when := public.seller_credit_booking_when(NEW.booking_date, NEW.start_time);

  IF TG_OP = 'INSERT' THEN
    IF NEW.status IN ('confirmed', 'scheduled', 'in_progress') THEN
      PERFORM public.seller_credit_apply_booking_outcome(
        NEW.seller_id, NEW.order_id, 'reserve',
        public.seller_credit_format_inr((SELECT amount FROM public.seller_credit_rule('SERVICE_BOOKING')))
          || ' reserved for Booking #' || v_short
          || COALESCE(' · Appointment: ' || v_when, '')
      );
    ELSIF NEW.status IN ('requested', 'pending') THEN
      v_gate := public.seller_credit_can_accept(NEW.seller_id, 'SERVICE_BOOKING');
      IF COALESCE((v_gate->>'ok')::boolean, false) IS NOT TRUE THEN
        RAISE EXCEPTION '%', COALESCE(v_gate->>'reason', public.seller_credit_customer_reason('SERVICE_BOOKING'));
      END IF;
    END IF;
    RETURN NEW;
  END IF;

  IF NEW.status IS NOT DISTINCT FROM OLD.status THEN
    RETURN NEW;
  END IF;

  IF NEW.status IN ('confirmed', 'scheduled', 'in_progress')
     AND OLD.status NOT IN ('confirmed', 'scheduled', 'in_progress', 'completed', 'delivered', 'buyer_received') THEN
    PERFORM public.seller_credit_apply_booking_outcome(
      NEW.seller_id, NEW.order_id, 'reserve',
      public.seller_credit_format_inr((SELECT amount FROM public.seller_credit_rule('SERVICE_BOOKING')))
        || ' reserved for Booking #' || v_short
        || COALESCE(' · Appointment: ' || v_when, '')
    );
  ELSIF NEW.status IN ('completed', 'delivered', 'buyer_received') THEN
    PERFORM public.seller_credit_apply_booking_outcome(
      NEW.seller_id, NEW.order_id, 'commit',
      'Charged for completed Booking #' || v_short
    );
  ELSIF NEW.status IN ('cancelled', 'rejected', 'failed', 'returned') THEN
    PERFORM public.seller_credit_apply_booking_outcome(
      NEW.seller_id, NEW.order_id, 'release',
      'Booking reservation released · Booking #' || v_short || ' · Cancelled'
    );
  ELSIF NEW.status = 'no_show' THEN
    PERFORM public.seller_credit_apply_booking_outcome(
      NEW.seller_id, NEW.order_id, 'no_show',
      'Booking #' || v_short || ' buyer no-show'
    );
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_seller_credit_on_service_booking ON public.service_bookings;
CREATE TRIGGER trg_seller_credit_on_service_booking
AFTER INSERT OR UPDATE OF status ON public.service_bookings
FOR EACH ROW
EXECUTE FUNCTION public.seller_credit_on_service_booking();

CREATE OR REPLACE FUNCTION public.resolve_due_seller_credit_bookings()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_grace_text text;
  v_grace int;
  v_row record;
  v_committed int := 0;
  v_released int := 0;
  v_held int := 0;
  v_skipped_grace int := 0;
  v_short text;
BEGIN
  v_grace_text := public.seller_credit_setting('booking_resolution_grace_minutes');
  IF v_grace_text IS NOT NULL AND v_grace_text ~ '^[0-9]+$' THEN
    v_grace := v_grace_text::int;
  END IF;

  FOR v_row IN
    SELECT
      r.id,
      r.seller_id,
      r.reference_id,
      r.amount,
      o.status AS order_status,
      sb.id AS booking_id,
      sb.status AS booking_status,
      sb.booking_date,
      sb.start_time
    FROM public.seller_credit_reservations r
    JOIN public.orders o ON o.id::text = r.reference_id
    LEFT JOIN public.service_bookings sb ON sb.order_id = o.id
    WHERE r.event_type = 'SERVICE_BOOKING'
      AND r.status = 'held'
    FOR UPDATE OF r
  LOOP
    v_short := upper(left(replace(COALESCE(v_row.booking_id::text, v_row.reference_id), '-', ''), 8));

    IF v_row.order_status IN ('cancelled', 'rejected', 'failed', 'returned')
       OR v_row.booking_status IN ('cancelled', 'rejected', 'failed', 'returned') THEN
      PERFORM public.seller_credit_apply_booking_outcome(
        v_row.seller_id, v_row.reference_id::uuid, 'release',
        'Booking reservation released · Booking #' || v_short || ' · Cancelled'
      );
      v_released := v_released + 1;
    ELSIF v_row.order_status = 'no_show' OR v_row.booking_status = 'no_show' THEN
      PERFORM public.seller_credit_apply_booking_outcome(
        v_row.seller_id, v_row.reference_id::uuid, 'no_show',
        'Booking #' || v_short || ' buyer no-show'
      );
      v_held := v_held + 1;
    ELSIF v_row.order_status IN ('completed', 'delivered', 'buyer_received')
       OR v_row.booking_status IN ('completed', 'delivered', 'buyer_received') THEN
      PERFORM public.seller_credit_apply_booking_outcome(
        v_row.seller_id, v_row.reference_id::uuid, 'commit',
        'Charged for completed Booking #' || v_short
      );
      v_committed := v_committed + 1;
    ELSIF v_grace IS NULL OR v_row.booking_date IS NULL OR v_row.start_time IS NULL THEN
      v_skipped_grace := v_skipped_grace + 1;
    ELSIF now() >= (
      ((v_row.booking_date + v_row.start_time) AT TIME ZONE 'Asia/Kolkata')
      + make_interval(mins => v_grace)
    ) THEN
      PERFORM public.seller_credit_apply_booking_outcome(
        v_row.seller_id, v_row.reference_id::uuid, 'commit',
        'Charged for completed Booking #' || v_short
          || ' · Auto-resolved after appointment'
      );
      v_committed := v_committed + 1;
    ELSE
      v_held := v_held + 1;
    END IF;
  END LOOP;

  RETURN jsonb_build_object(
    'ok', true,
    'committed', v_committed,
    'released', v_released,
    'still_held', v_held,
    'waiting_for_grace_config_or_time', v_skipped_grace,
    'grace_minutes', v_grace
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.create_service_booking_atomic(
  _seller_id uuid,
  _product_id uuid,
  _slot_id uuid,
  _booking_date text,
  _start_time text,
  _end_time text,
  _total_amount numeric,
  _product_name text,
  _unit_price numeric,
  _idempotency_key text,
  _notes text DEFAULT NULL,
  _buyer_address text DEFAULT NULL,
  _location_type text DEFAULT 'at_seller',
  _fulfillment_type text DEFAULT NULL,
  _addons jsonb DEFAULT '[]'::jsonb,
  _recurring jsonb DEFAULT NULL
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  _caller uuid := auth.uid();
  _order_id uuid;
  _booking_id uuid;
  _slot_result json;
  _addon jsonb;
  _existing_order uuid;
  _seller_user uuid;
  _gate jsonb;
BEGIN
  IF _caller IS NULL THEN
    RETURN json_build_object('success', false, 'error', 'Not authenticated');
  END IF;

  IF EXISTS (SELECT 1 FROM seller_profiles WHERE id = _seller_id AND user_id = _caller) THEN
    RETURN json_build_object('success', false, 'error', 'Cannot book your own service');
  END IF;

  _gate := public.seller_credit_can_accept(_seller_id, 'SERVICE_BOOKING');
  IF COALESCE((_gate->>'ok')::boolean, false) IS NOT TRUE THEN
    RETURN json_build_object('success', false, 'error', COALESCE(_gate->>'reason', public.seller_credit_customer_reason('SERVICE_BOOKING')));
  END IF;

  SELECT id INTO _existing_order
  FROM orders
  WHERE buyer_id = _caller AND idempotency_key = _idempotency_key
  LIMIT 1;

  IF _existing_order IS NOT NULL THEN
    SELECT id INTO _booking_id FROM service_bookings WHERE order_id = _existing_order LIMIT 1;
    RETURN json_build_object(
      'success', true,
      'order_id', _existing_order,
      'booking_id', _booking_id,
      'idempotent', true
    );
  END IF;

  INSERT INTO orders (
    buyer_id, seller_id, total_amount, order_type, status,
    payment_type, payment_status, transaction_type, idempotency_key,
    notes, delivery_address, fulfillment_type
  ) VALUES (
    _caller, _seller_id, _total_amount, 'booking', 'confirmed',
    'cod', 'pending', 'service_booking', _idempotency_key,
    NULLIF(LEFT(COALESCE(_notes, ''), 500), ''),
    NULLIF(LEFT(COALESCE(_buyer_address, ''), 300), ''),
    COALESCE(_fulfillment_type, _location_type, 'at_seller')
  )
  RETURNING id INTO _order_id;

  INSERT INTO order_items (order_id, product_id, product_name, quantity, unit_price)
  VALUES (_order_id, _product_id, _product_name, 1, _unit_price);

  _slot_result := public.book_service_slot(
    _order_id, _slot_id, _caller, _seller_id, _product_id,
    _booking_date, _start_time, _end_time,
    COALESCE(_location_type, 'at_seller'),
    NULLIF(LEFT(COALESCE(_buyer_address, ''), 300), ''),
    NULLIF(LEFT(COALESCE(_notes, ''), 500), '')
  );

  IF COALESCE((_slot_result->>'success')::boolean, false) IS NOT TRUE THEN
    UPDATE orders SET status = 'cancelled', notes = COALESCE(notes, '') || ' [booking_setup_failed]'
    WHERE id = _order_id;
    RETURN json_build_object(
      'success', false,
      'error', COALESCE(_slot_result->>'error', 'Failed to book slot'),
      'order_id', _order_id
    );
  END IF;

  _booking_id := (_slot_result->>'booking_id')::uuid;

  IF _addons IS NOT NULL AND jsonb_typeof(_addons) = 'array' THEN
    FOR _addon IN SELECT * FROM jsonb_array_elements(_addons)
    LOOP
      INSERT INTO service_booking_addons (booking_id, addon_id, addon_name, addon_price)
      VALUES (
        _booking_id,
        NULLIF(_addon->>'id', '')::uuid,
        COALESCE(_addon->>'name', 'Add-on'),
        COALESCE((_addon->>'price')::numeric, 0)
      );
    END LOOP;
  END IF;

  IF _recurring IS NOT NULL AND COALESCE((_recurring->>'enabled')::boolean, false) THEN
    INSERT INTO service_recurring_configs (
      booking_id, buyer_id, seller_id, product_id,
      frequency, preferred_time, start_date, end_date, day_of_week
    ) VALUES (
      _booking_id, _caller, _seller_id, _product_id,
      COALESCE(_recurring->>'frequency', 'weekly'),
      _start_time::time,
      _booking_date::date,
      NULLIF(_recurring->>'endDate', '')::date,
      COALESCE((_recurring->>'dayOfWeek')::int, EXTRACT(DOW FROM _booking_date::date)::int)
    );
  END IF;

  SELECT user_id INTO _seller_user FROM seller_profiles WHERE id = _seller_id;
  IF _seller_user IS NOT NULL THEN
    INSERT INTO notification_queue (user_id, type, title, body, reference_path, payload)
    VALUES (
      _seller_user,
      'order',
      'New Booking Confirmed',
      'A customer booked ' || _product_name || ' on ' || _booking_date || ' at ' || LEFT(_start_time, 5),
      '/orders/' || _order_id::text,
      jsonb_build_object('orderId', _order_id, 'status', 'confirmed', 'type', 'order')
    );
  END IF;

  RETURN json_build_object(
    'success', true,
    'order_id', _order_id,
    'booking_id', _booking_id,
    'idempotent', false
  );
EXCEPTION WHEN unique_violation THEN
  SELECT id INTO _existing_order
  FROM orders WHERE buyer_id = _caller AND idempotency_key = _idempotency_key LIMIT 1;
  IF _existing_order IS NOT NULL THEN
    SELECT id INTO _booking_id FROM service_bookings WHERE order_id = _existing_order LIMIT 1;
    RETURN json_build_object('success', true, 'order_id', _existing_order, 'booking_id', _booking_id, 'idempotent', true);
  END IF;
  RETURN json_build_object('success', false, 'error', SQLERRM);
WHEN OTHERS THEN
  RETURN json_build_object('success', false, 'error', SQLERRM);
END;
$$;

CREATE OR REPLACE FUNCTION public.get_seller_credit_summary(
  p_seller_ids uuid[]
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
BEGIN
  IF p_seller_ids IS NULL OR array_length(p_seller_ids, 1) IS NULL THEN
    RAISE EXCEPTION 'seller ids required';
  END IF;
  IF NOT public.is_admin(v_uid) AND EXISTS (
    SELECT 1
    FROM unnest(p_seller_ids) requested(id)
    LEFT JOIN public.seller_profiles sp ON sp.id = requested.id AND sp.user_id = v_uid
    WHERE sp.id IS NULL
  ) THEN
    RAISE EXCEPTION 'seller scope forbidden';
  END IF;

  PERFORM public.seller_credit_ensure_account(sid)
  FROM unnest(p_seller_ids) sid;

  RETURN (
    SELECT jsonb_build_object(
      'available', COALESCE(SUM(a.available), 0),
      'reserved', COALESCE(SUM(a.reserved), 0),
      'lifetime_purchased', COALESCE(SUM(a.lifetime_purchased), 0),
      'lifetime_consumed', COALESCE(SUM(a.lifetime_consumed), 0),
      'lifetime_adjusted', COALESCE(SUM(a.lifetime_adjusted), 0),
      'used_this_month', COALESCE((
        SELECT SUM(ABS(l.charged_amount))
        FROM public.seller_credit_ledger l
        WHERE l.seller_id = ANY(p_seller_ids)
          AND l.type = 'event_charge'
          AND l.created_at >= date_trunc('month', now())
      ), 0),
      'orders_this_month', COALESCE((
        SELECT COUNT(*) FROM public.seller_credit_ledger l
        WHERE l.seller_id = ANY(p_seller_ids) AND l.type = 'event_charge'
          AND l.event_type = 'ORDER_COMPLETED'
          AND l.created_at >= date_trunc('month', now())
      ), 0),
      'enquiries_this_month', COALESCE((
        SELECT COUNT(*) FROM public.seller_credit_ledger l
        WHERE l.seller_id = ANY(p_seller_ids) AND l.type = 'event_charge'
          AND l.event_type = 'ENQUIRY_CREATED'
          AND l.created_at >= date_trunc('month', now())
      ), 0),
      'bookings_this_month', COALESCE((
        SELECT COUNT(*) FROM public.seller_credit_ledger l
        WHERE l.seller_id = ANY(p_seller_ids) AND l.type = 'event_charge'
          AND l.event_type = 'SERVICE_BOOKING'
          AND l.created_at >= date_trunc('month', now())
      ), 0),
      'contacts_this_month', COALESCE((
        SELECT COUNT(*) FROM public.seller_credit_ledger l
        WHERE l.seller_id = ANY(p_seller_ids) AND l.type = 'event_charge'
          AND l.event_type = 'CONTACT_REQUEST'
          AND l.created_at >= date_trunc('month', now())
      ), 0),
      'spend_enabled', public.seller_credit_flag_enabled('seller_credit_spend_enabled'),
      'purchase_enabled', public.seller_credit_flag_enabled('seller_credit_purchase_enabled'),
      'healthy_min', (SELECT value FROM public.seller_credit_thresholds WHERE key = 'healthy_min'),
      'low_min', (SELECT value FROM public.seller_credit_thresholds WHERE key = 'low_min')
    )
    FROM public.seller_credit_accounts a
    WHERE a.seller_id = ANY(p_seller_ids)
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.get_seller_credit_activity(
  p_seller_ids uuid[],
  p_limit integer DEFAULT 50
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
BEGIN
  IF NOT public.is_admin(v_uid) AND EXISTS (
    SELECT 1
    FROM unnest(p_seller_ids) requested(id)
    LEFT JOIN public.seller_profiles sp ON sp.id = requested.id AND sp.user_id = v_uid
    WHERE sp.id IS NULL
  ) THEN
    RAISE EXCEPTION 'seller scope forbidden';
  END IF;

  RETURN COALESCE((
    SELECT jsonb_agg(to_jsonb(l) ORDER BY l.created_at DESC)
    FROM (
      SELECT
        led.id,
        led.seller_id,
        led.type,
        led.event_type,
        led.amount,
        led.configured_price,
        led.charged_amount,
        led.balance_after,
        led.reference_type,
        led.reference_id,
        led.description,
        led.status,
        led.created_at,
        o.id AS order_id,
        o.status AS order_status,
        oi.product_name,
        sb.id AS booking_id,
        sb.booking_date,
        sb.start_time,
        CASE
          WHEN led.reference_id IS NULL THEN NULL
          ELSE upper(left(replace(led.reference_id, '-', ''), 8))
        END AS reference_short
      FROM public.seller_credit_ledger led
      LEFT JOIN public.orders o
        ON led.reference_type = 'order' AND o.id::text = led.reference_id
      LEFT JOIN LATERAL (
        SELECT product_name
        FROM public.order_items
        WHERE order_id = o.id
        ORDER BY id
        LIMIT 1
      ) oi ON true
      LEFT JOIN public.service_bookings sb ON sb.order_id = o.id
      WHERE led.seller_id = ANY(p_seller_ids)
      ORDER BY led.created_at DESC
      LIMIT GREATEST(COALESCE(p_limit, 50), 1)
    ) l
  ), '[]'::jsonb);
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_update_seller_credit_setting(
  p_key text,
  p_value text,
  p_reason text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.is_admin(auth.uid()) THEN
    RAISE EXCEPTION 'admin only';
  END IF;
  IF p_key NOT IN ('booking_resolution_grace_minutes', 'buyer_no_show_policy') THEN
    RAISE EXCEPTION 'unknown credit setting';
  END IF;
  IF p_key = 'booking_resolution_grace_minutes'
     AND NULLIF(btrim(COALESCE(p_value, '')), '') IS NOT NULL
     AND p_value !~ '^[0-9]+$' THEN
    RAISE EXCEPTION 'grace minutes must be a whole number';
  END IF;
  IF p_key = 'buyer_no_show_policy'
     AND NULLIF(btrim(COALESCE(p_value, '')), '') IS NOT NULL
     AND p_value NOT IN ('charge', 'release') THEN
    RAISE EXCEPTION 'buyer no-show policy must be charge or release';
  END IF;

  INSERT INTO public.seller_credit_settings(key, value, updated_by, updated_at)
  VALUES (p_key, NULLIF(btrim(p_value), ''), auth.uid(), now())
  ON CONFLICT (key) DO UPDATE
  SET value = EXCLUDED.value,
      updated_by = auth.uid(),
      updated_at = now();

  INSERT INTO public.seller_billing_rule_audit(
    event_type, reason, admin_id
  ) VALUES (
    'SETTING:' || p_key,
    COALESCE(NULLIF(trim(p_reason), ''), 'Updated ' || p_key || ' to ' || COALESCE(p_value, 'unset')),
    auth.uid()
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_list_seller_credit_settings()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.is_admin(auth.uid()) THEN
    RAISE EXCEPTION 'admin only';
  END IF;
  RETURN COALESCE((
    SELECT jsonb_agg(jsonb_build_object(
      'key', s.key,
      'value', s.value,
      'updated_by', s.updated_by,
      'updated_at', s.updated_at
    ) ORDER BY s.key)
    FROM public.seller_credit_settings s
  ), '[]'::jsonb);
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_list_seller_billing_audit(p_limit integer DEFAULT 40)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.is_admin(auth.uid()) THEN
    RAISE EXCEPTION 'admin only';
  END IF;
  RETURN COALESCE((
    SELECT jsonb_agg(to_jsonb(a) ORDER BY a.created_at DESC)
    FROM (
      SELECT id, event_type, old_amount, new_amount, old_enabled, new_enabled, reason, admin_id, created_at
      FROM public.seller_billing_rule_audit
      ORDER BY created_at DESC
      LIMIT GREATEST(COALESCE(p_limit, 40), 1)
    ) a
  ), '[]'::jsonb);
END;
$$;

GRANT EXECUTE ON FUNCTION public.seller_credit_can_accept(uuid, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_seller_credit_summary(uuid[]) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_seller_credit_activity(uuid[], integer) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.admin_update_seller_credit_setting(text, text, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.admin_list_seller_credit_settings() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.admin_list_seller_billing_audit(integer) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.resolve_due_seller_credit_bookings() TO service_role;
GRANT EXECUTE ON FUNCTION public.create_service_booking_atomic(uuid, uuid, uuid, text, text, text, numeric, text, numeric, text, text, text, text, text, jsonb, jsonb) TO authenticated;

REVOKE ALL ON FUNCTION public.resolve_due_seller_credit_bookings() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.record_seller_billable_event(uuid, text, text, text, text, text, uuid) FROM PUBLIC, anon, authenticated;

DO $$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT jobid FROM cron.job WHERE jobname = 'resolve_seller_credit_bookings_every_5m'
  LOOP
    PERFORM cron.unschedule(r.jobid);
  END LOOP;
END $$;

SELECT cron.schedule(
  'resolve_seller_credit_bookings_every_5m',
  '*/5 * * * *',
  $cron$SELECT public.resolve_due_seller_credit_bookings();$cron$
);
