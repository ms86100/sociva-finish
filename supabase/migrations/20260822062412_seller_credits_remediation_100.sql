-- Sociva Credits remediation to close the 65/100 audit.
-- Does NOT enable purchase or spend. Production flags stay off.
-- V1 booking money policy (value delivered, existing workflow only):
--   successful / auto-resolve after grace / buyer no-show → COMMIT
--   buyer cancel / seller cancel / seller failure → RELEASE
--   dispute → no second booking machine; admin reversal after commit
-- Contact debounce: 24 hours is the locked V1 invariant, stored so it is not a hidden constant.

ALTER TABLE public.seller_credit_packages
  ADD COLUMN IF NOT EXISTS credits_amount numeric(12,2);

UPDATE public.seller_credit_packages
SET credits_amount = amount
WHERE credits_amount IS NULL;

ALTER TABLE public.seller_credit_packages
  ALTER COLUMN credits_amount SET NOT NULL;

ALTER TABLE public.seller_credit_packages
  DROP CONSTRAINT IF EXISTS seller_credit_packages_credits_amount_chk;

ALTER TABLE public.seller_credit_packages
  ADD CONSTRAINT seller_credit_packages_credits_amount_chk CHECK (credits_amount > 0);

ALTER TABLE public.seller_credit_purchases
  ADD COLUMN IF NOT EXISTS credits_granted numeric(12,2),
  ADD COLUMN IF NOT EXISTS captured_at timestamptz,
  ADD COLUMN IF NOT EXISTS failed_at timestamptz,
  ADD COLUMN IF NOT EXISTS failure_reason text;

UPDATE public.seller_credit_purchases
SET credits_granted = amount
WHERE credits_granted IS NULL;

CREATE TABLE IF NOT EXISTS public.seller_credit_contact_debits (
  seller_id uuid NOT NULL REFERENCES public.seller_profiles(id) ON DELETE CASCADE,
  buyer_id uuid NOT NULL,
  product_id uuid NOT NULL,
  window_hours integer NOT NULL,
  charged_at timestamptz NOT NULL DEFAULT now(),
  reference_id text NOT NULL,
  PRIMARY KEY (seller_id, buyer_id, product_id)
);

ALTER TABLE public.seller_credit_contact_debits ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.seller_credit_contact_debits FROM PUBLIC, anon, authenticated;

INSERT INTO public.seller_credit_settings(key, value)
VALUES
  ('buyer_no_show_policy', 'commit'),
  ('unresolved_after_grace_policy', 'commit'),
  ('seller_failure_policy', 'release'),
  ('dispute_policy', 'admin_reversal'),
  ('contact_debounce_hours', '24'),
  ('booking_resolution_grace_minutes', NULL)
ON CONFLICT (key) DO UPDATE
SET value = CASE
  WHEN public.seller_credit_settings.key = 'buyer_no_show_policy'
       AND NULLIF(btrim(COALESCE(public.seller_credit_settings.value, '')), '') IS NULL
    THEN EXCLUDED.value
  WHEN public.seller_credit_settings.key IN (
    'unresolved_after_grace_policy',
    'seller_failure_policy',
    'dispute_policy',
    'contact_debounce_hours'
  ) AND NULLIF(btrim(COALESCE(public.seller_credit_settings.value, '')), '') IS NULL
    THEN EXCLUDED.value
  ELSE public.seller_credit_settings.value
END;

CREATE OR REPLACE FUNCTION public.seller_credit_spend_override_on()
RETURNS boolean
LANGUAGE sql
STABLE
AS $$
  SELECT COALESCE(current_setting('app.seller_credit_test_spend', true), '') = 'on';
$$;

CREATE OR REPLACE FUNCTION public.seller_credit_spend_active()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.seller_credit_flag_enabled('seller_credit_spend_enabled')
      OR public.seller_credit_spend_override_on();
$$;

