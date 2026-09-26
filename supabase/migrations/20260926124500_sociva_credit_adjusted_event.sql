-- Who granted Sociva credit stays on the ledger. Amplitude gets a code-only event.

CREATE OR REPLACE FUNCTION public.emit_sociva_credit_adjusted(
  p_seller_id uuid,
  p_amount numeric,
  p_reason text,
  p_admin_id uuid,
  p_ledger_id uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_key text;
  v_reason_code text;
  v_direction text;
BEGIN
  SELECT decrypted_secret INTO v_key
  FROM vault.decrypted_secrets
  WHERE name = 'amplitude_api_key'
  LIMIT 1;

  IF v_key IS NULL OR length(btrim(v_key)) < 8 THEN
    RETURN;
  END IF;

  v_direction := CASE WHEN p_amount > 0 THEN 'add' ELSE 'remove' END;
  v_reason_code := CASE
    WHEN p_amount = 500 AND COALESCE(p_reason, '') ~* 'welcome|onboard' THEN 'onboarding'
    WHEN p_amount < 0 THEN 'removal'
    ELSE 'admin_adjustment'
  END;

  BEGIN
    PERFORM net.http_post(
      url := 'https://api2.amplitude.com/2/httpapi',
      headers := jsonb_build_object('Content-Type', 'application/json'),
      body := jsonb_build_object(
        'api_key', v_key,
        'events', jsonb_build_array(jsonb_build_object(
          'user_id', p_seller_id::text,
          'event_type', 'sociva_credit_adjusted',
          'insert_id', p_ledger_id::text,
          'event_properties', jsonb_build_object(
            'store_id', p_seller_id,
            'amount', p_amount,
            'direction', v_direction,
            'reason_code', v_reason_code,
            'admin_present', p_admin_id IS NOT NULL
          )
        ))
      )
    );
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'emit_sociva_credit_adjusted skipped: %', SQLERRM;
  END;
END;
$$;

REVOKE ALL ON FUNCTION public.emit_sociva_credit_adjusted(uuid, numeric, text, uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.emit_sociva_credit_adjusted(uuid, numeric, text, uuid, uuid) TO service_role;

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
  v_max numeric := 50000;
  v_actor uuid := auth.uid();
BEGIN
  IF NOT public.seller_credit_is_privileged_actor() THEN
    RAISE EXCEPTION 'admin only';
  END IF;
  IF p_amount = 0 THEN
    RAISE EXCEPTION 'adjustment amount cannot be zero';
  END IF;
  IF ABS(p_amount) > v_max THEN
    RAISE EXCEPTION 'adjustment exceeds V1 maximum of %', v_max;
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
    'admin_adjustment', p_reason, v_actor,
    jsonb_build_object(
      'request_id', v_request,
      'balance_before', v_before,
      'balance_after', v_acct.available,
      'direction', CASE WHEN p_amount > 0 THEN 'add' ELSE 'remove' END
    )
  )
  RETURNING id INTO v_existing;

  INSERT INTO public.seller_billing_rule_audit(event_type, reason, admin_id, old_amount, new_amount)
  VALUES ('ADMIN_ADJUSTMENT', p_reason, v_actor, v_before, v_acct.available);

  PERFORM public.emit_sociva_credit_adjusted(p_seller_id, p_amount, p_reason, v_actor, v_existing);

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

-- Only a welcome grant of exactly 500 with a matching admin audit row.
UPDATE public.seller_credit_ledger led
SET created_by = src.admin_id
FROM (
  SELECT DISTINCT ON (led.id) led.id, a.admin_id
  FROM public.seller_credit_ledger led
  JOIN public.seller_billing_rule_audit a
    ON a.event_type = 'ADMIN_ADJUSTMENT'
   AND a.admin_id IS NOT NULL
   AND a.created_at BETWEEN led.created_at - interval '2 minutes' AND led.created_at + interval '2 minutes'
   AND a.new_amount IS NOT DISTINCT FROM led.balance_after
  WHERE led.created_by IS NULL
    AND led.type = 'admin_adjustment'
    AND led.amount = 500
    AND COALESCE(led.description, '') ~* 'welcome|onboard'
  ORDER BY led.id, a.created_at DESC
) src
WHERE led.id = src.id;

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
        pr.name AS created_by_name,
        led.created_at
      FROM public.seller_credit_ledger led
      JOIN public.seller_profiles sp ON sp.id = led.seller_id
      LEFT JOIN public.profiles pr ON pr.id = led.created_by
      ORDER BY led.created_at DESC
      LIMIT GREATEST(COALESCE(p_limit, 50), 1)
    ) x
  ), '[]'::jsonb);
END;
$$;
