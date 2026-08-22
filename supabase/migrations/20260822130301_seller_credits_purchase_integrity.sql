-- Seller Credits: purchase issuance integrity, refund mapping, admin safety.
-- Does NOT enable seller_credit_spend_enabled.

ALTER TABLE public.seller_credit_purchases
  DROP CONSTRAINT IF EXISTS seller_credit_purchases_status_check;
ALTER TABLE public.seller_credit_purchases
  ADD CONSTRAINT seller_credit_purchases_status_check
  CHECK (status = ANY (ARRAY['created'::text, 'failed'::text, 'captured'::text, 'void'::text, 'refunded'::text]));

ALTER TABLE public.seller_credit_ledger
  DROP CONSTRAINT IF EXISTS seller_credit_ledger_type_check;
ALTER TABLE public.seller_credit_ledger
  ADD CONSTRAINT seller_credit_ledger_type_check
  CHECK (type = ANY (ARRAY[
    'purchase'::text,
    'reservation'::text,
    'event_charge'::text,
    'reservation_release'::text,
    'admin_adjustment'::text,
    'reversal'::text,
    'refund'::text
  ]));

CREATE UNIQUE INDEX IF NOT EXISTS idx_seller_credit_ledger_refund_once
  ON public.seller_credit_ledger (reference_id)
  WHERE reference_type = 'credit_purchase' AND type = 'refund';

-- Activation must not nag recharge while spend billing is off.
CREATE OR REPLACE FUNCTION public.seller_credit_activation_satisfied(p_seller_id uuid)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_amount numeric;
  v_available numeric;
BEGIN
  IF p_seller_id IS NULL THEN
    RETURN false;
  END IF;
  IF NOT public.seller_credit_spend_active() THEN
    RETURN true;
  END IF;
  SELECT amount INTO v_amount
  FROM public.seller_billing_rules
  WHERE event_type = 'ORDER_COMPLETED' AND enabled IS TRUE;
  v_amount := COALESCE(v_amount, 0);
  SELECT available INTO v_available
  FROM public.seller_credit_accounts
  WHERE seller_id = p_seller_id;
  RETURN COALESCE(v_available, 0) >= v_amount AND COALESCE(v_available, 0) > 0;
END;
$$;