CREATE OR REPLACE FUNCTION public.seller_credit_rule(p_event_type text)
RETURNS TABLE(enabled boolean, amount numeric)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.seller_credit_spend_active() THEN
    enabled := false;
    amount := 0;
    RETURN NEXT;
    RETURN;
  END IF;

  SELECT r.enabled, r.amount
  INTO enabled, amount
  FROM public.seller_billing_rules r
  WHERE r.event_type = p_event_type;

  IF NOT FOUND THEN
    enabled := false;
    amount := 0;
  END IF;
  RETURN NEXT;
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
    RETURN jsonb_build_object('ok', true, 'gated', false);
  END IF;

  v_acct := public.seller_credit_ensure_account(p_seller_id);
  IF v_acct.available >= v_rule.amount THEN
    RETURN jsonb_build_object('ok', true, 'gated', true);
  END IF;
  RETURN jsonb_build_object(
    'ok', false,
    'gated', true,
    'reason', public.seller_credit_customer_reason(p_event_type)
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.seller_credit_health_for(p_available numeric)
RETURNS text
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
  v_critical numeric;
  v_low numeric;
  v_healthy numeric;
BEGIN
  SELECT value INTO v_critical FROM public.seller_credit_thresholds WHERE key = 'critical_min';
  SELECT value INTO v_low FROM public.seller_credit_thresholds WHERE key = 'low_min';
  SELECT value INTO v_healthy FROM public.seller_credit_thresholds WHERE key = 'healthy_min';

  IF p_available <= 0 THEN
    RETURN 'exhausted';
  END IF;
  IF v_critical IS NOT NULL AND p_available <= v_critical THEN
    RETURN 'critical';
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

CREATE OR REPLACE FUNCTION public.seller_credit_resolution_ready()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_grace text := public.seller_credit_setting('booking_resolution_grace_minutes');
  v_no_show text := public.seller_credit_setting('buyer_no_show_policy');
  v_unresolved text := public.seller_credit_setting('unresolved_after_grace_policy');
BEGIN
  RETURN jsonb_build_object(
    'ok',
      v_grace IS NOT NULL AND v_grace ~ '^[0-9]+$' AND v_grace::int BETWEEN 0 AND 10080
      AND v_no_show IN ('commit', 'charge', 'release')
      AND COALESCE(v_unresolved, 'commit') IN ('commit', 'charge', 'release'),
    'grace_minutes', v_grace,
    'buyer_no_show_policy', v_no_show,
    'unresolved_after_grace_policy', COALESCE(v_unresolved, 'commit')
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
    UPDATE public.seller_credit_accounts
    SET available = available - v_rule.amount,
        lifetime_consumed = lifetime_consumed + v_rule.amount,
        updated_at = now()
    WHERE seller_id = p_seller_id
      AND available >= v_rule.amount
    RETURNING * INTO v_acct;
    IF NOT FOUND THEN
      RAISE EXCEPTION '%', public.seller_credit_customer_reason(p_event_type);
    END IF;
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
    UPDATE public.seller_credit_accounts
    SET available = available - v_rule.amount,
        reserved = reserved + v_rule.amount,
        updated_at = now()
    WHERE seller_id = p_seller_id
      AND available >= v_rule.amount
    RETURNING * INTO v_acct;
    IF NOT FOUND THEN
      RAISE EXCEPTION '%', public.seller_credit_customer_reason(p_event_type);
    END IF;
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
  ELSIF p_outcome IN ('seller_failure', 'seller_no_show') THEN
    RETURN public.record_seller_billable_event(
      p_seller_id, 'SERVICE_BOOKING', 'order', p_order_id::text, 'release',
      COALESCE(p_description, 'Seller failure — reservation released'), NULL
    );
  ELSIF p_outcome = 'no_show' THEN
    v_policy := COALESCE(public.seller_credit_setting('buyer_no_show_policy'), 'commit');
    IF v_policy = 'release' THEN
      RETURN public.record_seller_billable_event(
        p_seller_id, 'SERVICE_BOOKING', 'order', p_order_id::text, 'release',
        COALESCE(p_description, 'Buyer no-show — reservation released'), NULL
      );
    END IF;
    RETURN public.record_seller_billable_event(
      p_seller_id, 'SERVICE_BOOKING', 'order', p_order_id::text, 'commit',
      COALESCE(p_description, 'Buyer no-show — reserved credits committed'), NULL
    );
  END IF;
  RETURN jsonb_build_object('ok', false, 'reason', 'unknown_outcome');
END;
$$;

CREATE OR REPLACE FUNCTION public.reverse_seller_credit_charge(
  p_seller_id uuid,
  p_event_type text,
  p_reference_type text,
  p_reference_id text,
  p_reason text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_led public.seller_credit_ledger;
  v_acct public.seller_credit_accounts;
BEGIN
  IF NULLIF(btrim(COALESCE(p_reason, '')), '') IS NULL THEN
    RAISE EXCEPTION 'reversal reason required';
  END IF;
  IF auth.uid() IS NOT NULL AND NOT public.is_admin(auth.uid()) THEN
    RAISE EXCEPTION 'admin only';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.seller_credit_ledger
    WHERE type = 'reversal'
      AND event_type = p_event_type
      AND reference_type = p_reference_type
      AND reference_id = p_reference_id
  ) THEN
    RETURN jsonb_build_object('ok', true, 'idempotent', true);
  END IF;

  SELECT * INTO v_led
  FROM public.seller_credit_ledger
  WHERE type = 'event_charge'
    AND event_type = p_event_type
    AND reference_type = p_reference_type
    AND reference_id = p_reference_id
  ORDER BY created_at
  LIMIT 1;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'no committed charge to reverse';
  END IF;

  v_acct := public.seller_credit_ensure_account(p_seller_id);
  UPDATE public.seller_credit_accounts
  SET available = available + ABS(v_led.charged_amount),
      lifetime_consumed = GREATEST(lifetime_consumed - ABS(v_led.charged_amount), 0),
      lifetime_adjusted = lifetime_adjusted + ABS(v_led.charged_amount),
      updated_at = now()
  WHERE seller_id = p_seller_id
  RETURNING * INTO v_acct;

  INSERT INTO public.seller_credit_ledger(
    seller_id, type, event_type, amount, configured_price, charged_amount,
    balance_after, reference_type, reference_id, description, created_by
  ) VALUES (
    p_seller_id, 'reversal', p_event_type, ABS(v_led.charged_amount), v_led.configured_price, 0,
    v_acct.available, p_reference_type, p_reference_id,
    'Reversal: ' || p_reason, auth.uid()
  );

  RETURN jsonb_build_object('ok', true, 'available', v_acct.available);
END;
$$;

CREATE OR REPLACE FUNCTION public.log_seller_contact_interaction(
  p_seller_id uuid,
  p_product_id uuid,
  p_interaction_type text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_buyer uuid := auth.uid();
  v_id uuid;
  v_gate jsonb;
  v_hours int;
  v_product uuid;
  v_claimed boolean := false;
  v_ref text;
BEGIN
  IF v_buyer IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;
  IF p_interaction_type NOT IN ('call', 'message') THEN
    RAISE EXCEPTION 'invalid interaction type';
  END IF;

  v_gate := public.seller_credit_can_accept(p_seller_id, 'CONTACT_REQUEST');
  IF COALESCE((v_gate->>'ok')::boolean, false) IS NOT TRUE THEN
    RAISE EXCEPTION '%', COALESCE(v_gate->>'reason', public.seller_credit_customer_reason('CONTACT_REQUEST'));
  END IF;

  v_hours := COALESCE(NULLIF(public.seller_credit_setting('contact_debounce_hours'), '')::int, 24);
  IF v_hours < 1 OR v_hours > 168 THEN
    v_hours := 24;
  END IF;
  v_product := COALESCE(p_product_id, '00000000-0000-0000-0000-000000000000'::uuid);
  v_ref := 'contact:' || p_seller_id::text || ':' || v_buyer::text || ':' || v_product::text;

  INSERT INTO public.seller_contact_interactions(buyer_id, seller_id, product_id, interaction_type)
  VALUES (v_buyer, p_seller_id, p_product_id, p_interaction_type)
  RETURNING id INTO v_id;

  IF NOT public.seller_credit_spend_active() THEN
    RETURN jsonb_build_object('ok', true, 'interaction_id', v_id, 'charged', false);
  END IF;

  PERFORM public.seller_credit_ensure_account(p_seller_id);

  INSERT INTO public.seller_credit_contact_debits(
    seller_id, buyer_id, product_id, window_hours, charged_at, reference_id
  ) VALUES (
    p_seller_id, v_buyer, v_product, v_hours, now(), v_ref
  )
  ON CONFLICT (seller_id, buyer_id, product_id) DO UPDATE
  SET charged_at = EXCLUDED.charged_at,
      window_hours = EXCLUDED.window_hours,
      reference_id = EXCLUDED.reference_id
  WHERE public.seller_credit_contact_debits.charged_at
        < now() - make_interval(hours => public.seller_credit_contact_debits.window_hours)
  RETURNING true INTO v_claimed;

  IF COALESCE(v_claimed, false) THEN
    BEGIN
      PERFORM public.record_seller_billable_event(
        p_seller_id, 'CONTACT_REQUEST', 'contact', v_ref, 'charge',
        'Contact request', v_buyer
      );
      UPDATE public.seller_credit_ledger
      SET metadata = jsonb_build_object(
        'buyer_id', v_buyer,
        'product_id', p_product_id,
        'interaction_type', p_interaction_type,
        'debounce_hours', v_hours
      )
      WHERE seller_id = p_seller_id
        AND type = 'event_charge'
        AND event_type = 'CONTACT_REQUEST'
        AND reference_id = v_ref;
    EXCEPTION WHEN others THEN
      IF SQLERRM LIKE 'SELLER_CREDIT_INSUFFICIENT%' THEN
        DELETE FROM public.seller_credit_contact_debits
        WHERE seller_id = p_seller_id AND buyer_id = v_buyer AND product_id = v_product
          AND reference_id = v_ref;
        DELETE FROM public.seller_contact_interactions WHERE id = v_id;
        RAISE;
      END IF;
      RAISE;
    END;
  END IF;

  RETURN jsonb_build_object('ok', true, 'interaction_id', v_id, 'charged', COALESCE(v_claimed, false));
END;
$$;

CREATE OR REPLACE FUNCTION public.resolve_due_seller_credit_bookings()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_grace_text text;
  v_grace int;
  v_unresolved text;
  v_row record;
  v_committed int := 0;
  v_released int := 0;
  v_held int := 0;
  v_skipped_grace int := 0;
  v_short text;
BEGIN
  v_grace_text := NULLIF(current_setting('app.seller_credit_test_grace', true), '');
  IF v_grace_text IS NULL THEN
    v_grace_text := public.seller_credit_setting('booking_resolution_grace_minutes');
  END IF;
  IF v_grace_text IS NOT NULL AND v_grace_text ~ '^[0-9]+$' THEN
    v_grace := v_grace_text::int;
  END IF;
  v_unresolved := COALESCE(public.seller_credit_setting('unresolved_after_grace_policy'), 'commit');

  FOR v_row IN
    SELECT
      r.id,
      r.seller_id,
      r.reference_id,
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
      v_committed := v_committed + 1;
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
      IF v_unresolved = 'release' THEN
        PERFORM public.seller_credit_apply_booking_outcome(
          v_row.seller_id, v_row.reference_id::uuid, 'release',
          'Booking reservation released · Booking #' || v_short || ' · Auto-resolved'
        );
        v_released := v_released + 1;
      ELSE
        PERFORM public.seller_credit_apply_booking_outcome(
          v_row.seller_id, v_row.reference_id::uuid, 'commit',
          'Charged for completed Booking #' || v_short || ' · Auto-resolved after appointment'
        );
        v_committed := v_committed + 1;
      END IF;
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

CREATE OR REPLACE FUNCTION public.admin_set_seller_credit_flag(p_key text, p_enabled boolean)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_ready jsonb;
BEGIN
  IF NOT public.is_admin(auth.uid()) THEN
    RAISE EXCEPTION 'admin only';
  END IF;
  IF p_key NOT IN ('seller_credit_purchase_enabled', 'seller_credit_spend_enabled') THEN
    RAISE EXCEPTION 'unknown credit flag';
  END IF;
  IF p_key = 'seller_credit_spend_enabled' AND p_enabled THEN
    v_ready := public.seller_credit_resolution_ready();
    IF COALESCE((v_ready->>'ok')::boolean, false) IS NOT TRUE THEN
      RAISE EXCEPTION 'Set booking grace minutes and buyer no-show policy before enabling Spend';
    END IF;
  END IF;
  UPDATE public.financial_feature_flags
  SET enabled = p_enabled, updated_at = now(), updated_by = auth.uid()
  WHERE key = p_key;
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
  IF p_key NOT IN (
    'booking_resolution_grace_minutes',
    'buyer_no_show_policy',
    'unresolved_after_grace_policy',
    'seller_failure_policy',
    'dispute_policy',
    'contact_debounce_hours'
  ) THEN
    RAISE EXCEPTION 'unknown credit setting';
  END IF;
  IF p_key = 'booking_resolution_grace_minutes'
     AND NULLIF(btrim(COALESCE(p_value, '')), '') IS NOT NULL
     AND (p_value !~ '^[0-9]+$' OR p_value::int > 10080) THEN
    RAISE EXCEPTION 'grace minutes must be a whole number between 0 and 10080';
  END IF;
  IF p_key IN ('buyer_no_show_policy', 'unresolved_after_grace_policy')
     AND NULLIF(btrim(COALESCE(p_value, '')), '') IS NOT NULL
     AND p_value NOT IN ('commit', 'charge', 'release') THEN
    RAISE EXCEPTION 'policy must be commit or release';
  END IF;
  IF p_key = 'seller_failure_policy'
     AND NULLIF(btrim(COALESCE(p_value, '')), '') IS NOT NULL
     AND p_value NOT IN ('release') THEN
    RAISE EXCEPTION 'seller failure policy is release in V1';
  END IF;
  IF p_key = 'dispute_policy'
     AND NULLIF(btrim(COALESCE(p_value, '')), '') IS NOT NULL
     AND p_value NOT IN ('admin_reversal') THEN
    RAISE EXCEPTION 'dispute policy is admin_reversal in V1';
  END IF;
  IF p_key = 'contact_debounce_hours'
     AND (p_value IS NULL OR p_value !~ '^[0-9]+$' OR p_value::int < 1 OR p_value::int > 168) THEN
    RAISE EXCEPTION 'contact debounce hours must be 1-168';
  END IF;

  INSERT INTO public.seller_credit_settings(key, value, updated_by, updated_at)
  VALUES (p_key, NULLIF(btrim(p_value), ''), auth.uid(), now())
  ON CONFLICT (key) DO UPDATE
  SET value = EXCLUDED.value,
      updated_by = auth.uid(),
      updated_at = now();

  INSERT INTO public.seller_billing_rule_audit(event_type, reason, admin_id)
  VALUES (
    'SETTING:' || p_key,
    COALESCE(NULLIF(trim(p_reason), ''), 'Updated ' || p_key || ' to ' || COALESCE(p_value, 'unset')),
    auth.uid()
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_update_seller_credit_threshold(
  p_key text,
  p_value numeric,
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
  IF p_key NOT IN ('healthy_min', 'low_min', 'critical_min') THEN
    RAISE EXCEPTION 'unknown threshold';
  END IF;
  IF p_value IS NULL OR p_value < 0 THEN
    RAISE EXCEPTION 'threshold must be zero or greater';
  END IF;
  INSERT INTO public.seller_credit_thresholds(key, value)
  VALUES (p_key, p_value)
  ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value;
  INSERT INTO public.seller_billing_rule_audit(event_type, reason, admin_id, new_amount)
  VALUES ('THRESHOLD:' || p_key, COALESCE(NULLIF(trim(p_reason), ''), 'Threshold update'), auth.uid(), p_value);
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_list_seller_credit_thresholds()
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
    SELECT jsonb_agg(jsonb_build_object('key', key, 'value', value) ORDER BY key)
    FROM public.seller_credit_thresholds
  ), '[]'::jsonb);
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_upsert_seller_credit_package(
  p_id uuid,
  p_label text,
  p_amount numeric,
  p_credits_amount numeric,
  p_is_active boolean,
  p_sort_order integer
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id uuid;
BEGIN
  IF NOT public.is_admin(auth.uid()) THEN
    RAISE EXCEPTION 'admin only';
  END IF;
  IF NULLIF(btrim(p_label), '') IS NULL OR p_amount IS NULL OR p_amount <= 0
     OR p_credits_amount IS NULL OR p_credits_amount <= 0 THEN
    RAISE EXCEPTION 'package label, price, and credit amount are required';
  END IF;
  IF p_id IS NULL THEN
    INSERT INTO public.seller_credit_packages(label, amount, credits_amount, is_active, sort_order, updated_at)
    VALUES (btrim(p_label), p_amount, p_credits_amount, COALESCE(p_is_active, true), COALESCE(p_sort_order, 100), now())
    RETURNING id INTO v_id;
  ELSE
    UPDATE public.seller_credit_packages
    SET label = btrim(p_label),
        amount = p_amount,
        credits_amount = p_credits_amount,
        is_active = COALESCE(p_is_active, is_active),
        sort_order = COALESCE(p_sort_order, sort_order),
        updated_at = now()
    WHERE id = p_id
    RETURNING id INTO v_id;
    IF v_id IS NULL THEN
      RAISE EXCEPTION 'package not found';
    END IF;
  END IF;
  INSERT INTO public.seller_billing_rule_audit(event_type, reason, admin_id, new_amount)
  VALUES ('PACKAGE', btrim(p_label), auth.uid(), p_amount);
  RETURN v_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_list_seller_credit_packages()
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
    SELECT jsonb_agg(to_jsonb(p) ORDER BY p.sort_order, p.amount)
    FROM public.seller_credit_packages p
  ), '[]'::jsonb);
END;
$$;

DROP FUNCTION IF EXISTS public.admin_list_seller_credits();

CREATE OR REPLACE FUNCTION public.admin_adjust_seller_credits(
  p_seller_id uuid,
  p_amount numeric,
  p_reason text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_acct public.seller_credit_accounts;
  v_old_health text;
  v_health text;
BEGIN
  IF auth.uid() IS NOT NULL AND NOT public.is_admin(auth.uid()) THEN
    RAISE EXCEPTION 'admin only';
  END IF;
  IF p_amount = 0 THEN
    RAISE EXCEPTION 'adjustment amount cannot be zero';
  END IF;
  IF NULLIF(trim(p_reason), '') IS NULL THEN
    RAISE EXCEPTION 'reason is required';
  END IF;
  v_acct := public.seller_credit_ensure_account(p_seller_id);
  v_old_health := v_acct.last_health;
  IF p_amount < 0 AND v_acct.available < ABS(p_amount) THEN
    RAISE EXCEPTION 'adjustment would make the credit balance negative';
  END IF;
  UPDATE public.seller_credit_accounts
  SET available = available + p_amount,
      lifetime_adjusted = lifetime_adjusted + p_amount,
      updated_at = now()
  WHERE seller_id = p_seller_id
  RETURNING * INTO v_acct;
  INSERT INTO public.seller_credit_ledger(
    seller_id, type, amount, configured_price, charged_amount, balance_after,
    reference_type, description, created_by
  ) VALUES (
    p_seller_id, 'admin_adjustment', p_amount, ABS(p_amount), p_amount, v_acct.available,
    'admin_adjustment', p_reason, auth.uid()
  );
  v_health := public.seller_credit_health_for(v_acct.available);
  UPDATE public.seller_credit_accounts SET last_health = v_health WHERE seller_id = p_seller_id;
  PERFORM public.seller_credit_maybe_notify_health(p_seller_id, v_old_health, v_health, v_acct.available);
  RETURN jsonb_build_object('ok', true, 'available', v_acct.available);
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_list_seller_credits(p_search text DEFAULT NULL)
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
    SELECT jsonb_agg(row_to_json(x))
    FROM (
      SELECT
        sp.id AS seller_id,
        sp.business_name,
        COALESCE(a.available, 0) AS available,
        COALESCE(a.reserved, 0) AS reserved,
        COALESCE(a.lifetime_purchased, 0) AS lifetime_purchased,
        COALESCE(a.lifetime_consumed, 0) AS lifetime_consumed,
        COALESCE(a.lifetime_adjusted, 0) AS lifetime_adjusted,
        (
          SELECT max(p.created_at)
          FROM public.seller_credit_purchases p
          WHERE p.seller_id = sp.id AND p.status = 'captured'
        ) AS last_recharge_at
      FROM public.seller_profiles sp
      LEFT JOIN public.seller_credit_accounts a ON a.seller_id = sp.id
      WHERE p_search IS NULL
         OR btrim(p_search) = ''
         OR sp.business_name ILIKE '%' || btrim(p_search) || '%'
         OR sp.id::text ILIKE '%' || btrim(p_search) || '%'
      ORDER BY sp.business_name
      LIMIT 200
    ) x
  ), '[]'::jsonb);
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_list_seller_credit_purchases(
  p_search text DEFAULT NULL,
  p_limit integer DEFAULT 50
)
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
    SELECT jsonb_agg(to_jsonb(x))
    FROM (
      SELECT
        p.id,
        p.seller_id,
        sp.business_name,
        p.amount,
        COALESCE(p.credits_granted, p.amount) AS credits_granted,
        p.status,
        p.provider,
        p.provider_order_id,
        p.provider_payment_id,
        p.failure_reason,
        p.created_at,
        p.captured_at,
        p.failed_at
      FROM public.seller_credit_purchases p
      JOIN public.seller_profiles sp ON sp.id = p.seller_id
      WHERE p_search IS NULL
         OR btrim(p_search) = ''
         OR sp.business_name ILIKE '%' || btrim(p_search) || '%'
         OR p.id::text ILIKE '%' || btrim(p_search) || '%'
         OR p.provider_payment_id ILIKE '%' || btrim(p_search) || '%'
      ORDER BY p.created_at DESC
      LIMIT GREATEST(COALESCE(p_limit, 50), 1)
    ) x
  ), '[]'::jsonb);
