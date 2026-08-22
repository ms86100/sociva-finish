-- Lock down table grants (TRUNCATE bypasses RLS), require a real admin JWT for
-- credit mutations, and replace the isolated overspend harness subtransaction bug.

REVOKE ALL ON TABLE
  public.seller_credit_accounts,
  public.seller_credit_ledger,
  public.seller_credit_packages,
  public.seller_credit_purchases,
  public.seller_credit_reservations,
  public.seller_credit_settings,
  public.seller_credit_thresholds,
  public.seller_credit_contact_debits
FROM PUBLIC, anon, authenticated;

GRANT SELECT ON TABLE
  public.seller_credit_accounts,
  public.seller_credit_ledger,
  public.seller_credit_packages,
  public.seller_credit_purchases,
  public.seller_credit_reservations,
  public.seller_credit_thresholds
TO authenticated;

ALTER TABLE public.seller_credit_accounts FORCE ROW LEVEL SECURITY;
ALTER TABLE public.seller_credit_ledger FORCE ROW LEVEL SECURITY;
ALTER TABLE public.seller_credit_packages FORCE ROW LEVEL SECURITY;
ALTER TABLE public.seller_credit_purchases FORCE ROW LEVEL SECURITY;
ALTER TABLE public.seller_credit_reservations FORCE ROW LEVEL SECURITY;
ALTER TABLE public.seller_credit_settings FORCE ROW LEVEL SECURITY;
ALTER TABLE public.seller_credit_thresholds FORCE ROW LEVEL SECURITY;
ALTER TABLE public.seller_credit_contact_debits FORCE ROW LEVEL SECURITY;

REVOKE ALL ON FUNCTION public.admin_adjust_seller_credits(uuid, numeric, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.reverse_seller_credit_charge(uuid, text, text, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_adjust_seller_credits(uuid, numeric, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.reverse_seller_credit_charge(uuid, text, text, text, text) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.seller_credit_is_privileged_actor()
RETURNS boolean
LANGUAGE plpgsql
STABLE
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NOT NULL AND public.is_admin(auth.uid()) THEN
    RETURN true;
  END IF;
  RETURN current_user IN ('postgres', 'supabase_admin', 'service_role');
END;
$$;

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
  IF NOT public.seller_credit_is_privileged_actor() THEN
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

ALTER FUNCTION public.seller_credit_run_isolated_verification()
  RENAME TO seller_credit_run_isolated_verification_legacy;

CREATE OR REPLACE FUNCTION public.seller_credit_run_isolated_verification()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_legacy jsonb;
  v_over jsonb;
  v_cases jsonb;
  v_all_pass boolean;
BEGIN
  v_legacy := public.seller_credit_run_isolated_verification_legacy();
  v_over := public.seller_credit_verify_overspend();

  SELECT coalesce(jsonb_agg(
    CASE WHEN elem->>'id' = 'sequential_overspend_guard'
      THEN jsonb_build_object(
        'id', 'sequential_overspend_guard',
        'result', CASE
          WHEN COALESCE((v_over->>'ok')::boolean, false)
           AND COALESCE((v_over->>'second_failed')::boolean, false)
           AND COALESCE((v_over->>'available')::numeric, -1) = 5
          THEN 'PASS'
          ELSE 'FAIL'
        END,
        'data', v_over
      )
      ELSE elem
    END
  ), '[]'::jsonb)
  INTO v_cases
  FROM jsonb_array_elements(COALESCE(v_legacy->'cases', '[]'::jsonb)) elem;

  SELECT coalesce(bool_and(elem->>'result' = 'PASS'), false)
  INTO v_all_pass
  FROM jsonb_array_elements(v_cases) elem;

  RETURN jsonb_build_object(
    'ok', v_all_pass,
    'failure', CASE WHEN v_all_pass THEN NULL ELSE 'one or more isolated cases failed' END,
    'cases', v_cases,
    'production_purchase_enabled', v_legacy->'production_purchase_enabled',
    'production_spend_enabled', v_legacy->'production_spend_enabled'
  );
END;
$$;

REVOKE ALL ON FUNCTION public.seller_credit_run_isolated_verification() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.seller_credit_run_isolated_verification_legacy() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.seller_credit_run_isolated_verification() TO service_role;
GRANT EXECUTE ON FUNCTION public.seller_credit_run_isolated_verification_legacy() TO service_role;
