-- 3. Read RPCs
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_buyer_wallet(_user_id uuid DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _uid uuid;
  w public.buyer_wallets;
  _nearest timestamptz;
BEGIN
  _uid := auth.uid();
  IF _uid IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'not_authenticated');
  END IF;

  IF _user_id IS NOT NULL AND _user_id IS DISTINCT FROM _uid
     AND NOT public.has_role(_uid, 'admin') THEN
    RETURN jsonb_build_object('success', false, 'error', 'forbidden');
  END IF;

  _uid := COALESCE(_user_id, _uid);

  SELECT * INTO w FROM public.buyer_wallets WHERE user_id = _uid;
  IF NOT FOUND THEN
    RETURN jsonb_build_object(
      'success', true,
      'user_id', _uid,
      'cash_available', 0,
      'promo_available', 0,
      'cash_pending', 0,
      'promo_pending', 0,
      'total_available', 0,
      'status', 'active',
      'nearest_promo_expires_at', NULL
    );
  END IF;

  SELECT MIN(expires_at) INTO _nearest
  FROM public.wallet_credit_lots
  WHERE user_id = _uid
    AND bucket = 'promo'
    AND status = 'open'
    AND remaining_amount > 0
    AND expires_at IS NOT NULL
    AND expires_at > now();

  RETURN jsonb_build_object(
    'success', true,
    'user_id', w.user_id,
    'cash_available', w.cash_available,
    'promo_available', w.promo_available,
    'cash_pending', w.cash_pending,
    'promo_pending', w.promo_pending,
    'total_available', ROUND((w.cash_available + w.promo_available)::numeric, 2),
    'lifetime_credited', w.lifetime_credited,
    'lifetime_spent', w.lifetime_spent,
    'lifetime_expired', w.lifetime_expired,
    'status', w.status,
    'nearest_promo_expires_at', _nearest
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.get_wallet_history(
  _limit integer DEFAULT 20,
  _cursor timestamptz DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _uid uuid := auth.uid();
BEGIN
  IF _uid IS NULL THEN
    RETURN '[]'::jsonb;
  END IF;

  RETURN COALESCE((
    SELECT jsonb_agg(row_to_json(x)::jsonb ORDER BY x.created_at DESC)
    FROM (
      SELECT
        t.id,
        t.type,
        t.description,
        t.reference_type,
        t.reference_id,
        t.created_at,
        COALESCE((
          SELECT SUM(
            CASE
              WHEN e.direction = 'credit' AND (
                e.account LIKE 'user_cash:%' OR e.account LIKE 'user_promo:%'
              ) THEN e.amount
              WHEN e.direction = 'debit' AND (
                e.account LIKE 'user_cash:%' OR e.account LIKE 'user_promo:%'
              ) THEN -e.amount
              ELSE 0
            END
          )
          FROM public.wallet_ledger_entries e
          WHERE e.txn_id = t.id
        ), 0) AS signed_amount,
        (
          SELECT COALESCE(SUM(e.amount), 0)
          FROM public.wallet_ledger_entries e
          WHERE e.txn_id = t.id AND e.bucket = 'cash'
            AND e.direction = 'credit' AND e.account LIKE 'user_cash%'
        ) AS cash_delta,
        (
          SELECT COALESCE(SUM(e.amount), 0)
          FROM public.wallet_ledger_entries e
          WHERE e.txn_id = t.id AND e.bucket = 'promo'
            AND e.direction = 'credit' AND e.account LIKE 'user_promo%'
        ) AS promo_delta
      FROM public.wallet_ledger_txns t
      WHERE t.user_id = _uid
        AND (_cursor IS NULL OR t.created_at < _cursor)
        AND t.type NOT IN ('spend_reserve') -- hide raw holds; show commit/release/credits
      ORDER BY t.created_at DESC
      LIMIT LEAST(GREATEST(COALESCE(_limit, 20), 1), 100)
    ) x
  ), '[]'::jsonb);
END;
$$;

CREATE OR REPLACE FUNCTION public.quote_wallet_application(
  _payable_after_coupon_loyalty numeric
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _uid uuid := auth.uid();
  w public.buyer_wallets;
  _plan jsonb;
  _payable numeric := ROUND(GREATEST(COALESCE(_payable_after_coupon_loyalty, 0), 0)::numeric, 2);
BEGIN
  IF _uid IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'not_authenticated');
  END IF;

  SELECT * INTO w FROM public.buyer_wallets WHERE user_id = _uid;
  IF NOT FOUND OR w.status <> 'active' THEN
    RETURN jsonb_build_object(
      'success', true,
      'max_amount', 0,
      'cash_available', 0,
      'promo_available', 0,
      'plan', jsonb_build_object('promo_amount', 0, 'cash_amount', 0, 'total', 0)
    );
  END IF;

  _plan := public.wallet_plan_spend(w.cash_available, w.promo_available, _payable);

  RETURN jsonb_build_object(
    'success', true,
    'max_amount', (_plan->>'total')::numeric,
    'cash_available', w.cash_available,
    'promo_available', w.promo_available,
    'payable', _payable,
    'plan', _plan
  );
END;
$$;

-- ------------------------------------------------------------