CREATE OR REPLACE FUNCTION public.attach_seller_credit_provider_order(
  p_purchase_id uuid,
  p_provider_order_id text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row public.seller_credit_purchases;
BEGIN
  IF NOT public.seller_credit_is_privileged_actor() THEN
    RAISE EXCEPTION 'forbidden';
  END IF;
  IF p_purchase_id IS NULL OR NULLIF(btrim(COALESCE(p_provider_order_id, '')), '') IS NULL THEN
    RAISE EXCEPTION 'purchase and provider order required';
  END IF;

  SELECT * INTO v_row
  FROM public.seller_credit_purchases
  WHERE id = p_purchase_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'credit purchase not found';
  END IF;
  IF v_row.status IS DISTINCT FROM 'created' THEN
    RAISE EXCEPTION 'credit purchase is not awaiting a provider order';
  END IF;
  IF v_row.provider_order_id IS NOT NULL
     AND v_row.provider_order_id IS DISTINCT FROM p_provider_order_id THEN
    RAISE EXCEPTION 'credit purchase already bound to a different provider order';
  END IF;

  UPDATE public.seller_credit_purchases
  SET provider_order_id = p_provider_order_id,
      updated_at = now()
  WHERE id = p_purchase_id;
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
  v_other public.seller_credit_purchases;
  v_acct public.seller_credit_accounts;
  v_health text;
  v_credits numeric;
  v_uid uuid := auth.uid();
  v_led_id uuid;
  v_old_health text;
BEGIN
  IF p_purchase_id IS NULL OR p_provider_payment_id IS NULL OR length(btrim(p_provider_payment_id)) < 3 THEN
    RAISE EXCEPTION 'credit purchase and provider payment required';
  END IF;
  IF p_provider_order_id IS NULL OR length(btrim(p_provider_order_id)) < 3 THEN
    RAISE EXCEPTION 'credit purchase order mismatch';
  END IF;

  SELECT * INTO v_other
  FROM public.seller_credit_purchases
  WHERE provider = 'razorpay'
    AND provider_payment_id = p_provider_payment_id
    AND id IS DISTINCT FROM p_purchase_id
  LIMIT 1;
  IF FOUND THEN
    RAISE EXCEPTION 'payment already applied to another purchase';
  END IF;

  SELECT * INTO v_row
  FROM public.seller_credit_purchases
  WHERE id = p_purchase_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'credit purchase not found';
  END IF;

  IF NOT public.seller_credit_is_privileged_actor() THEN
    IF v_uid IS NULL
       OR NOT EXISTS (
         SELECT 1 FROM public.seller_profiles sp
         WHERE sp.id = v_row.seller_id AND sp.user_id = v_uid
       ) THEN
      RAISE EXCEPTION 'seller scope forbidden';
    END IF;
  END IF;

  IF v_row.status = 'refunded' THEN
    RAISE EXCEPTION 'credit purchase already refunded';
  END IF;

  IF v_row.provider_order_id IS NULL THEN
    RAISE EXCEPTION 'credit purchase has no provider order';
  END IF;
  IF v_row.provider_order_id IS DISTINCT FROM p_provider_order_id THEN
    RAISE EXCEPTION 'credit purchase order mismatch';
  END IF;
  IF p_amount IS NOT NULL AND p_amount <> v_row.amount THEN
    RAISE EXCEPTION 'credit purchase amount mismatch';
  END IF;

  v_credits := COALESCE(v_row.credits_granted, v_row.amount);

  SELECT id INTO v_led_id
  FROM public.seller_credit_ledger
  WHERE type = 'purchase'
    AND reference_type = 'credit_purchase'
    AND reference_id = v_row.id::text
  LIMIT 1;

  IF v_row.status = 'captured' THEN
    IF v_row.provider_payment_id IS DISTINCT FROM p_provider_payment_id THEN
      RAISE EXCEPTION 'credit purchase already captured';
    END IF;
    IF v_led_id IS NOT NULL THEN
      SELECT * INTO v_acct FROM public.seller_credit_accounts WHERE seller_id = v_row.seller_id;
      RETURN jsonb_build_object(
        'ok', true,
        'idempotent', true,
        'purchase_id', v_row.id,
        'available', COALESCE(v_acct.available, 0)
      );
    END IF;
    -- Self-heal: captured without ledger/credits. Issue once.
  ELSIF v_led_id IS NOT NULL THEN
    UPDATE public.seller_credit_purchases
    SET status = 'captured',
        provider_payment_id = p_provider_payment_id,
        credits_granted = v_credits,
        captured_at = COALESCE(captured_at, now()),
        updated_at = now()
    WHERE id = v_row.id
      AND status IS DISTINCT FROM 'captured';
    SELECT * INTO v_acct FROM public.seller_credit_accounts WHERE seller_id = v_row.seller_id;
    RETURN jsonb_build_object(
      'ok', true,
      'idempotent', true,
      'repaired_status', true,
      'purchase_id', v_row.id,
      'available', COALESCE(v_acct.available, 0)
    );
  END IF;

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

  UPDATE public.seller_credit_purchases
  SET status = 'captured',
      provider_payment_id = p_provider_payment_id,
      provider_order_id = v_row.provider_order_id,
      credits_granted = v_credits,
      captured_at = COALESCE(captured_at, now()),
      updated_at = now()
  WHERE id = v_row.id;

  v_health := public.seller_credit_health_for(v_acct.available);
  UPDATE public.seller_credit_accounts SET last_health = v_health WHERE seller_id = v_row.seller_id;
  PERFORM public.seller_credit_maybe_notify_health(v_row.seller_id, v_old_health, v_health, v_acct.available);
  PERFORM public.seller_credit_notify(
    v_row.seller_id,
    'seller_credit_purchased',
    'Sociva Credits added',
    public.seller_credit_format_inr(v_credits) || ' Sociva Credits added successfully.'
  );

  RETURN jsonb_build_object('ok', true, 'available', v_acct.available, 'purchase_id', v_row.id);
END;
$$;

REVOKE ALL ON FUNCTION public.confirm_seller_credit_purchase(uuid, text, text, numeric) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.confirm_seller_credit_purchase(uuid, text, text, numeric) TO service_role;

-- V1: refund captured purchases only when unused credits remain.
-- Razorpay refunds call this; spent credits are not silently clawed back.
CREATE OR REPLACE FUNCTION public.refund_seller_credit_purchase(
  p_purchase_id uuid,
  p_provider_refund_id text,
  p_reason text,
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
  v_credits numeric;
  v_health text;
  v_old_health text;
  v_refund_id text := NULLIF(btrim(COALESCE(p_provider_refund_id, '')), '');
BEGIN
  IF NOT public.seller_credit_is_privileged_actor() THEN
    RAISE EXCEPTION 'admin only';
  END IF;
  IF p_purchase_id IS NULL THEN
    RAISE EXCEPTION 'credit purchase required';
  END IF;
  IF NULLIF(btrim(COALESCE(p_reason, '')), '') IS NULL THEN
    RAISE EXCEPTION 'refund reason required';
  END IF;

  SELECT * INTO v_row
  FROM public.seller_credit_purchases
  WHERE id = p_purchase_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'credit purchase not found';
  END IF;

  v_credits := COALESCE(v_row.credits_granted, v_row.amount);
  IF p_amount IS NOT NULL AND p_amount <> v_row.amount THEN
    RAISE EXCEPTION 'credit refund amount mismatch';
  END IF;

  IF v_row.status = 'refunded' THEN
    IF EXISTS (
      SELECT 1 FROM public.seller_credit_ledger
      WHERE type = 'refund'
        AND reference_type = 'credit_purchase'
        AND reference_id = v_row.id::text
    ) THEN
      SELECT * INTO v_acct FROM public.seller_credit_accounts WHERE seller_id = v_row.seller_id;
      RETURN jsonb_build_object(
        'ok', true,
        'idempotent', true,
        'purchase_id', v_row.id,
        'available', COALESCE(v_acct.available, 0)
      );
    END IF;
  ELSIF v_row.status IS DISTINCT FROM 'captured' THEN
    RAISE EXCEPTION 'only captured credit purchases can be refunded';
  END IF;

  v_acct := public.seller_credit_ensure_account(v_row.seller_id);
  v_old_health := v_acct.last_health;
  IF v_acct.available < v_credits THEN
    RAISE EXCEPTION 'SELLER_CREDIT_REFUND_INSUFFICIENT: unused credits % are less than purchased %; use admin adjustment after review',
      v_acct.available, v_credits;
  END IF;

  UPDATE public.seller_credit_accounts
  SET available = available - v_credits,
      lifetime_purchased = GREATEST(lifetime_purchased - v_credits, 0),
      updated_at = now()
  WHERE seller_id = v_row.seller_id
    AND available >= v_credits
  RETURNING * INTO v_acct;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'SELLER_CREDIT_REFUND_INSUFFICIENT: unused credits are less than purchased amount';
  END IF;

  INSERT INTO public.seller_credit_ledger(
    seller_id, type, amount, configured_price, charged_amount, balance_after,
    reference_type, reference_id, description, created_by, metadata
  ) VALUES (
    v_row.seller_id, 'refund', -v_credits, v_row.amount, -v_credits, v_acct.available,
    'credit_purchase', v_row.id::text,
    'Refund: ' || p_reason,
    auth.uid(),
    jsonb_build_object('provider_refund_id', v_refund_id, 'reason', p_reason)
  );

  UPDATE public.seller_credit_purchases
  SET status = 'refunded',
      updated_at = now(),
      metadata = COALESCE(metadata, '{}'::jsonb) || jsonb_build_object(
        'refunded_at', now(),
        'refund_reason', p_reason,
        'provider_refund_id', v_refund_id
      )
  WHERE id = v_row.id;

  INSERT INTO public.seller_billing_rule_audit(event_type, reason, admin_id, new_amount)
  VALUES ('PURCHASE_REFUND', p_reason, auth.uid(), v_credits);

  v_health := public.seller_credit_health_for(v_acct.available);
  UPDATE public.seller_credit_accounts SET last_health = v_health WHERE seller_id = v_row.seller_id;
  PERFORM public.seller_credit_maybe_notify_health(v_row.seller_id, v_old_health, v_health, v_acct.available);
  PERFORM public.seller_credit_notify(
    v_row.seller_id,
    'seller_credit_refunded',
    'Sociva Credits refunded',
    public.seller_credit_format_inr(v_credits) || ' Sociva Credits were refunded.'
  );

  RETURN jsonb_build_object('ok', true, 'available', v_acct.available, 'purchase_id', v_row.id);
END;
$$;

REVOKE ALL ON FUNCTION public.refund_seller_credit_purchase(uuid, text, text, numeric) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.refund_seller_credit_purchase(uuid, text, text, numeric) TO authenticated, service_role;

DROP FUNCTION IF EXISTS public.admin_adjust_seller_credits(uuid, numeric, text);

CREATE OR REPLACE FUNCTION public.admin_adjust_seller_credits(
  p_seller_id uuid,
  p_amount numeric,
  p_reason text,
  p_request_id text DEFAULT NULL
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
  v_before numeric;
  v_request text := NULLIF(btrim(COALESCE(p_request_id, '')), '');
  v_existing uuid;
BEGIN
  IF NOT public.seller_credit_is_privileged_actor() THEN
    RAISE EXCEPTION 'admin only';
  END IF;
  IF p_amount = 0 THEN
    RAISE EXCEPTION 'adjustment amount cannot be zero';
  END IF;
  IF NULLIF(trim(p_reason), '') IS NULL THEN
    RAISE EXCEPTION 'reason is required';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.seller_profiles WHERE id = p_seller_id) THEN
    RAISE EXCEPTION 'seller not found';
  END IF;

  IF v_request IS NOT NULL THEN
    SELECT id INTO v_existing
    FROM public.seller_credit_ledger
    WHERE type = 'admin_adjustment'
      AND seller_id = p_seller_id
      AND metadata->>'request_id' = v_request
    LIMIT 1;
    IF v_existing IS NOT NULL THEN
      SELECT * INTO v_acct FROM public.seller_credit_accounts WHERE seller_id = p_seller_id;
      RETURN jsonb_build_object(
        'ok', true,
        'idempotent', true,
        'available', COALESCE(v_acct.available, 0),
        'ledger_id', v_existing
      );
    END IF;
  END IF;

  v_acct := public.seller_credit_ensure_account(p_seller_id);
  v_old_health := v_acct.last_health;
  v_before := v_acct.available;
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
    reference_type, description, created_by, metadata
  ) VALUES (
    p_seller_id, 'admin_adjustment', p_amount, ABS(p_amount), p_amount, v_acct.available,
    'admin_adjustment', p_reason, auth.uid(),
    jsonb_build_object(
      'request_id', v_request,
      'balance_before', v_before,
      'balance_after', v_acct.available,
      'direction', CASE WHEN p_amount > 0 THEN 'add' ELSE 'remove' END
    )
  )
  RETURNING id INTO v_existing;

  INSERT INTO public.seller_billing_rule_audit(event_type, reason, admin_id, old_amount, new_amount)
  VALUES ('ADMIN_ADJUSTMENT', p_reason, auth.uid(), v_before, v_acct.available);

  v_health := public.seller_credit_health_for(v_acct.available);
  UPDATE public.seller_credit_accounts SET last_health = v_health WHERE seller_id = p_seller_id;
  PERFORM public.seller_credit_maybe_notify_health(p_seller_id, v_old_health, v_health, v_acct.available);
  RETURN jsonb_build_object(
    'ok', true,
    'available', v_acct.available,
    'balance_before', v_before,
    'balance_after', v_acct.available,
    'ledger_id', v_existing
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_adjust_seller_credits(uuid, numeric, text, text) TO authenticated, service_role;

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
  v_before numeric;
BEGIN
  IF NULLIF(btrim(COALESCE(p_reason, '')), '') IS NULL THEN
    RAISE EXCEPTION 'reversal reason required';
  END IF;
  IF NOT public.seller_credit_is_privileged_actor() THEN
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
  IF v_led.seller_id IS DISTINCT FROM p_seller_id THEN
    RAISE EXCEPTION 'seller does not match original charge';
  END IF;

  v_acct := public.seller_credit_ensure_account(p_seller_id);
  v_before := v_acct.available;
  UPDATE public.seller_credit_accounts
  SET available = available + ABS(v_led.charged_amount),
      lifetime_consumed = GREATEST(lifetime_consumed - ABS(v_led.charged_amount), 0),
      lifetime_adjusted = lifetime_adjusted + ABS(v_led.charged_amount),
      updated_at = now()
  WHERE seller_id = p_seller_id
  RETURNING * INTO v_acct;

  INSERT INTO public.seller_credit_ledger(
    seller_id, type, event_type, amount, configured_price, charged_amount,
    balance_after, reference_type, reference_id, description, created_by,
    metadata
  ) VALUES (
    p_seller_id, 'reversal', p_event_type, ABS(v_led.charged_amount), v_led.configured_price, 0,
    v_acct.available, p_reference_type, p_reference_id,
    'Reversal: ' || p_reason, auth.uid(),
    jsonb_build_object(
      'original_ledger_id', v_led.id,
      'balance_before', v_before,
      'balance_after', v_acct.available
    )
  );

  INSERT INTO public.seller_billing_rule_audit(event_type, reason, admin_id, new_amount)
  VALUES ('CHARGE_REVERSAL:' || p_event_type, p_reason, auth.uid(), ABS(v_led.charged_amount));

  RETURN jsonb_build_object('ok', true, 'available', v_acct.available, 'balance_before', v_before);
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
  IF p_key IN ('seller_failure_policy', 'dispute_policy') THEN
    RAISE EXCEPTION 'V1 locked: seller failure always releases; disputes use Admin reversal — this setting is not configurable';
  END IF;
  IF p_key NOT IN (
    'booking_resolution_grace_minutes',
    'buyer_no_show_policy',
    'unresolved_after_grace_policy',
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
     AND p_value NOT IN ('commit', 'release') THEN
    RAISE EXCEPTION 'policy must be commit or release';
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

CREATE OR REPLACE FUNCTION public.admin_list_reversible_seller_charges(p_limit integer DEFAULT 40)
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
        led.id,
        led.seller_id,
        sp.business_name,
        led.event_type,
        led.reference_type,
        led.reference_id,
        ABS(COALESCE(led.charged_amount, led.amount)) AS amount,
        led.description,
        led.created_at,
        led.balance_after
      FROM public.seller_credit_ledger led
      JOIN public.seller_profiles sp ON sp.id = led.seller_id
      WHERE led.type = 'event_charge'
        AND NOT EXISTS (
          SELECT 1 FROM public.seller_credit_ledger rev
          WHERE rev.type = 'reversal'
            AND rev.event_type = led.event_type
            AND rev.reference_type = led.reference_type
            AND rev.reference_id = led.reference_id
        )
      ORDER BY led.created_at DESC
      LIMIT GREATEST(COALESCE(p_limit, 40), 1)
    ) x
  ), '[]'::jsonb);
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_list_seller_credit_ledger(p_limit integer DEFAULT 50)
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
        led.id,
        led.seller_id,
        sp.business_name,
        led.type,
        led.event_type,
        led.amount,
        led.balance_after,
        led.reference_type,
        led.reference_id,
        led.description,
        led.created_by,
        led.created_at
      FROM public.seller_credit_ledger led
      JOIN public.seller_profiles sp ON sp.id = led.seller_id
      ORDER BY led.created_at DESC
      LIMIT GREATEST(COALESCE(p_limit, 50), 1)
    ) x
  ), '[]'::jsonb);
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_list_reversible_seller_charges(integer) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.admin_list_seller_credit_ledger(integer) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.attach_seller_credit_provider_order(uuid, text) TO service_role;
REVOKE ALL ON FUNCTION public.attach_seller_credit_provider_order(uuid, text) FROM PUBLIC, anon, authenticated;

-- Keep V1 locked rows as documentation only. Runtime does not read them.
UPDATE public.seller_credit_settings
SET value = 'release'
WHERE key = 'seller_failure_policy';
UPDATE public.seller_credit_settings
SET value = 'admin_reversal'
WHERE key = 'dispute_policy';