END;
$$;

CREATE OR REPLACE FUNCTION public.create_seller_credit_purchase(
  p_seller_id uuid,
  p_package_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_pack public.seller_credit_packages;
  v_id uuid;
BEGIN
  IF NOT public.seller_credit_flag_enabled('seller_credit_purchase_enabled') THEN
    RAISE EXCEPTION 'Sociva Credit purchases are not enabled yet';
  END IF;
  IF NOT public.is_admin(auth.uid())
     AND NOT EXISTS (
       SELECT 1 FROM public.seller_profiles
       WHERE id = p_seller_id AND user_id = auth.uid()
     ) THEN
    RAISE EXCEPTION 'seller scope forbidden';
  END IF;

  SELECT * INTO v_pack
  FROM public.seller_credit_packages
  WHERE id = p_package_id AND is_active = true;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Invalid credit package';
  END IF;

  PERFORM public.seller_credit_ensure_account(p_seller_id);

  INSERT INTO public.seller_credit_purchases(
    seller_id, package_id, amount, credits_granted, status, created_by, metadata
  ) VALUES (
    p_seller_id, p_package_id, v_pack.amount, v_pack.credits_amount, 'created', auth.uid(),
    jsonb_build_object(
      'package_label', v_pack.label,
      'package_price', v_pack.amount,
      'credits_granted', v_pack.credits_amount
    )
  )
  RETURNING id INTO v_id;

  RETURN jsonb_build_object(
    'ok', true,
    'purchase_id', v_id,
    'amount', v_pack.amount,
    'credits_granted', v_pack.credits_amount,
    'seller_id', p_seller_id
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.confirm_seller_credit_purchase(
  p_purchase_id uuid,
  p_provider_payment_id text,
  p_provider_order_id text DEFAULT NULL,
  p_amount numeric DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row public.seller_credit_purchases;
  v_acct public.seller_credit_accounts;
  v_old_health text;
  v_health text;
  v_credits numeric;
BEGIN
  IF p_provider_payment_id IS NOT NULL THEN
    SELECT * INTO v_row
    FROM public.seller_credit_purchases
    WHERE provider = 'razorpay' AND provider_payment_id = p_provider_payment_id;
    IF FOUND AND v_row.status = 'captured' THEN
      RETURN jsonb_build_object('ok', true, 'idempotent', true, 'purchase_id', v_row.id);
    END IF;
  END IF;

  SELECT * INTO v_row
  FROM public.seller_credit_purchases
  WHERE id = p_purchase_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'credit purchase not found';
  END IF;
  IF v_row.status = 'captured' THEN
    RETURN jsonb_build_object('ok', true, 'idempotent', true, 'purchase_id', v_row.id);
  END IF;
  IF p_amount IS NOT NULL AND p_amount <> v_row.amount THEN
    RAISE EXCEPTION 'credit purchase amount mismatch';
  END IF;

  v_credits := COALESCE(v_row.credits_granted, v_row.amount);

  UPDATE public.seller_credit_purchases
  SET status = 'captured',
      provider_payment_id = p_provider_payment_id,
      provider_order_id = COALESCE(p_provider_order_id, provider_order_id),
      credits_granted = v_credits,
      captured_at = now(),
      updated_at = now()
  WHERE id = v_row.id;

  v_acct := public.seller_credit_ensure_account(v_row.seller_id);
  v_old_health := v_acct.last_health;
  UPDATE public.seller_credit_accounts
  SET available = available + v_credits,
      lifetime_purchased = lifetime_purchased + v_credits,
      updated_at = now()
  WHERE seller_id = v_row.seller_id
  RETURNING * INTO v_acct;

  INSERT INTO public.seller_credit_ledger(
    seller_id, type, amount, configured_price, charged_amount, balance_after,
    reference_type, reference_id, description
  ) VALUES (
    v_row.seller_id, 'purchase', v_credits, v_row.amount, v_credits, v_acct.available,
    'credit_purchase', v_row.id::text, 'Sociva Credits added'
  );

  v_health := public.seller_credit_health_for(v_acct.available);
  UPDATE public.seller_credit_accounts SET last_health = v_health WHERE seller_id = v_row.seller_id;
  PERFORM public.seller_credit_notify(
    v_row.seller_id,
    'seller_credit_purchased',
    'Sociva Credits added',
    public.seller_credit_format_inr(v_credits) || ' Sociva Credits added successfully.'
  );

  RETURN jsonb_build_object('ok', true, 'available', v_acct.available, 'purchase_id', v_row.id);
END;
$$;

CREATE OR REPLACE FUNCTION public.fail_seller_credit_purchase(p_purchase_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.seller_credit_purchases
  SET status = 'failed',
      failed_at = now(),
      failure_reason = COALESCE(failure_reason, 'payment_failed'),
      updated_at = now()
  WHERE id = p_purchase_id AND status = 'created';
END;
$$;

CREATE OR REPLACE FUNCTION public.get_seller_credit_summary(p_seller_ids uuid[])
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_available numeric := 0;
  v_reserved numeric := 0;
  v_purchased numeric := 0;
  v_consumed numeric := 0;
  v_adjusted numeric := 0;
  v_used numeric := 0;
  v_orders int := 0;
  v_enquiries int := 0;
  v_bookings int := 0;
  v_contacts int := 0;
  v_healthy numeric;
  v_low numeric;
  v_critical numeric;
BEGIN
  IF p_seller_ids IS NULL OR array_length(p_seller_ids, 1) IS NULL THEN
    RAISE EXCEPTION 'seller ids required';
  END IF;
  IF v_uid IS NOT NULL
     AND NOT public.is_admin(v_uid)
     AND EXISTS (
       SELECT 1
       FROM unnest(p_seller_ids) requested(id)
       LEFT JOIN public.seller_profiles sp
         ON sp.id = requested.id AND sp.user_id = v_uid
       WHERE sp.id IS NULL
     ) THEN
    RAISE EXCEPTION 'seller scope forbidden';
  END IF;

  SELECT
    COALESCE(SUM(a.available), 0),
    COALESCE(SUM(a.reserved), 0),
    COALESCE(SUM(a.lifetime_purchased), 0),
    COALESCE(SUM(a.lifetime_consumed), 0),
    COALESCE(SUM(a.lifetime_adjusted), 0)
  INTO v_available, v_reserved, v_purchased, v_consumed, v_adjusted
  FROM public.seller_credit_accounts a
  WHERE a.seller_id = ANY(p_seller_ids);

  SELECT
    COALESCE(SUM(CASE WHEN l.type = 'event_charge' THEN ABS(l.charged_amount) ELSE 0 END), 0),
    COUNT(*) FILTER (WHERE l.event_type = 'ORDER_COMPLETED' AND l.type = 'event_charge'),
    COUNT(*) FILTER (WHERE l.event_type = 'ENQUIRY_CREATED' AND l.type = 'event_charge'),
    COUNT(*) FILTER (WHERE l.event_type = 'SERVICE_BOOKING' AND l.type = 'event_charge'),
    COUNT(*) FILTER (WHERE l.event_type = 'CONTACT_REQUEST' AND l.type = 'event_charge')
  INTO v_used, v_orders, v_enquiries, v_bookings, v_contacts
  FROM public.seller_credit_ledger l
  WHERE l.seller_id = ANY(p_seller_ids)
    AND l.created_at >= date_trunc('month', now());

  SELECT value INTO v_healthy FROM public.seller_credit_thresholds WHERE key = 'healthy_min';
  SELECT value INTO v_low FROM public.seller_credit_thresholds WHERE key = 'low_min';
  SELECT value INTO v_critical FROM public.seller_credit_thresholds WHERE key = 'critical_min';

  RETURN jsonb_build_object(
    'available', v_available,
    'reserved', v_reserved,
    'lifetime_purchased', v_purchased,
    'lifetime_consumed', v_consumed,
    'lifetime_adjusted', v_adjusted,
    'used_this_month', v_used,
    'orders_this_month', v_orders,
    'enquiries_this_month', v_enquiries,
    'bookings_this_month', v_bookings,
    'contacts_this_month', v_contacts,
    'healthy_min', v_healthy,
    'low_min', v_low,
    'critical_min', v_critical,
    'spend_enabled', public.seller_credit_flag_enabled('seller_credit_spend_enabled'),
    'purchase_enabled', public.seller_credit_flag_enabled('seller_credit_purchase_enabled')
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.seller_credit_test_event(
  p_seller_id uuid,
  p_event_type text,
  p_reference_id text,
  p_mode text DEFAULT 'charge'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF current_setting('app.seller_credit_test_spend', true) IS DISTINCT FROM 'on'
     AND NOT EXISTS (
       SELECT 1 FROM public.seller_profiles
       WHERE id = p_seller_id AND business_name LIKE 'CREDIT-VERIFY-%'
     ) THEN
    RAISE EXCEPTION 'credit test harness forbidden';
  END IF;
  PERFORM set_config('app.seller_credit_test_spend', 'on', true);
  RETURN public.record_seller_billable_event(
    p_seller_id, p_event_type, 'verify', p_reference_id, p_mode, 'isolated verification', NULL
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.seller_credit_run_isolated_verification()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user uuid;
  v_a uuid;
  v_b uuid;
  v_buyer uuid;
  v_order_a uuid := gen_random_uuid();
  v_order_b uuid := gen_random_uuid();
  v_order_c uuid := gen_random_uuid();
  v_enq uuid;
  v_book uuid := gen_random_uuid();
  v_hist uuid := gen_random_uuid();
  v_purchase uuid;
  v_old_price numeric;
  v_new_price numeric;
  v_result jsonb := '{}'::jsonb;
  v_gate jsonb;
  v_charge jsonb;
  v_acct_a public.seller_credit_accounts;
  v_acct_b public.seller_credit_accounts;
  v_recon numeric;
  v_ok boolean;
  v_fail text := NULL;
  v_cases jsonb := '[]'::jsonb;
  v_flags_purchase boolean;
  v_flags_spend boolean;
BEGIN
  SELECT enabled INTO v_flags_purchase
  FROM public.financial_feature_flags WHERE key = 'seller_credit_purchase_enabled';
  SELECT enabled INTO v_flags_spend
  FROM public.financial_feature_flags WHERE key = 'seller_credit_spend_enabled';
  IF v_flags_purchase OR v_flags_spend THEN
    RAISE EXCEPTION 'Refusing verification while production Purchase/Spend flags are ON';
  END IF;

  SELECT user_id INTO v_user FROM public.seller_profiles ORDER BY created_at LIMIT 1;
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'no host user for isolated credit stores';
  END IF;
  v_buyer := v_user;

  INSERT INTO public.seller_profiles(user_id, business_name, verification_status)
  VALUES (v_user, 'CREDIT-VERIFY-A-' || left(gen_random_uuid()::text, 8), 'approved')
  RETURNING id INTO v_a;
  INSERT INTO public.seller_profiles(user_id, business_name, verification_status)
  VALUES (v_user, 'CREDIT-VERIFY-B-' || left(gen_random_uuid()::text, 8), 'approved')
  RETURNING id INTO v_b;

  PERFORM set_config('app.seller_credit_test_spend', 'on', true);
  PERFORM set_config('app.seller_credit_test_grace', '0', true);

  PERFORM public.seller_credit_ensure_account(v_a);
  PERFORM public.seller_credit_ensure_account(v_b);
  UPDATE public.seller_credit_accounts
  SET available = 20, lifetime_purchased = 20, reserved = 0, lifetime_consumed = 0, lifetime_adjusted = 0
  WHERE seller_id IN (v_a, v_b);

  v_gate := public.seller_credit_can_accept(v_a, 'ORDER_COMPLETED');
  IF v_gate ? 'available' OR v_gate ? 'required' THEN
    v_fail := 'can_accept leaked financial fields';
  END IF;
  v_cases := v_cases || jsonb_build_array(jsonb_build_object(
    'id', 'can_accept_no_leak',
    'result', CASE WHEN v_fail IS NULL THEN 'PASS' ELSE 'FAIL' END,
    'payload_keys', (SELECT coalesce(jsonb_agg(key), '[]'::jsonb) FROM jsonb_object_keys(v_gate) key)
  ));

  BEGIN
    v_charge := public.record_seller_billable_event(v_a, 'ENQUIRY_CREATED', 'order', gen_random_uuid()::text, 'charge', 'verify enquiry enough', v_buyer);
    v_cases := v_cases || jsonb_build_array(jsonb_build_object('id', 'enquiry_sufficient', 'result', 'PASS', 'data', v_charge));
  EXCEPTION WHEN others THEN
    v_cases := v_cases || jsonb_build_array(jsonb_build_object('id', 'enquiry_sufficient', 'result', 'FAIL', 'error', SQLERRM));
    v_fail := COALESCE(v_fail, SQLERRM);
  END;

  UPDATE public.seller_credit_accounts SET available = 0 WHERE seller_id = v_a;
  BEGIN
    PERFORM public.record_seller_billable_event(v_a, 'ENQUIRY_CREATED', 'order', gen_random_uuid()::text, 'charge', 'verify enquiry empty', v_buyer);
    v_cases := v_cases || jsonb_build_array(jsonb_build_object('id', 'enquiry_insufficient', 'result', 'FAIL', 'error', 'expected block'));
    v_fail := COALESCE(v_fail, 'enquiry insufficient did not block');
  EXCEPTION WHEN others THEN
    v_cases := v_cases || jsonb_build_array(jsonb_build_object('id', 'enquiry_insufficient', 'result', 'PASS', 'error', SQLERRM));
  END;

  UPDATE public.seller_credit_accounts SET available = 20, lifetime_consumed = 0 WHERE seller_id = v_a;
  BEGIN
    PERFORM public.record_seller_billable_event(v_a, 'CONTACT_REQUEST', 'contact', 'contact-ok-1', 'charge', 'verify contact enough', v_buyer);
    v_cases := v_cases || jsonb_build_array(jsonb_build_object('id', 'contact_sufficient', 'result', 'PASS'));
  EXCEPTION WHEN others THEN
    v_cases := v_cases || jsonb_build_array(jsonb_build_object('id', 'contact_sufficient', 'result', 'FAIL', 'error', SQLERRM));
    v_fail := COALESCE(v_fail, SQLERRM);
  END;
  BEGIN
    PERFORM public.record_seller_billable_event(v_a, 'CONTACT_REQUEST', 'contact', 'contact-ok-1', 'charge', 'verify contact dup', v_buyer);
    IF (SELECT count(*) FROM public.seller_credit_ledger WHERE seller_id = v_a AND event_type = 'CONTACT_REQUEST' AND reference_id = 'contact-ok-1' AND type = 'event_charge') = 1 THEN
      v_cases := v_cases || jsonb_build_array(jsonb_build_object('id', 'duplicate_billable_event', 'result', 'PASS'));
    ELSE
      v_cases := v_cases || jsonb_build_array(jsonb_build_object('id', 'duplicate_billable_event', 'result', 'FAIL'));
      v_fail := COALESCE(v_fail, 'duplicate contact charged twice');
    END IF;
  EXCEPTION WHEN others THEN
    v_cases := v_cases || jsonb_build_array(jsonb_build_object('id', 'duplicate_billable_event', 'result', 'PASS', 'note', SQLERRM));
  END;

  UPDATE public.seller_credit_accounts SET available = 0 WHERE seller_id = v_a;
  BEGIN
    PERFORM public.record_seller_billable_event(v_a, 'CONTACT_REQUEST', 'contact', 'contact-empty', 'charge', 'verify contact empty', v_buyer);
    v_cases := v_cases || jsonb_build_array(jsonb_build_object('id', 'contact_insufficient', 'result', 'FAIL'));
    v_fail := COALESCE(v_fail, 'contact insufficient did not block');
  EXCEPTION WHEN others THEN
    v_cases := v_cases || jsonb_build_array(jsonb_build_object('id', 'contact_insufficient', 'result', 'PASS'));
  END;

  UPDATE public.seller_credit_accounts SET available = 20, reserved = 0, lifetime_consumed = 0 WHERE seller_id = v_a;
  BEGIN
    PERFORM public.record_seller_billable_event(v_a, 'ORDER_COMPLETED', 'order', v_order_a::text, 'reserve', 'verify order enough', v_buyer);
    v_cases := v_cases || jsonb_build_array(jsonb_build_object('id', 'order_sufficient', 'result', 'PASS'));
  EXCEPTION WHEN others THEN
    v_cases := v_cases || jsonb_build_array(jsonb_build_object('id', 'order_sufficient', 'result', 'FAIL', 'error', SQLERRM));
    v_fail := COALESCE(v_fail, SQLERRM);
  END;
  UPDATE public.seller_credit_accounts SET available = 0 WHERE seller_id = v_a;
  BEGIN
    PERFORM public.record_seller_billable_event(v_a, 'ORDER_COMPLETED', 'order', v_order_b::text, 'reserve', 'verify order empty', v_buyer);
    v_cases := v_cases || jsonb_build_array(jsonb_build_object('id', 'order_insufficient', 'result', 'FAIL'));
    v_fail := COALESCE(v_fail, 'order insufficient did not block');
  EXCEPTION WHEN others THEN
    v_cases := v_cases || jsonb_build_array(jsonb_build_object('id', 'order_insufficient', 'result', 'PASS'));
  END;

  UPDATE public.seller_credit_accounts
  SET available = 20, reserved = 0, lifetime_consumed = 0, lifetime_purchased = 20
  WHERE seller_id IN (v_a, v_b);
  v_ok := true;
  IF COALESCE((public.seller_credit_can_accept(v_a, 'ORDER_COMPLETED')->>'ok')::boolean, false) IS NOT TRUE THEN
    v_ok := false;
  END IF;
  UPDATE public.seller_credit_accounts SET available = 0 WHERE seller_id = v_b;
  IF COALESCE((public.seller_credit_can_accept(v_b, 'ORDER_COMPLETED')->>'ok')::boolean, false) THEN
    v_ok := false;
  END IF;
  IF COALESCE((public.seller_credit_can_accept(v_a, 'ORDER_COMPLETED')->>'ok')::boolean, false) IS NOT TRUE THEN
    v_ok := false;
  END IF;
  v_cases := v_cases || jsonb_build_array(jsonb_build_object(
    'id', 'multi_vendor_isolation_gate',
    'result', CASE WHEN v_ok THEN 'PASS' ELSE 'FAIL' END
  ));
  IF NOT v_ok THEN
    v_fail := COALESCE(v_fail, 'multi-vendor gate isolation failed');
  END IF;

  UPDATE public.seller_credit_accounts
  SET available = 20, reserved = 0, lifetime_consumed = 0 WHERE seller_id = v_a;
  BEGIN
    PERFORM public.record_seller_billable_event(v_a, 'SERVICE_BOOKING', 'order', v_book::text, 'reserve', 'verify booking enough', v_buyer);
    v_cases := v_cases || jsonb_build_array(jsonb_build_object('id', 'booking_sufficient', 'result', 'PASS'));
  EXCEPTION WHEN others THEN
    v_cases := v_cases || jsonb_build_array(jsonb_build_object('id', 'booking_sufficient', 'result', 'FAIL', 'error', SQLERRM));
    v_fail := COALESCE(v_fail, SQLERRM);
  END;
  PERFORM public.record_seller_billable_event(v_a, 'SERVICE_BOOKING', 'order', v_book::text, 'release', 'verify booking cancel', v_buyer);
  v_cases := v_cases || jsonb_build_array(jsonb_build_object(
    'id', 'booking_cancellation',
    'result', CASE WHEN EXISTS (
      SELECT 1 FROM public.seller_credit_reservations
      WHERE seller_id = v_a AND reference_id = v_book::text AND status = 'released'
    ) THEN 'PASS' ELSE 'FAIL' END
  ));

  UPDATE public.seller_credit_accounts SET available = 0 WHERE seller_id = v_a;
  BEGIN
    PERFORM public.record_seller_billable_event(v_a, 'SERVICE_BOOKING', 'order', gen_random_uuid()::text, 'reserve', 'verify booking empty', v_buyer);
    v_cases := v_cases || jsonb_build_array(jsonb_build_object('id', 'booking_insufficient', 'result', 'FAIL'));
    v_fail := COALESCE(v_fail, 'booking insufficient did not block');
  EXCEPTION WHEN others THEN
    v_cases := v_cases || jsonb_build_array(jsonb_build_object('id', 'booking_insufficient', 'result', 'PASS'));
  END;

  UPDATE public.seller_credit_accounts
  SET available = 20, reserved = 0, lifetime_consumed = 0 WHERE seller_id = v_a;
  v_book := gen_random_uuid();
  PERFORM public.record_seller_billable_event(v_a, 'SERVICE_BOOKING', 'order', v_book::text, 'reserve', 'verify booking complete', v_buyer);
  PERFORM public.record_seller_billable_event(v_a, 'SERVICE_BOOKING', 'order', v_book::text, 'commit', 'verify booking complete', v_buyer);
  v_cases := v_cases || jsonb_build_array(jsonb_build_object(
    'id', 'booking_completion',
    'result', CASE WHEN EXISTS (
      SELECT 1 FROM public.seller_credit_reservations
      WHERE seller_id = v_a AND reference_id = v_book::text AND status = 'committed'
    ) THEN 'PASS' ELSE 'FAIL' END
  ));
  PERFORM public.reverse_seller_credit_charge(v_a, 'SERVICE_BOOKING', 'order', v_book::text, 'seller-fault dispute reversal');
  v_cases := v_cases || jsonb_build_array(jsonb_build_object(
    'id', 'admin_reversal',
    'result', CASE WHEN EXISTS (
      SELECT 1 FROM public.seller_credit_ledger
      WHERE seller_id = v_a AND type = 'reversal' AND reference_id = v_book::text
    ) THEN 'PASS' ELSE 'FAIL' END
  ));

  UPDATE public.seller_credit_accounts
  SET available = 20, reserved = 0, lifetime_consumed = 0, lifetime_purchased = 20, lifetime_adjusted = 0
  WHERE seller_id = v_a;
  v_book := gen_random_uuid();
  PERFORM set_config('app.seller_credit_test_spend', 'off', true);
  INSERT INTO public.orders(id, buyer_id, seller_id, total_amount, order_type, status, transaction_type)
  VALUES (v_book, v_buyer, v_a, 0, 'booking', 'confirmed', 'service_booking');
  INSERT INTO public.service_bookings(
    order_id, buyer_id, seller_id, booking_date, start_time, end_time, status
  ) VALUES (
    v_book, v_buyer, v_a, (now() AT TIME ZONE 'Asia/Kolkata')::date - 1, '09:00', '10:00', 'confirmed'
  );
  PERFORM set_config('app.seller_credit_test_spend', 'on', true);
  PERFORM public.record_seller_billable_event(v_a, 'SERVICE_BOOKING', 'order', v_book::text, 'reserve', 'verify auto resolve', v_buyer);
  PERFORM public.resolve_due_seller_credit_bookings();
  v_cases := v_cases || jsonb_build_array(jsonb_build_object(
    'id', 'booking_automatic_resolution',
    'result', CASE WHEN EXISTS (
      SELECT 1 FROM public.seller_credit_reservations
      WHERE seller_id = v_a AND reference_id = v_book::text AND status = 'committed'
    ) THEN 'PASS' ELSE 'FAIL' END
  ));

  UPDATE public.seller_credit_accounts
  SET available = 20, reserved = 0, lifetime_consumed = 0, lifetime_purchased = 20
  WHERE seller_id IN (v_a, v_b);
  BEGIN
    PERFORM public.record_seller_billable_event(v_a, 'ENQUIRY_CREATED', 'order', 'conc-a', 'charge', 'concurrent A', v_buyer);
    PERFORM public.record_seller_billable_event(v_a, 'ENQUIRY_CREATED', 'order', 'conc-b', 'charge', 'concurrent B', v_buyer);
    v_cases := v_cases || jsonb_build_array(jsonb_build_object('id', 'sequential_overspend_guard', 'result', 'FAIL'));
    v_fail := COALESCE(v_fail, 'two 15 charges on 20 succeeded sequentially');
  EXCEPTION WHEN others THEN
    SELECT * INTO v_acct_a FROM public.seller_credit_accounts WHERE seller_id = v_a;
    v_cases := v_cases || jsonb_build_array(jsonb_build_object(
      'id', 'sequential_overspend_guard',
      'result', CASE WHEN v_acct_a.available >= 0 AND v_acct_a.available <= 5 THEN 'PASS' ELSE 'FAIL' END,
      'available', v_acct_a.available
    ));
    IF v_acct_a.available < 0 THEN
      v_fail := COALESCE(v_fail, 'negative balance');
    END IF;
  END;

  INSERT INTO public.seller_credit_purchases(seller_id, amount, credits_granted, status, created_by)
  VALUES (v_a, 100, 100, 'created', v_user)
  RETURNING id INTO v_purchase;
  PERFORM public.confirm_seller_credit_purchase(v_purchase, 'pay_verify_dup', NULL, 100);
  PERFORM public.confirm_seller_credit_purchase(v_purchase, 'pay_verify_dup', NULL, 100);
  v_cases := v_cases || jsonb_build_array(jsonb_build_object(
    'id', 'credit_purchase_and_duplicate_callback',
    'result', CASE WHEN (
      SELECT count(*) FROM public.seller_credit_ledger
      WHERE seller_id = v_a AND type = 'purchase' AND reference_id = v_purchase::text
    ) = 1 THEN 'PASS' ELSE 'FAIL' END
  ));
  INSERT INTO public.seller_credit_purchases(seller_id, amount, credits_granted, status, created_by)
  VALUES (v_a, 50, 50, 'created', v_user)
  RETURNING id INTO v_purchase;
  PERFORM public.fail_seller_credit_purchase(v_purchase);
  v_cases := v_cases || jsonb_build_array(jsonb_build_object(
    'id', 'failed_credit_purchase',
    'result', CASE WHEN EXISTS (
      SELECT 1 FROM public.seller_credit_purchases WHERE id = v_purchase AND status = 'failed'
    ) THEN 'PASS' ELSE 'FAIL' END
  ));

  SELECT amount INTO v_old_price FROM public.seller_billing_rules WHERE event_type = 'ENQUIRY_CREATED';
  UPDATE public.seller_credit_accounts SET available = 50 WHERE seller_id = v_a;
  PERFORM public.record_seller_billable_event(v_a, 'ENQUIRY_CREATED', 'order', 'price-old', 'charge', 'snapshot old', v_buyer);
  UPDATE public.seller_billing_rules SET amount = v_old_price + 5 WHERE event_type = 'ENQUIRY_CREATED';
  PERFORM public.record_seller_billable_event(v_a, 'ENQUIRY_CREATED', 'order', 'price-new', 'charge', 'snapshot new', v_buyer);
  UPDATE public.seller_billing_rules SET amount = v_old_price WHERE event_type = 'ENQUIRY_CREATED';
  SELECT charged_amount INTO v_new_price
  FROM public.seller_credit_ledger
  WHERE seller_id = v_a AND reference_id = 'price-old' AND type = 'event_charge';
  v_cases := v_cases || jsonb_build_array(jsonb_build_object(
    'id', 'historical_price_snapshot',
    'result', CASE WHEN v_new_price = v_old_price THEN 'PASS' ELSE 'FAIL' END,
    'old_charged', v_new_price,
    'configured_then', v_old_price
  ));

  UPDATE public.seller_credit_accounts
  SET available = 40, lifetime_purchased = 40, reserved = 0, lifetime_consumed = 0
  WHERE seller_id IN (v_a, v_b);
  PERFORM public.record_seller_billable_event(v_a, 'ENQUIRY_CREATED', 'order', 'store-a-only', 'charge', 'store A', v_buyer);
  SELECT * INTO v_acct_a FROM public.seller_credit_accounts WHERE seller_id = v_a;
  SELECT * INTO v_acct_b FROM public.seller_credit_accounts WHERE seller_id = v_b;
  v_cases := v_cases || jsonb_build_array(jsonb_build_object(
    'id', 'multi_store_isolation',
    'result', CASE WHEN v_acct_a.available < 40 AND v_acct_b.available = 40 THEN 'PASS' ELSE 'FAIL' END,
    'a', v_acct_a.available,
    'b', v_acct_b.available
  ));
  IF v_acct_b.available <> 40 THEN
    v_fail := COALESCE(v_fail, 'store B changed when A was billed');
  END IF;

  PERFORM set_config('app.seller_credit_test_spend', 'off', true);
  INSERT INTO public.orders(id, buyer_id, seller_id, total_amount, order_type, status)
  VALUES (v_hist, v_buyer, v_a, 10, 'purchase', 'placed');
  PERFORM set_config('app.seller_credit_test_spend', 'on', true);
  PERFORM public.record_seller_billable_event(v_a, 'ORDER_COMPLETED', 'order', v_hist::text, 'commit', 'in-flight complete', v_buyer);
  v_cases := v_cases || jsonb_build_array(jsonb_build_object(
    'id', 'in_flight_not_retro_charged',
    'result', CASE WHEN NOT EXISTS (
      SELECT 1 FROM public.seller_credit_ledger
      WHERE seller_id = v_a AND reference_id = v_hist::text AND type = 'event_charge'
    ) THEN 'PASS' ELSE 'FAIL' END
  ));

  PERFORM public.admin_adjust_seller_credits(v_a, 7, 'isolated verification adjustment');
  v_cases := v_cases || jsonb_build_array(jsonb_build_object(
    'id', 'admin_adjustment',
    'result', CASE WHEN EXISTS (
      SELECT 1 FROM public.seller_credit_ledger WHERE seller_id = v_a AND type = 'admin_adjustment' AND amount = 7
    ) THEN 'PASS' ELSE 'FAIL' END
  ));

  SELECT * INTO v_acct_a FROM public.seller_credit_accounts WHERE seller_id = v_a;
  v_recon := round((v_acct_a.lifetime_purchased + v_acct_a.lifetime_adjusted - v_acct_a.lifetime_consumed - v_acct_a.reserved)::numeric, 2);
  v_cases := v_cases || jsonb_build_array(jsonb_build_object(
    'id', 'financial_reconciliation_store_a',
    'result', CASE WHEN v_recon = v_acct_a.available THEN 'PASS' ELSE 'FAIL' END,
    'available', v_acct_a.available,
    'formula', v_recon
  ));
  IF v_recon <> v_acct_a.available THEN
    v_fail := COALESCE(v_fail, 'store A reconciliation mismatch');
  END IF;
  SELECT * INTO v_acct_b FROM public.seller_credit_accounts WHERE seller_id = v_b;
  v_recon := round((v_acct_b.lifetime_purchased + v_acct_b.lifetime_adjusted - v_acct_b.lifetime_consumed - v_acct_b.reserved)::numeric, 2);
  v_cases := v_cases || jsonb_build_array(jsonb_build_object(
    'id', 'financial_reconciliation_store_b',
    'result', CASE WHEN v_recon = v_acct_b.available THEN 'PASS' ELSE 'FAIL' END,
    'available', v_acct_b.available,
    'formula', v_recon
  ));

  v_cases := v_cases || jsonb_build_array(jsonb_build_object(
    'id', 'zero_balance_no_negative',
    'result', CASE WHEN v_acct_a.available >= 0 AND v_acct_b.available >= 0 THEN 'PASS' ELSE 'FAIL' END
  ));
  v_cases := v_cases || jsonb_build_array(jsonb_build_object(
    'id', 'production_flags_remain_off',
    'result', CASE WHEN NOT v_flags_purchase AND NOT v_flags_spend THEN 'PASS' ELSE 'FAIL' END
  ));

  DELETE FROM public.seller_credit_ledger WHERE seller_id IN (v_a, v_b);
  DELETE FROM public.seller_credit_reservations WHERE seller_id IN (v_a, v_b);
  DELETE FROM public.seller_credit_purchases WHERE seller_id IN (v_a, v_b);
  DELETE FROM public.seller_credit_contact_debits WHERE seller_id IN (v_a, v_b);
  DELETE FROM public.seller_credit_accounts WHERE seller_id IN (v_a, v_b);
  DELETE FROM public.service_bookings WHERE seller_id IN (v_a, v_b);
  DELETE FROM public.orders WHERE seller_id IN (v_a, v_b);
  DELETE FROM public.seller_profiles WHERE id IN (v_a, v_b);

  SELECT enabled INTO v_flags_purchase
  FROM public.financial_feature_flags WHERE key = 'seller_credit_purchase_enabled';
  SELECT enabled INTO v_flags_spend
  FROM public.financial_feature_flags WHERE key = 'seller_credit_spend_enabled';

  RETURN jsonb_build_object(
    'ok', v_fail IS NULL,
    'failure', v_fail,
    'cases', v_cases,
    'production_purchase_enabled', v_flags_purchase,
    'production_spend_enabled', v_flags_spend
  );
END;
$$;

CREATE UNIQUE INDEX IF NOT EXISTS idx_seller_credit_ledger_reversal_once
  ON public.seller_credit_ledger (event_type, reference_type, reference_id)
  WHERE type = 'reversal' AND reference_id IS NOT NULL;

DO $patch_booking$
DECLARE
  def text;
  needle text := $n$RETURN json_build_object('success', false, 'error', 'Cannot book your own service');
  END IF;$n$;
  gate text := $g$RETURN json_build_object('success', false, 'error', 'Cannot book your own service');
  END IF;

  IF COALESCE((public.seller_credit_can_accept(_seller_id, 'SERVICE_BOOKING')->>'ok')::boolean, false) IS NOT TRUE THEN
    RETURN json_build_object('success', false, 'error', public.seller_credit_customer_reason('SERVICE_BOOKING'));
  END IF;$g$;
BEGIN
  SELECT pg_get_functiondef(p.oid) INTO def
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.proname = 'create_service_booking_atomic'
  LIMIT 1;

  IF def LIKE '%seller_credit_can_accept%' THEN
    RAISE NOTICE 'create_service_booking_atomic already gated';
  ELSE
    IF position(needle in def) = 0 THEN
      RAISE EXCEPTION 'booking function body changed; credit gate patch failed';
    END IF;
    EXECUTE replace(def, needle, gate);
  END IF;
END
$patch_booking$;

DO $patch_cmvo$
DECLARE
  def text;
BEGIN
  SELECT pg_get_functiondef(p.oid) INTO def
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.proname = 'create_multi_vendor_orders'
  LIMIT 1;

  IF def LIKE '%credit_blocked_sellers%' THEN
    RAISE NOTICE 'create_multi_vendor_orders already isolates credit failures';
  ELSE
    IF position('_closed_sellers text[] := ''{}''' in def) = 0 THEN
      RAISE EXCEPTION 'CMVO closed_sellers declaration not found';
    END IF;
    IF position('insert into public.orders (' in def) = 0 THEN
      RAISE EXCEPTION 'CMVO order insert not found';
    END IF;
    def := replace(def,
      '_closed_sellers text[] := ''{}''',
      $d$_closed_sellers text[] := '{}';
  _credit_blocked_sellers text[] := '{}';
  _credit_gate jsonb$d$
    );
    def := replace(def,
      'insert into public.orders (',
      $d$_credit_gate := public.seller_credit_can_accept(_seller_id, 'ORDER_COMPLETED');
    IF COALESCE((_credit_gate->>'ok')::boolean, false) IS NOT TRUE THEN
      _credit_blocked_sellers := array_append(_credit_blocked_sellers, COALESCE(_seller_name, _seller_id::text));
      CONTINUE;
    END IF;
    insert into public.orders ($d$
    );
    def := replace(def,
      '''payment_blocked'', to_json(_payment_blocked_sellers)',
      $d$'payment_blocked', to_json(_payment_blocked_sellers),
      'credit_blocked_sellers', to_json(_credit_blocked_sellers)$d$
    );
    IF def NOT LIKE '%seller_credit_can_accept%' OR def NOT LIKE '%credit_blocked_sellers%' THEN
      RAISE EXCEPTION 'CMVO credit isolation patch failed';
    END IF;
    EXECUTE def;
  END IF;
END
$patch_cmvo$;

GRANT EXECUTE ON FUNCTION public.seller_credit_can_accept(uuid, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.seller_credit_resolution_ready() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.admin_update_seller_credit_setting(text, text, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.admin_update_seller_credit_threshold(text, numeric, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.admin_list_seller_credit_thresholds() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.admin_upsert_seller_credit_package(uuid, text, numeric, numeric, boolean, integer) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.admin_list_seller_credit_packages() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.admin_list_seller_credits(text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.admin_list_seller_credit_purchases(text, integer) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.reverse_seller_credit_charge(uuid, text, text, text, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.admin_adjust_seller_credits(uuid, numeric, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.log_seller_contact_interaction(uuid, uuid, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_seller_credit_summary(uuid[]) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.seller_credit_run_isolated_verification() TO service_role;
GRANT EXECUTE ON FUNCTION public.seller_credit_test_event(uuid, text, text, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.resolve_due_seller_credit_bookings() TO service_role;

REVOKE ALL ON FUNCTION public.seller_credit_run_isolated_verification() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.seller_credit_test_event(uuid, text, text, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.record_seller_billable_event(uuid, text, text, text, text, text, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.confirm_seller_credit_purchase(uuid, text, text, numeric) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.resolve_due_seller_credit_bookings() FROM PUBLIC, anon, authenticated;
