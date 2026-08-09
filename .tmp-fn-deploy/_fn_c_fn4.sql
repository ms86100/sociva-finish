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