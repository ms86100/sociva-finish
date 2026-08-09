CREATE OR REPLACE FUNCTION public.apply_loyalty_to_checkout_orders(
  _buyer_id uuid,
  _order_ids uuid[],
  _loyalty_points integer,
  _payment_method text,
  _checkout_key text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _redeem integer;
  _quote_base numeric := 0;
  _bases numeric[] := '{}';
  _oids uuid[] := '{}';
  _alloc integer[] := '{}';
  _i int;
  _n int;
  _remaining integer;
  _share integer;
  _sum_bases numeric;
  _res jsonb;
  _reservation_id uuid;
  o record;
BEGIN
  IF _loyalty_points IS NULL OR _loyalty_points <= 0 THEN
    RETURN jsonb_build_object('success', true, 'points', 0, 'skipped', true);
  END IF;

  IF _order_ids IS NULL OR coalesce(array_length(_order_ids, 1), 0) = 0 THEN
    RETURN jsonb_build_object('success', false, 'error', 'no_orders');
  END IF;

  -- Build redeemable bases (items+fees already in total; remove delivery+loyalty none yet; add back coupon already applied)
  -- Redeemable = total_amount - delivery_fee + 0 (coupon already in total)
  -- Match UI: loyalty applies to merchandise after coupon, NOT delivery fee.
  FOR o IN
    SELECT id, total_amount, COALESCE(delivery_fee, 0) AS delivery_fee, seller_id
    FROM public.orders
    WHERE id = ANY(_order_ids) AND buyer_id = _buyer_id
    ORDER BY created_at, id
  LOOP
    _oids := array_append(_oids, o.id);
    _bases := array_append(_bases, GREATEST(o.total_amount - o.delivery_fee, 0));
    _quote_base := _quote_base + GREATEST(o.total_amount - o.delivery_fee, 0);
  END LOOP;

  _n := coalesce(array_length(_oids, 1), 0);
  IF _n = 0 THEN
    RETURN jsonb_build_object('success', false, 'error', 'orders_not_found');
  END IF;

  _redeem := LEAST(_loyalty_points, FLOOR(_quote_base)::integer);
  IF _redeem <= 0 THEN
    RETURN jsonb_build_object('success', true, 'points', 0, 'skipped', true);
  END IF;

  -- Reserve first (locks wallet)
  _res := public.reserve_loyalty_points(
    _redeem,
    CASE WHEN _checkout_key IS NULL THEN NULL ELSE 'checkout-reserve:' || _checkout_key END,
    _checkout_key,
    _oids
  );

  IF COALESCE((_res->>'success')::boolean, false) IS NOT TRUE THEN
    RETURN _res;
  END IF;
  _reservation_id := (_res->>'reservation_id')::uuid;

  -- Largest-remainder proportional allocation
  _sum_bases := NULLIF(_quote_base, 0);
  _remaining := _redeem;
  FOR _i IN 1.._n LOOP
    IF _i = _n THEN
      _share := _remaining;
    ELSE
      _share := FLOOR(_redeem * (_bases[_i] / _sum_bases))::integer;
      _remaining := _remaining - _share;
    END IF;
    _alloc := array_append(_alloc, _share);
  END LOOP;

  FOR _i IN 1.._n LOOP
    IF _alloc[_i] > 0 THEN
      UPDATE public.orders
      SET
        loyalty_points_redeemed = _alloc[_i],
        loyalty_discount_amount = _alloc[_i]::numeric,
        loyalty_reservation_id = _reservation_id,
        total_amount = GREATEST(total_amount - _alloc[_i], 0)
      WHERE id = _oids[_i];
    ELSE
      UPDATE public.orders
      SET loyalty_reservation_id = _reservation_id
      WHERE id = _oids[_i];
    END IF;
  END LOOP;

  -- COD: commit immediately (buyer owes discounted COD amount)
  IF lower(COALESCE(_payment_method, 'cod')) = 'cod' THEN
    _res := public.commit_loyalty_reservation(_reservation_id, _oids);
    IF COALESCE((_res->>'success')::boolean, false) IS NOT TRUE THEN
      PERFORM public.release_loyalty_reservation(_reservation_id);
      RETURN _res;
    END IF;
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'reservation_id', _reservation_id,
    'points', _redeem,
    'discount_rupees', _redeem,
    'allocations', _alloc,
    'order_ids', to_json(_oids),
    'status', CASE WHEN lower(COALESCE(_payment_method, 'cod')) = 'cod' THEN 'committed' ELSE 'held' END
  );
END;
$$;
