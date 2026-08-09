CREATE OR REPLACE FUNCTION public.credit_wallet_cash(
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
$$;

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

CREATE OR REPLACE FUNCTION public.restore_wallet_for_order(
  _order_id uuid,
  _cash_amount numeric DEFAULT NULL,
  _promo_amount numeric DEFAULT NULL,
  _reason text DEFAULT 'cancel'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  o public.orders;
  _cash numeric;
  _promo numeric;
  _idem text;
  _res jsonb;
BEGIN
  SELECT * INTO o FROM public.orders WHERE id = _order_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'order_not_found');
  END IF;

  _cash := ROUND(COALESCE(_cash_amount, o.wallet_cash_amount, 0)::numeric, 2);
  _promo := ROUND(COALESCE(_promo_amount, o.wallet_promo_amount, 0)::numeric, 2);

  IF _cash <= 0 AND _promo <= 0 THEN
    RETURN jsonb_build_object('success', true, 'restored', 0, 'skipped', true);
  END IF;

  _idem := 'wallet-restore:' || _order_id::text || ':' || _reason || ':' || _cash::text || ':' || _promo::text;
  IF EXISTS (SELECT 1 FROM public.wallet_ledger_txns WHERE idempotency_key = _idem) THEN
    RETURN jsonb_build_object('success', true, 'deduplicated', true, 'cash', _cash, 'promo', _promo);
  END IF;

  IF _cash > 0 THEN
    _res := public.credit_wallet_cash(
      o.buyer_id, _cash, 'spend_restore', _idem || ':cash', NULL, o.id,
      'Restored cash credit from order (' || _reason || ')'
    );
  END IF;

  IF _promo > 0 THEN
    -- Restore promo with 90-day expiry (MVP policy)
    PERFORM public.wallet_ensure_wallet(o.buyer_id);

    INSERT INTO public.wallet_credit_lots (
      user_id, bucket, source, original_amount, remaining_amount, expires_at, order_id, status
    ) VALUES (
      o.buyer_id, 'promo', 'spend_restore', _promo, _promo, now() + interval '90 days', o.id, 'open'
    );

    UPDATE public.buyer_wallets
    SET
      promo_available = promo_available + _promo,
      lifetime_credited = lifetime_credited + _promo,
      lifetime_spent = GREATEST(lifetime_spent - _promo - CASE WHEN _cash > 0 THEN 0 ELSE 0 END, 0),
      version = version + 1,
      updated_at = now()
    WHERE user_id = o.buyer_id;

    INSERT INTO public.wallet_ledger_txns (
      user_id, type, reference_type, reference_id, idempotency_key, description, metadata
    ) VALUES (
      o.buyer_id, 'spend_restore', 'order', o.id::text,
      _idem || ':promo',
      'Restored promo credit from order (' || _reason || ')',
      jsonb_build_object('promo', _promo, 'reason', _reason)
    );
  END IF;

  -- Adjust lifetime_spent for cash restore too
  IF _cash > 0 OR _promo > 0 THEN
    UPDATE public.buyer_wallets
    SET lifetime_spent = GREATEST(lifetime_spent - _cash - _promo, 0), updated_at = now()
    WHERE user_id = o.buyer_id;
  END IF;

  RETURN jsonb_build_object('success', true, 'cash', _cash, 'promo', _promo);
END;
$$;

CREATE OR REPLACE FUNCTION public.credit_wallet_from_refund(_refund_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  r public.refund_requests;
  _amt numeric;
  _res jsonb;
BEGIN
  SELECT * INTO r FROM public.refund_requests WHERE id = _refund_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'refund_not_found');
  END IF;

  _amt := ROUND(COALESCE(r.wallet_credit_amount, r.amount, 0)::numeric, 2);
  IF _amt <= 0 THEN
    RETURN jsonb_build_object('success', false, 'error', 'zero_amount');
  END IF;

  _res := public.credit_wallet_cash(
    r.buyer_id,
    _amt,
    'refund',
    'wallet-refund:' || r.id::text,
    r.id,
    r.order_id,
    'Refund credited as Sociva Credit (instant)'
  );

  UPDATE public.refund_requests
  SET wallet_credit_amount = _amt
  WHERE id = r.id AND wallet_credit_amount IS NULL;

  RETURN _res;
END;
$$;

CREATE OR REPLACE FUNCTION public.expire_wallet_lots(_batch_limit integer DEFAULT 100)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  lot record;
  _n integer := 0;
  _total numeric := 0;
  _txn_id uuid;
  _amt numeric;
BEGIN
  FOR lot IN
    SELECT *
    FROM public.wallet_credit_lots
    WHERE status = 'open'
      AND remaining_amount > 0
      AND expires_at IS NOT NULL
      AND expires_at <= now()
    ORDER BY expires_at
    LIMIT LEAST(GREATEST(COALESCE(_batch_limit, 100), 1), 500)
    FOR UPDATE SKIP LOCKED
  LOOP
    _amt := lot.remaining_amount;

    UPDATE public.wallet_credit_lots
    SET remaining_amount = 0, status = 'expired'
    WHERE id = lot.id;

    UPDATE public.buyer_wallets
    SET
      promo_available = GREATEST(promo_available - CASE WHEN lot.bucket = 'promo' THEN _amt ELSE 0 END, 0),
      cash_available = GREATEST(cash_available - CASE WHEN lot.bucket = 'cash' THEN _amt ELSE 0 END, 0),
      lifetime_expired = lifetime_expired + _amt,
      version = version + 1,
      updated_at = now()
    WHERE user_id = lot.user_id;

    INSERT INTO public.wallet_ledger_txns (
      user_id, type, reference_type, reference_id, idempotency_key, description, metadata
    ) VALUES (
      lot.user_id, 'expire', 'lot', lot.id::text,
      'wallet-expire:' || lot.id::text,
      'Expired ' || lot.bucket || ' credit ₹' || _amt::text,
      jsonb_build_object('lot_id', lot.id, 'amount', _amt, 'bucket', lot.bucket)
    )
    ON CONFLICT (idempotency_key) DO NOTHING
    RETURNING id INTO _txn_id;

    IF _txn_id IS NOT NULL THEN
      IF lot.bucket = 'promo' THEN
        PERFORM public.wallet_insert_entry(_txn_id, 'user_promo:' || lot.user_id::text, 'debit', _amt, 'promo', lot.id);
        PERFORM public.wallet_insert_entry(_txn_id, 'platform_promo_clawback', 'credit', _amt, 'promo', lot.id);
      ELSE
        PERFORM public.wallet_insert_entry(_txn_id, 'user_cash:' || lot.user_id::text, 'debit', _amt, 'cash', lot.id);
        PERFORM public.wallet_insert_entry(_txn_id, 'platform_cash_clearing', 'credit', _amt, 'cash', lot.id);
      END IF;
    END IF;

    _n := _n + 1;
    _total := _total + _amt;
  END LOOP;

  RETURN jsonb_build_object('success', true, 'expired_lots', _n, 'amount', _total);
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_wallet_liability()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _caller uuid := auth.uid();
  _cash numeric;
  _promo numeric;
  _pending numeric;
  _users integer;
BEGIN
  IF _caller IS NOT NULL AND NOT public.has_role(_caller, 'admin') THEN
    RETURN jsonb_build_object('success', false, 'error', 'forbidden');
  END IF;

  SELECT
    COALESCE(SUM(cash_available), 0),
    COALESCE(SUM(promo_available), 0),
    COALESCE(SUM(cash_pending + promo_pending), 0),
    COUNT(*)
  INTO _cash, _promo, _pending, _users
  FROM public.buyer_wallets
  WHERE status = 'active';

  RETURN jsonb_build_object(
    'success', true,
    'cash_outstanding', _cash,
    'promo_outstanding', _promo,
    'pending_holds', _pending,
    'total_liability', ROUND((_cash + _promo + _pending)::numeric, 2),
    'wallet_count', _users
  );
END;
$$;