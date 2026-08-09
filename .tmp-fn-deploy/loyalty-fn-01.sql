CREATE OR REPLACE FUNCTION public.loyalty_ensure_wallet(_user_id uuid)
RETURNS public.loyalty_wallets
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  w public.loyalty_wallets;
BEGIN
  IF _user_id IS NULL THEN
    RAISE EXCEPTION 'user_id required';
  END IF;

  INSERT INTO public.loyalty_wallets (user_id)
  VALUES (_user_id)
  ON CONFLICT (user_id) DO NOTHING;

  SELECT * INTO w
  FROM public.loyalty_wallets
  WHERE user_id = _user_id
  FOR UPDATE;

  RETURN w;
END;
$$;

CREATE OR REPLACE FUNCTION public.loyalty_reconcile_wallet(_user_id uuid)
RETURNS public.loyalty_wallets
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  w public.loyalty_wallets;
  _ledger_sum integer;
  _pending integer;
BEGIN
  w := public.loyalty_ensure_wallet(_user_id);

  SELECT COALESCE(SUM(points), 0)::integer INTO _ledger_sum
  FROM public.loyalty_ledger
  WHERE user_id = _user_id
    AND entry_type IN ('earn', 'redeem', 'refund_restore', 'reverse_earn', 'expire', 'adjustment');

  SELECT COALESCE(SUM(points), 0)::integer INTO _pending
  FROM public.loyalty_reservations
  WHERE user_id = _user_id AND status = 'held';

  UPDATE public.loyalty_wallets
  SET
    available_points = GREATEST(_ledger_sum - _pending, 0),
    pending_points = _pending,
    updated_at = now()
  WHERE user_id = _user_id
  RETURNING * INTO w;

  RETURN w;
END;
$$;

-- ------------------------------------------------------------
-- 4. Read RPCs (backward compatible + wallet)
-- ------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.get_loyalty_balance(_user_id uuid DEFAULT NULL)
RETURNS integer
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _uid uuid;
  _bal integer;
BEGIN
  _uid := auth.uid();
  IF _uid IS NULL THEN
    RETURN 0;
  END IF;

  -- Never allow reading another user's balance via SECURITY DEFINER
  IF _user_id IS NOT NULL AND _user_id IS DISTINCT FROM _uid THEN
    IF NOT public.has_role(_uid, 'admin') THEN
      RAISE EXCEPTION 'forbidden';
    END IF;
    _uid := _user_id;
  END IF;

  SELECT available_points INTO _bal
  FROM public.loyalty_wallets
  WHERE user_id = _uid;

  IF _bal IS NULL THEN
    RETURN 0;
  END IF;
  RETURN _bal;
END;
$$;

CREATE OR REPLACE FUNCTION public.get_loyalty_wallet()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  w public.loyalty_wallets;
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN jsonb_build_object('error', 'not_authenticated');
  END IF;

  SELECT * INTO w FROM public.loyalty_wallets WHERE user_id = auth.uid();
  IF NOT FOUND THEN
    RETURN jsonb_build_object(
      'available_points', 0,
      'pending_points', 0,
      'lifetime_earned', 0,
      'lifetime_redeemed', 0,
      'funding_source', 'platform'
    );
  END IF;

  RETURN jsonb_build_object(
    'available_points', w.available_points,
    'pending_points', w.pending_points,
    'lifetime_earned', w.lifetime_earned,
    'lifetime_redeemed', w.lifetime_redeemed,
    'funding_source', w.funding_source,
    'updated_at', w.updated_at
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.get_loyalty_history(_limit integer DEFAULT 20)
RETURNS TABLE(
  id uuid,
  points integer,
  type text,
  source text,
  description text,
  created_at timestamptz
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    ll.id,
    ll.points,
    ll.entry_type AS type,
    COALESCE(ll.metadata->>'legacy_source', ll.entry_type) AS source,
    ll.description,
    ll.created_at
  FROM public.loyalty_ledger ll
  WHERE ll.user_id = auth.uid()
    AND ll.entry_type IN ('earn', 'redeem', 'refund_restore', 'reverse_earn', 'expire', 'adjustment')
  ORDER BY ll.created_at DESC
  LIMIT GREATEST(COALESCE(_limit, 20), 1);
$$;

CREATE OR REPLACE FUNCTION public.quote_loyalty_redemption(_cart_amount_after_coupon numeric)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _available integer;
  _max integer;
  _amount numeric;
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'not_authenticated');
  END IF;

  _amount := GREATEST(COALESCE(_cart_amount_after_coupon, 0), 0);
  SELECT available_points INTO _available
  FROM public.loyalty_wallets WHERE user_id = auth.uid();
  _available := COALESCE(_available, 0);

  _max := LEAST(_available, FLOOR(_amount)::integer);
  IF _max < 0 THEN _max := 0; END IF;

  RETURN jsonb_build_object(
    'success', true,
    'available_points', _available,
    'max_points', _max,
    'discount_rupees', _max,
    'rate', 1,
    'funding_source', 'platform'
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_loyalty_liability()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _outstanding bigint;
  _pending bigint;
  _lifetime_earned bigint;
  _lifetime_redeemed bigint;
  _wallets integer;
BEGIN
  IF auth.uid() IS NULL OR NOT public.has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  SELECT
    COALESCE(SUM(available_points), 0),
    COALESCE(SUM(pending_points), 0),
    COALESCE(SUM(lifetime_earned), 0),
    COALESCE(SUM(lifetime_redeemed), 0),
    COUNT(*)
  INTO _outstanding, _pending, _lifetime_earned, _lifetime_redeemed, _wallets
  FROM public.loyalty_wallets;

  RETURN jsonb_build_object(
    'outstanding_points', _outstanding,
    'outstanding_rupees', _outstanding,
    'pending_points', _pending,
    'lifetime_earned', _lifetime_earned,
    'lifetime_redeemed', _lifetime_redeemed,
    'wallet_count', _wallets,
    'funding_source', 'platform'
  );
END;
$$;

-- ------------------------------------------------------------
-- 5. Reserve / commit / release
-- ------------------------------------------------------------
