CREATE OR REPLACE FUNCTION public.issue_wallet_promo(
  _user_id uuid,
  _amount numeric,
  _expires_at timestamptz,
  _source text DEFAULT 'promo_campaign',
  _idempotency_key text DEFAULT NULL,
  _campaign_id text DEFAULT NULL,
  _description text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _amt numeric := ROUND(GREATEST(COALESCE(_amount, 0), 0)::numeric, 2);
  _txn_id uuid;
  _lot_id uuid;
  _existing uuid;
  _caller uuid := auth.uid();
BEGIN
  -- Admin or service_role (auth.uid null under service)
  IF _caller IS NOT NULL AND NOT public.has_role(_caller, 'admin') THEN
    RETURN jsonb_build_object('success', false, 'error', 'forbidden');
  END IF;

  IF _amt <= 0 THEN
    RETURN jsonb_build_object('success', false, 'error', 'amount_must_be_positive');
  END IF;

  IF _expires_at IS NULL OR _expires_at <= now() THEN
    RETURN jsonb_build_object('success', false, 'error', 'expires_at_required');
  END IF;

  IF _idempotency_key IS NOT NULL THEN
    SELECT id INTO _existing FROM public.wallet_ledger_txns WHERE idempotency_key = _idempotency_key;
    IF _existing IS NOT NULL THEN
      RETURN jsonb_build_object('success', true, 'txn_id', _existing, 'deduplicated', true);
    END IF;
  END IF;

  PERFORM public.wallet_ensure_wallet(_user_id);

  INSERT INTO public.wallet_credit_lots (
    user_id, bucket, source, original_amount, remaining_amount,
    expires_at, campaign_id, status
  ) VALUES (
    _user_id, 'promo', COALESCE(_source, 'promo_campaign'), _amt, _amt,
    _expires_at, _campaign_id, 'open'
  )
  RETURNING id INTO _lot_id;

  UPDATE public.buyer_wallets
  SET
    promo_available = promo_available + _amt,
    lifetime_credited = lifetime_credited + _amt,
    version = version + 1,
    updated_at = now()
  WHERE user_id = _user_id;

  INSERT INTO public.wallet_ledger_txns (
    user_id, type, reference_type, reference_id, idempotency_key, description, created_by, metadata
  ) VALUES (
    _user_id, 'promo_issue', 'campaign', COALESCE(_campaign_id, _idempotency_key),
    _idempotency_key,
    COALESCE(_description, 'Promo credit ₹' || _amt::text),
    _caller,
    jsonb_build_object('amount', _amt, 'expires_at', _expires_at, 'lot_id', _lot_id)
  )
  RETURNING id INTO _txn_id;

  PERFORM public.wallet_insert_entry(_txn_id, 'platform_promo_expense', 'debit', _amt, 'promo', _lot_id);
  PERFORM public.wallet_insert_entry(_txn_id, 'user_promo:' || _user_id::text, 'credit', _amt, 'promo', _lot_id);

  RETURN jsonb_build_object('success', true, 'txn_id', _txn_id, 'lot_id', _lot_id, 'amount', _amt);
END;
$$;