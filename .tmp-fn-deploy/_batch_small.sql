CREATE OR REPLACE FUNCTION public.commit_wallet_for_orders(_order_ids uuid[])
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _res_id uuid;
BEGIN
  IF _order_ids IS NULL OR coalesce(array_length(_order_ids, 1), 0) = 0 THEN
    RETURN jsonb_build_object('success', false, 'error', 'no_orders');
  END IF;

  SELECT wallet_reservation_id INTO _res_id
  FROM public.orders
  WHERE id = ANY(_order_ids)
    AND wallet_reservation_id IS NOT NULL
  LIMIT 1;

  IF _res_id IS NULL THEN
    RETURN jsonb_build_object('success', true, 'skipped', true);
  END IF;

  RETURN public.commit_wallet_reservation(_res_id, _order_ids);
END;
$$;\nCREATE OR REPLACE FUNCTION public.release_wallet_for_orders(_order_ids uuid[])
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _res_id uuid;
BEGIN
  IF _order_ids IS NULL OR coalesce(array_length(_order_ids, 1), 0) = 0 THEN
    RETURN jsonb_build_object('success', false, 'error', 'no_orders');
  END IF;

  SELECT wallet_reservation_id INTO _res_id
  FROM public.orders
  WHERE id = ANY(_order_ids)
    AND wallet_reservation_id IS NOT NULL
  LIMIT 1;

  IF _res_id IS NULL THEN
    RETURN jsonb_build_object('success', true, 'skipped', true);
  END IF;

  RETURN public.release_wallet_reservation(_res_id);
END;
$$;

-- ------------------------------------------------------------\nCREATE OR REPLACE FUNCTION public.credit_wallet_from_refund(_refund_id uuid)
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
$$;\nCREATE OR REPLACE FUNCTION public.admin_wallet_liability()
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

-- Apply wallet proportionally to checkout orders (after loyalty)\nGRANT EXECUTE ON FUNCTION public.get_buyer_wallet(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_wallet_history(integer, timestamptz) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.quote_wallet_application(numeric) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.reserve_wallet_credit(numeric, text, text, uuid[]) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.commit_wallet_reservation(uuid, uuid[]) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.release_wallet_reservation(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.commit_wallet_for_orders(uuid[]) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.release_wallet_for_orders(uuid[]) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.credit_wallet_cash(uuid, numeric, text, text, uuid, uuid, text, timestamptz) TO service_role;
GRANT EXECUTE ON FUNCTION public.issue_wallet_promo(uuid, numeric, timestamptz, text, text, text, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.restore_wallet_for_order(uuid, numeric, numeric, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.credit_wallet_from_refund(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.expire_wallet_lots(integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.admin_wallet_liability() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.apply_wallet_to_checkout_orders(uuid, uuid[], numeric, text, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.wallet_plan_spend(numeric, numeric, numeric) TO authenticated, service_role;\n