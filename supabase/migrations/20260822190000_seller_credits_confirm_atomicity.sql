-- Strengthen credit purchase confirmation: ledger-before-captured invariant + self-heal without double-credit.

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
  v_issued numeric;
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

  IF v_led_id IS NOT NULL THEN
    IF v_row.status IS DISTINCT FROM 'captured' THEN
      UPDATE public.seller_credit_purchases
      SET status = 'captured',
          provider_payment_id = COALESCE(provider_payment_id, p_provider_payment_id),
          credits_granted = v_credits,
          captured_at = COALESCE(captured_at, now()),
          updated_at = now()
      WHERE id = v_row.id;
    ELSIF v_row.provider_payment_id IS DISTINCT FROM p_provider_payment_id THEN
      RAISE EXCEPTION 'credit purchase already captured';
    END IF;
    SELECT * INTO v_acct FROM public.seller_credit_accounts WHERE seller_id = v_row.seller_id;
    RETURN jsonb_build_object(
      'ok', true,
      'idempotent', true,
      'purchase_id', v_row.id,
      'available', COALESCE(v_acct.available, 0)
    );
  END IF;

  IF v_row.status = 'captured' THEN
    SELECT COALESCE(sum(amount), 0) INTO v_issued
    FROM public.seller_credit_ledger
    WHERE seller_id = v_row.seller_id
      AND reference_type = 'credit_purchase'
      AND reference_id = v_row.id::text;
    IF v_issued >= v_credits THEN
      SELECT * INTO v_acct FROM public.seller_credit_accounts WHERE seller_id = v_row.seller_id;
      RETURN jsonb_build_object(
        'ok', true,
        'idempotent', true,
        'purchase_id', v_row.id,
        'available', COALESCE(v_acct.available, 0)
      );
    END IF;
  ELSIF v_row.status NOT IN ('created', 'failed') THEN
    RAISE EXCEPTION 'credit purchase is not confirmable from status %', v_row.status;
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
  )
  RETURNING id INTO v_led_id;

  IF v_led_id IS NULL THEN
    RAISE EXCEPTION 'credit ledger insert failed';
  END IF;

  UPDATE public.seller_credit_purchases
  SET status = 'captured',
      provider_payment_id = p_provider_payment_id,
      provider_order_id = v_row.provider_order_id,
      credits_granted = v_credits,
      captured_at = COALESCE(captured_at, now()),
      updated_at = now()
  WHERE id = v_row.id;

  IF NOT EXISTS (
    SELECT 1 FROM public.seller_credit_ledger
    WHERE id = v_led_id
      AND reference_type = 'credit_purchase'
      AND reference_id = v_row.id::text
  ) THEN
    RAISE EXCEPTION 'credit issuance incomplete';
  END IF;

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
