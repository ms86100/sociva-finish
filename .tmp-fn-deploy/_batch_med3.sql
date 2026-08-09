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
$$;\nCREATE OR REPLACE FUNCTION public.expire_wallet_lots(_batch_limit integer DEFAULT 100)
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