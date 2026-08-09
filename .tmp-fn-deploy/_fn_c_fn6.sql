CREATE OR REPLACE FUNCTION public.apply_wallet_to_checkout_orders(
  _buyer_id uuid,
  _order_ids uuid[],
  _wallet_amount numeric,
  _payment_method text,
  _checkout_key text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _want numeric := ROUND(GREATEST(COALESCE(_wallet_amount, 0), 0)::numeric, 2);
  _quote_base numeric := 0;
  _bases numeric[] := '{}';
  _oids uuid[] := '{}';
  _cash_alloc numeric[] := '{}';
  _promo_alloc numeric[] := '{}';
  _i int;
  _n int;
  _remaining_cash numeric;
  _remaining_promo numeric;
  _share_total numeric;
  _share_cash numeric;
  _share_promo numeric;
  _sum_bases numeric;
  _res jsonb;
  _reservation_id uuid;
  _plan jsonb;
  o record;
  _cash_total numeric;
  _promo_total numeric;
BEGIN
  IF _want <= 0 THEN
    RETURN jsonb_build_object('success', true, 'amount', 0, 'skipped', true);
  END IF;

  IF _order_ids IS NULL OR coalesce(array_length(_order_ids, 1), 0) = 0 THEN
    RETURN jsonb_build_object('success', false, 'error', 'no_orders');
  END IF;

  -- Wallet-eligible = full remaining payable (includes delivery) per architecture study
  FOR o IN
    SELECT id, total_amount, seller_id, created_at
    FROM public.orders
    WHERE id = ANY(_order_ids) AND buyer_id = _buyer_id
    ORDER BY created_at, id
  LOOP
    _oids := array_append(_oids, o.id);
    _bases := array_append(_bases, GREATEST(o.total_amount, 0));
    _quote_base := _quote_base + GREATEST(o.total_amount, 0);
  END LOOP;

  _n := coalesce(array_length(_oids, 1), 0);
  IF _n = 0 THEN
    RETURN jsonb_build_object('success', false, 'error', 'orders_not_found');
  END IF;

  _want := LEAST(_want, ROUND(_quote_base::numeric, 2));
  IF _want <= 0 THEN
    RETURN jsonb_build_object('success', true, 'amount', 0, 'skipped', true);
  END IF;

  -- Reserve first (locks wallet, promo-first plan)
  _res := public.reserve_wallet_credit(
    _want,
    CASE WHEN _checkout_key IS NULL THEN NULL ELSE 'wallet-checkout-reserve:' || _checkout_key END,
    _checkout_key,
    _oids
  );

  IF COALESCE((_res->>'success')::boolean, false) IS NOT TRUE THEN
    RETURN _res;
  END IF;

  _reservation_id := (_res->>'reservation_id')::uuid;
  _cash_total := COALESCE((_res->>'cash_amount')::numeric, 0);
  _promo_total := COALESCE((_res->>'promo_amount')::numeric, 0);

  -- Proportional allocation of cash+promo across orders by payable base
  _sum_bases := NULLIF(_quote_base, 0);
  _remaining_cash := _cash_total;
  _remaining_promo := _promo_total;

  FOR _i IN 1.._n LOOP
    IF _i = _n THEN
      _share_cash := _remaining_cash;
      _share_promo := _remaining_promo;
    ELSE
      _share_total := ROUND((_bases[_i] / _sum_bases) * (_cash_total + _promo_total), 2);
      -- Split share promo-first within order
      _plan := public.wallet_plan_spend(
        -- temporary: allocate from remaining pools proportionally
        ROUND((_bases[_i] / _sum_bases) * _cash_total, 2),
        ROUND((_bases[_i] / _sum_bases) * _promo_total, 2),
        _share_total
      );
      -- Use proportional slice of each bucket (more accurate for settlement)
      _share_promo := ROUND((_bases[_i] / _sum_bases) * _promo_total, 2);
      _share_cash := ROUND((_bases[_i] / _sum_bases) * _cash_total, 2);
      _remaining_cash := ROUND((_remaining_cash - _share_cash)::numeric, 2);
      _remaining_promo := ROUND((_remaining_promo - _share_promo)::numeric, 2);
    END IF;

    _cash_alloc := array_append(_cash_alloc, _share_cash);
    _promo_alloc := array_append(_promo_alloc, _share_promo);
  END LOOP;

  FOR _i IN 1.._n LOOP
    UPDATE public.orders
    SET
      wallet_cash_amount = COALESCE(_cash_alloc[_i], 0),
      wallet_promo_amount = COALESCE(_promo_alloc[_i], 0),
      wallet_reservation_id = _reservation_id,
      total_amount = GREATEST(
        total_amount - COALESCE(_cash_alloc[_i], 0) - COALESCE(_promo_alloc[_i], 0),
        0
      )
    WHERE id = _oids[_i];
  END LOOP;

  IF lower(COALESCE(_payment_method, 'cod')) = 'cod' THEN
    _res := public.commit_wallet_reservation(_reservation_id, _oids);
    IF COALESCE((_res->>'success')::boolean, false) IS NOT TRUE THEN
      PERFORM public.release_wallet_reservation(_reservation_id);
      RETURN _res;
    END IF;
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'reservation_id', _reservation_id,
    'cash_amount', _cash_total,
    'promo_amount', _promo_total,
    'total', ROUND((_cash_total + _promo_total)::numeric, 2),
    'order_ids', to_json(_oids),
    'status', CASE WHEN lower(COALESCE(_payment_method, 'cod')) = 'cod' THEN 'committed' ELSE 'held' END
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_buyer_wallet(uuid) TO authenticated, service_role;
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
GRANT EXECUTE ON FUNCTION public.wallet_plan_spend(numeric, numeric, numeric) TO authenticated, service_role;