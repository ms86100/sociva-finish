CREATE OR REPLACE FUNCTION public.release_wallet_reservation(_reservation_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  r public.wallet_reservations;
  _txn_id uuid;
BEGIN
  IF _reservation_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'reservation_required');
  END IF;

  SELECT * INTO r
  FROM public.wallet_reservations
  WHERE id = _reservation_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'reservation_not_found');
  END IF;

  IF r.status IN ('released', 'expired') THEN
    RETURN jsonb_build_object('success', true, 'reservation_id', r.id, 'status', r.status, 'deduplicated', true);
  END IF;

  IF r.status = 'committed' THEN
    RETURN jsonb_build_object('success', false, 'error', 'already_committed');
  END IF;

  IF auth.uid() IS NOT NULL AND auth.uid() IS DISTINCT FROM r.user_id
     AND NOT public.has_role(auth.uid(), 'admin') THEN
    RETURN jsonb_build_object('success', false, 'error', 'forbidden');
  END IF;

  UPDATE public.buyer_wallets
  SET
    cash_available = cash_available + r.cash_amount,
    promo_available = promo_available + r.promo_amount,
    cash_pending = GREATEST(cash_pending - r.cash_amount, 0),
    promo_pending = GREATEST(promo_pending - r.promo_amount, 0),
    version = version + 1,
    updated_at = now()
  WHERE user_id = r.user_id;

  UPDATE public.wallet_reservations
  SET status = 'released', updated_at = now()
  WHERE id = r.id;

  INSERT INTO public.wallet_ledger_txns (
    user_id, type, reference_type, reference_id, idempotency_key, description, metadata
  ) VALUES (
    r.user_id, 'spend_release', 'reservation', r.id::text,
    'wallet-release:' || r.id::text,
    'Released Sociva Credit hold',
    jsonb_build_object('cash', r.cash_amount, 'promo', r.promo_amount)
  )
  ON CONFLICT (idempotency_key) DO NOTHING
  RETURNING id INTO _txn_id;

  IF _txn_id IS NOT NULL THEN
    IF r.cash_amount > 0 THEN
      PERFORM public.wallet_insert_entry(_txn_id, 'user_cash_held:' || r.user_id::text, 'debit', r.cash_amount, 'cash');
      PERFORM public.wallet_insert_entry(_txn_id, 'user_cash:' || r.user_id::text, 'credit', r.cash_amount, 'cash');
    END IF;
    IF r.promo_amount > 0 THEN
      PERFORM public.wallet_insert_entry(_txn_id, 'user_promo_held:' || r.user_id::text, 'debit', r.promo_amount, 'promo');
      PERFORM public.wallet_insert_entry(_txn_id, 'user_promo:' || r.user_id::text, 'credit', r.promo_amount, 'promo');
    END IF;
  END IF;

  RETURN jsonb_build_object('success', true, 'reservation_id', r.id, 'status', 'released');
END;
$$;\nCREATE OR REPLACE FUNCTION public.credit_wallet_cash(
  _user_id uuid,
  _amount numeric,
  _source text DEFAULT 'refund',
  _idempotency_key text DEFAULT NULL,
  _refund_id uuid DEFAULT NULL,
  _order_id uuid DEFAULT NULL,
  _description text DEFAULT NULL,
  _expires_at timestamptz DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  w public.buyer_wallets;
  _amt numeric := ROUND(GREATEST(COALESCE(_amount, 0), 0)::numeric, 2);
  _txn_id uuid;
  _lot_id uuid;
  _existing uuid;
BEGIN
  IF _amt <= 0 THEN
    RETURN jsonb_build_object('success', false, 'error', 'amount_must_be_positive');
  END IF;

  IF _idempotency_key IS NOT NULL THEN
    SELECT id INTO _existing FROM public.wallet_ledger_txns WHERE idempotency_key = _idempotency_key;
    IF _existing IS NOT NULL THEN
      RETURN jsonb_build_object('success', true, 'txn_id', _existing, 'deduplicated', true);
    END IF;
  END IF;

  w := public.wallet_ensure_wallet(_user_id);

  INSERT INTO public.wallet_credit_lots (
    user_id, bucket, source, original_amount, remaining_amount,
    expires_at, order_id, refund_id, status
  ) VALUES (
    _user_id, 'cash', COALESCE(_source, 'refund'), _amt, _amt,
    _expires_at, _order_id, _refund_id, 'open'
  )
  RETURNING id INTO _lot_id;

  UPDATE public.buyer_wallets
  SET
    cash_available = cash_available + _amt,
    lifetime_credited = lifetime_credited + _amt,
    version = version + 1,
    updated_at = now()
  WHERE user_id = _user_id;

  INSERT INTO public.wallet_ledger_txns (
    user_id, type, reference_type, reference_id, idempotency_key, description, metadata
  ) VALUES (
    _user_id,
    CASE WHEN _source = 'refund' THEN 'refund_credit' ELSE 'adjust' END,
    COALESCE(CASE WHEN _refund_id IS NOT NULL THEN 'refund' WHEN _order_id IS NOT NULL THEN 'order' ELSE 'admin' END, 'admin'),
    COALESCE(_refund_id::text, _order_id::text, _idempotency_key),
    _idempotency_key,
    COALESCE(_description, 'Credited ₹' || _amt::text || ' Sociva Credit (cash)'),
    jsonb_build_object('amount', _amt, 'bucket', 'cash', 'source', _source, 'lot_id', _lot_id)
  )
  RETURNING id INTO _txn_id;

  PERFORM public.wallet_insert_entry(_txn_id, 'platform_cash_clearing', 'debit', _amt, 'cash', _lot_id);
  PERFORM public.wallet_insert_entry(_txn_id, 'user_cash:' || _user_id::text, 'credit', _amt, 'cash', _lot_id);

  RETURN jsonb_build_object('success', true, 'txn_id', _txn_id, 'lot_id', _lot_id, 'amount', _amt, 'bucket', 'cash');
END;
$$;\nCREATE OR REPLACE FUNCTION public.issue_wallet_promo(
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