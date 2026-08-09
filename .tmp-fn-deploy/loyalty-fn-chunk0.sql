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
