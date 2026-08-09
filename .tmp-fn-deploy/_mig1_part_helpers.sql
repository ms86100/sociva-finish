-- 2. Helpers
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.wallet_ensure_wallet(_user_id uuid)
RETURNS public.buyer_wallets
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  w public.buyer_wallets;
BEGIN
  IF _user_id IS NULL THEN
    RAISE EXCEPTION 'user_id required';
  END IF;

  INSERT INTO public.buyer_wallets (user_id)
  VALUES (_user_id)
  ON CONFLICT (user_id) DO NOTHING;

  SELECT * INTO w
  FROM public.buyer_wallets
  WHERE user_id = _user_id
  FOR UPDATE;

  RETURN w;
END;
$$;

CREATE OR REPLACE FUNCTION public.wallet_plan_spend(
  _cash_available numeric,
  _promo_available numeric,
  _amount numeric
)
RETURNS jsonb
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  _want numeric := ROUND(GREATEST(COALESCE(_amount, 0), 0)::numeric, 2);
  _promo numeric;
  _cash numeric;
BEGIN
  _promo := LEAST(ROUND(GREATEST(COALESCE(_promo_available, 0), 0)::numeric, 2), _want);
  _cash := LEAST(
    ROUND(GREATEST(COALESCE(_cash_available, 0), 0)::numeric, 2),
    ROUND((_want - _promo)::numeric, 2)
  );
  RETURN jsonb_build_object(
    'promo_amount', _promo,
    'cash_amount', _cash,
    'total', ROUND((_promo + _cash)::numeric, 2),
    'shortfall', ROUND(GREATEST(_want - _promo - _cash, 0)::numeric, 2)
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.wallet_insert_entry(
  _txn_id uuid,
  _account text,
  _direction text,
  _amount numeric,
  _bucket text DEFAULT NULL,
  _lot_id uuid DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF COALESCE(_amount, 0) <= 0 THEN
    RETURN;
  END IF;
  INSERT INTO public.wallet_ledger_entries (
    txn_id, account, direction, amount, bucket, lot_id
  ) VALUES (
    _txn_id, _account, _direction, ROUND(_amount::numeric, 2), _bucket, _lot_id
  );
END;
$$;

-- Consume open lots FIFO (inventory only; liability moved via held→order entries)
CREATE OR REPLACE FUNCTION public.wallet_consume_lots(
  _user_id uuid,
  _bucket text,
  _amount numeric
)
RETURNS numeric
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _need numeric := ROUND(GREATEST(COALESCE(_amount, 0), 0)::numeric, 2);
  _orig numeric := _need;
  _take numeric;
  lot record;
BEGIN
  IF _need <= 0 THEN
    RETURN 0;
  END IF;

  FOR lot IN
    SELECT *
    FROM public.wallet_credit_lots
    WHERE user_id = _user_id
      AND bucket = _bucket
      AND status = 'open'
      AND remaining_amount > 0
      AND (expires_at IS NULL OR expires_at > now())
    ORDER BY
      CASE WHEN expires_at IS NULL THEN 1 ELSE 0 END,
      expires_at ASC NULLS LAST,
      created_at ASC
    FOR UPDATE
  LOOP
    EXIT WHEN _need <= 0;
    _take := LEAST(lot.remaining_amount, _need);
    UPDATE public.wallet_credit_lots
    SET
      remaining_amount = remaining_amount - _take,
      status = CASE WHEN remaining_amount - _take <= 0 THEN 'depleted' ELSE status END
    WHERE id = lot.id;
    _need := ROUND((_need - _take)::numeric, 2);
  END LOOP;

  RETURN ROUND((_orig - _need)::numeric, 2);
END;
$$;

-- ------------------------------------------------------------
