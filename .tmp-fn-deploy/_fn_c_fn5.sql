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

-- Apply wallet proportionally to checkout orders (after loyalty)