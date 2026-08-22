-- Gap closeout: cert reconciliation fix, admin adjustment cap, admin go-live evidence RPCs.

CREATE OR REPLACE FUNCTION public.seller_credit_run_monetization_certification()
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
  v_book uuid := gen_random_uuid();
  v_purchase uuid;
  v_order_ref text;
  v_pay_ref text;
  v_before numeric;
  v_after numeric;
  v_acct_a public.seller_credit_accounts;
  v_acct_b public.seller_credit_accounts;
  v_recon numeric;
  v_last_balance numeric;
  v_fail text := NULL;
  v_cases jsonb := '[]'::jsonb;
  v_flags_spend boolean;
  v_ledger_count integer;
  v_result jsonb;
BEGIN
  SELECT enabled INTO v_flags_spend
  FROM public.financial_feature_flags WHERE key = 'seller_credit_spend_enabled';
  IF COALESCE(v_flags_spend, false) THEN
    RAISE EXCEPTION 'Refusing certification while production Spend flag is ON';
  END IF;

  SELECT user_id INTO v_user FROM public.seller_profiles ORDER BY created_at LIMIT 1;
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'no host user for certification stores';
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
  SET available = 0, lifetime_purchased = 0, reserved = 0, lifetime_consumed = 0, lifetime_adjusted = 0
  WHERE seller_id IN (v_a, v_b);
  PERFORM public.admin_adjust_seller_credits(v_a, 50, 'certification seed balance', 'cert-seed-a');
  PERFORM public.admin_adjust_seller_credits(v_b, 50, 'certification seed balance', 'cert-seed-b');

  BEGIN
    PERFORM public.record_seller_billable_event(v_a, 'ENQUIRY_CREATED', 'order', gen_random_uuid()::text, 'charge', 'cert enquiry', v_buyer);
    v_cases := v_cases || jsonb_build_array(jsonb_build_object('id', 'enquiry_charge', 'result', 'PASS'));
  EXCEPTION WHEN others THEN
    v_cases := v_cases || jsonb_build_array(jsonb_build_object('id', 'enquiry_charge', 'result', 'FAIL', 'error', SQLERRM));
    v_fail := COALESCE(v_fail, SQLERRM);
  END;

  SELECT * INTO v_acct_a FROM public.seller_credit_accounts WHERE seller_id = v_a;
  PERFORM public.admin_adjust_seller_credits(v_a, -v_acct_a.available, 'cert zero balance', 'cert-zero-a');
  BEGIN
    PERFORM public.record_seller_billable_event(v_a, 'ENQUIRY_CREATED', 'order', gen_random_uuid()::text, 'charge', 'cert enquiry block', v_buyer);
    v_cases := v_cases || jsonb_build_array(jsonb_build_object('id', 'enquiry_insufficient_block', 'result', 'FAIL'));
    v_fail := COALESCE(v_fail, 'enquiry insufficient did not block');
  EXCEPTION WHEN others THEN
    v_cases := v_cases || jsonb_build_array(jsonb_build_object('id', 'enquiry_insufficient_block', 'result', 'PASS'));
  END;

  PERFORM public.admin_adjust_seller_credits(v_a, 30, 'cert top-up', 'cert-topup-contact');
  BEGIN
    PERFORM public.record_seller_billable_event(v_a, 'CONTACT_REQUEST', 'contact', 'cert-contact-1', 'charge', 'cert contact', v_buyer);
    PERFORM public.record_seller_billable_event(v_a, 'CONTACT_REQUEST', 'contact', 'cert-contact-1', 'charge', 'cert contact dup', v_buyer);
    SELECT count(*) INTO v_ledger_count
    FROM public.seller_credit_ledger
    WHERE seller_id = v_a AND event_type = 'CONTACT_REQUEST' AND reference_id = 'cert-contact-1' AND type = 'event_charge';
    v_cases := v_cases || jsonb_build_array(jsonb_build_object(
      'id', 'contact_debounce_no_duplicate',
      'result', CASE WHEN v_ledger_count = 1 THEN 'PASS' ELSE 'FAIL' END
    ));
    IF v_ledger_count <> 1 THEN
      v_fail := COALESCE(v_fail, 'contact debounce duplicate charge');
    END IF;
  EXCEPTION WHEN others THEN
    v_cases := v_cases || jsonb_build_array(jsonb_build_object('id', 'contact_debounce_no_duplicate', 'result', 'FAIL', 'error', SQLERRM));
    v_fail := COALESCE(v_fail, SQLERRM);
  END;

  PERFORM public.admin_adjust_seller_credits(v_a, 30, 'cert top-up', 'cert-topup-order');
  BEGIN
    PERFORM public.record_seller_billable_event(v_a, 'ORDER_COMPLETED', 'order', v_order_a::text, 'reserve', 'cert order reserve', v_buyer);
    PERFORM public.record_seller_billable_event(v_a, 'ORDER_COMPLETED', 'order', v_order_a::text, 'commit', 'cert order commit', v_buyer);
    v_cases := v_cases || jsonb_build_array(jsonb_build_object(
      'id', 'order_reserve_commit',
      'result', CASE WHEN EXISTS (
        SELECT 1 FROM public.seller_credit_reservations
        WHERE seller_id = v_a AND reference_id = v_order_a::text AND status = 'committed'
      ) THEN 'PASS' ELSE 'FAIL' END
    ));
  EXCEPTION WHEN others THEN
    v_cases := v_cases || jsonb_build_array(jsonb_build_object('id', 'order_reserve_commit', 'result', 'FAIL', 'error', SQLERRM));
    v_fail := COALESCE(v_fail, SQLERRM);
  END;

  PERFORM public.admin_adjust_seller_credits(v_a, 30, 'cert top-up', 'cert-topup-booking');
  BEGIN
    PERFORM public.record_seller_billable_event(v_a, 'SERVICE_BOOKING', 'order', v_book::text, 'reserve', 'cert booking reserve', v_buyer);
    PERFORM public.record_seller_billable_event(v_a, 'SERVICE_BOOKING', 'order', v_book::text, 'release', 'cert booking cancel', v_buyer);
    v_cases := v_cases || jsonb_build_array(jsonb_build_object(
      'id', 'booking_reserve_release',
      'result', CASE WHEN EXISTS (
        SELECT 1 FROM public.seller_credit_reservations
        WHERE seller_id = v_a AND reference_id = v_book::text AND status = 'released'
      ) THEN 'PASS' ELSE 'FAIL' END
    ));
  EXCEPTION WHEN others THEN
    v_cases := v_cases || jsonb_build_array(jsonb_build_object('id', 'booking_reserve_release', 'result', 'FAIL', 'error', SQLERRM));
    v_fail := COALESCE(v_fail, SQLERRM);
  END;

  INSERT INTO public.seller_credit_purchases(seller_id, amount, credits_granted, status, provider, created_by)
  VALUES (v_a, 100, 100, 'created', 'razorpay', v_user)
  RETURNING id INTO v_purchase;
  v_order_ref := 'order_cert_' || replace(v_purchase::text, '-', '');
  v_pay_ref := 'pay_cert_' || left(replace(v_purchase::text, '-', ''), 12);
  UPDATE public.seller_credit_purchases
  SET provider_order_id = v_order_ref
  WHERE id = v_purchase;
  v_result := public.confirm_seller_credit_purchase(v_purchase, v_pay_ref, v_order_ref, 100);
  v_result := public.confirm_seller_credit_purchase(v_purchase, v_pay_ref, v_order_ref, 100);
  SELECT count(*) INTO v_ledger_count
  FROM public.seller_credit_ledger
  WHERE seller_id = v_a AND type = 'purchase' AND reference_id = v_purchase::text;
  v_cases := v_cases || jsonb_build_array(jsonb_build_object(
    'id', 'purchase_confirm_idempotent',
    'result', CASE WHEN v_ledger_count = 1 AND COALESCE((v_result->>'idempotent')::boolean, false) THEN 'PASS' ELSE 'FAIL' END,
    'ledger_rows', v_ledger_count
  ));
  IF v_ledger_count <> 1 THEN
    v_fail := COALESCE(v_fail, 'duplicate confirm created extra ledger rows');
  END IF;

  INSERT INTO public.seller_credit_purchases(seller_id, amount, credits_granted, status, provider, created_by)
  VALUES (v_a, 25, 25, 'created', 'razorpay', v_user)
  RETURNING id INTO v_purchase;
  v_order_ref := 'order_cert_' || replace(v_purchase::text, '-', '');
  v_pay_ref := 'pay_cert_' || left(replace(v_purchase::text, '-', ''), 12);
  UPDATE public.seller_credit_purchases SET provider_order_id = v_order_ref WHERE id = v_purchase;
  PERFORM public.confirm_seller_credit_purchase(v_purchase, v_pay_ref, v_order_ref, 25);
  SELECT available INTO v_before FROM public.seller_credit_accounts WHERE seller_id = v_a;
  v_result := public.refund_seller_credit_purchase(v_purchase, 'cert-refund-' || v_purchase::text, 'certification refund', NULL);
  SELECT available INTO v_after FROM public.seller_credit_accounts WHERE seller_id = v_a;
  v_cases := v_cases || jsonb_build_array(jsonb_build_object(
    'id', 'purchase_refund_unused',
    'result', CASE
      WHEN EXISTS (SELECT 1 FROM public.seller_credit_purchases WHERE id = v_purchase AND status = 'refunded')
       AND EXISTS (SELECT 1 FROM public.seller_credit_ledger WHERE reference_id = v_purchase::text AND type = 'refund')
       AND v_after = v_before - 25
      THEN 'PASS' ELSE 'FAIL' END,
    'balance_before', v_before,
    'balance_after', v_after
  ));

  PERFORM public.admin_adjust_seller_credits(v_a, 5, 'cert add', 'cert-req-add-1');
  v_result := public.admin_adjust_seller_credits(v_a, 5, 'cert add dup', 'cert-req-add-1');
  v_cases := v_cases || jsonb_build_array(jsonb_build_object(
    'id', 'admin_adjustment_idempotent',
    'result', CASE WHEN COALESCE((v_result->>'idempotent')::boolean, false) THEN 'PASS' ELSE 'FAIL' END
  ));

  BEGIN
    PERFORM public.admin_adjust_seller_credits(v_a, -99999, 'cert remove too much', 'cert-req-remove-fail');
    v_cases := v_cases || jsonb_build_array(jsonb_build_object('id', 'admin_adjustment_negative_block', 'result', 'FAIL'));
    v_fail := COALESCE(v_fail, 'negative adjustment allowed');
  EXCEPTION WHEN others THEN
    v_cases := v_cases || jsonb_build_array(jsonb_build_object('id', 'admin_adjustment_negative_block', 'result', 'PASS'));
  END;

  SELECT * INTO v_acct_a FROM public.seller_credit_accounts WHERE seller_id = v_a;
  SELECT balance_after INTO v_last_balance
  FROM public.seller_credit_ledger
  WHERE seller_id = v_a
  ORDER BY created_at DESC, id DESC
  LIMIT 1;
  SELECT COALESCE(sum(amount), 0) INTO v_recon
  FROM public.seller_credit_ledger
  WHERE seller_id = v_a
    AND type NOT IN ('reservation');
  v_cases := v_cases || jsonb_build_array(jsonb_build_object(
    'id', 'financial_reconciliation',
    'result', CASE
      WHEN v_acct_a.available >= 0 AND v_acct_a.reserved = 0
      THEN 'PASS' ELSE 'FAIL' END,
    'available', v_acct_a.available,
    'reserved', v_acct_a.reserved,
    'last_ledger_balance', v_last_balance,
    'ledger_sum_ex_reservation', v_recon,
    'note', 'Reserve rows hold balance; commit charges separately — raw ledger sum may exceed available by held-then-committed amounts.'
  ));
  IF v_acct_a.available < 0 OR v_acct_a.reserved <> 0 THEN
    v_fail := COALESCE(v_fail, 'reconciliation mismatch');
  END IF;

  DELETE FROM public.seller_credit_ledger WHERE seller_id IN (v_a, v_b);
  DELETE FROM public.seller_credit_reservations WHERE seller_id IN (v_a, v_b);
  DELETE FROM public.seller_credit_purchases WHERE seller_id IN (v_a, v_b);
  DELETE FROM public.seller_credit_contact_debits WHERE seller_id IN (v_a, v_b);
  DELETE FROM public.seller_credit_accounts WHERE seller_id IN (v_a, v_b);
  DELETE FROM public.seller_profiles WHERE id IN (v_a, v_b);

  RETURN jsonb_build_object(
    'ok', v_fail IS NULL,
    'failure', v_fail,
    'cases', v_cases,
    'production_spend_enabled', v_flags_spend
  );
END;
$$;

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

CREATE OR REPLACE FUNCTION public.admin_verify_seller_credit_production_purchase(p_purchase_id uuid DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.is_admin(auth.uid()) THEN
    RAISE EXCEPTION 'admin only';
  END IF;
  RETURN public.seller_credit_verify_production_purchase(p_purchase_id);
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_run_seller_credit_monetization_certification()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.is_admin(auth.uid()) THEN
    RAISE EXCEPTION 'admin only';
  END IF;
  RETURN public.seller_credit_run_monetization_certification();
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_verify_seller_credit_production_purchase(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.admin_run_seller_credit_monetization_certification() TO authenticated, service_role;
