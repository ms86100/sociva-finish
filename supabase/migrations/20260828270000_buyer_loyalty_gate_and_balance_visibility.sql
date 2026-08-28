-- Buyer loyalty redeem kill-switch (default OFF) + capability exposure.
-- Sociva Balance visibility is enforced client-side; loyalty redeem is server-gated.

INSERT INTO public.financial_feature_flags(key, enabled, description)
VALUES (
  'buyer_loyalty_redeem_enabled',
  false,
  'Allow buyers to see and redeem loyalty points at checkout. Off hides balance UI and blocks redemption.'
)
ON CONFLICT (key) DO UPDATE
SET description = EXCLUDED.description,
    updated_at = now();

CREATE OR REPLACE FUNCTION public.is_buyer_loyalty_redeem_enabled()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT COALESCE((
    SELECT enabled
    FROM public.financial_feature_flags
    WHERE key = 'buyer_loyalty_redeem_enabled'
  ), false);
$$;

REVOKE ALL ON FUNCTION public.is_buyer_loyalty_redeem_enabled() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_buyer_loyalty_redeem_enabled() TO authenticated, service_role;

-- ── get_financial_capabilities: buyer loyalty gate ───────────────────────────
CREATE OR REPLACE FUNCTION public.get_financial_capabilities()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path = public, finance, pg_temp
AS $$
DECLARE
  v_result jsonb;
  v_online boolean;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'authentication required';
  END IF;

  v_online := public.is_online_payment_platform_enabled();

  SELECT jsonb_build_object(
    'payment_gateway_mode', public.get_public_payment_mode(),
    'online_payment_enabled', v_online,
    'wallet_refund_credit_enabled', COALESCE(bool_or(enabled) FILTER (
      WHERE key = 'wallet_refund_credit_enabled'
    ), false),
    'wallet_spend_enabled', COALESCE(bool_or(enabled) FILTER (
      WHERE key = 'wallet_spend_enabled'
    ), false),
    'seller_payout_enabled', COALESCE(bool_or(enabled) FILTER (
      WHERE key = 'seller_payout_enabled'
    ), false),
    'sociva_balance_refund_enabled', v_online AND COALESCE(bool_or(enabled) FILTER (
      WHERE key = 'wallet_refund_credit_enabled'
    ), false),
    'sociva_balance_spend_enabled', v_online AND COALESCE(bool_or(enabled) FILTER (
      WHERE key = 'wallet_spend_enabled'
    ), false),
    'buyer_loyalty_redeem_enabled', COALESCE(bool_or(enabled) FILTER (
      WHERE key = 'buyer_loyalty_redeem_enabled'
    ), false)
  )
  INTO v_result
  FROM public.financial_feature_flags;

  RETURN v_result;
END;
$$;

-- ── Loyalty read paths: hide from buyers when disabled ────────────────────────
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
  _is_admin boolean;
BEGIN
  _uid := auth.uid();
  IF _uid IS NULL THEN
    RETURN 0;
  END IF;

  _is_admin := public.has_role(_uid, 'admin');

  IF _user_id IS NOT NULL AND _user_id IS DISTINCT FROM _uid THEN
    IF NOT _is_admin THEN
      RAISE EXCEPTION 'forbidden';
    END IF;
    _uid := _user_id;
  ELSIF NOT _is_admin AND NOT public.is_buyer_loyalty_redeem_enabled() THEN
    RETURN 0;
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

CREATE OR REPLACE FUNCTION public.get_loyalty_history(_limit integer DEFAULT 20)
RETURNS TABLE(
  id uuid,
  points integer,
  type text,
  source text,
  description text,
  created_at timestamptz
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN;
  END IF;

  IF NOT public.has_role(auth.uid(), 'admin') AND NOT public.is_buyer_loyalty_redeem_enabled() THEN
    RETURN;
  END IF;

  RETURN QUERY
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
END;
$$;

-- ── Loyalty redeem paths: block when disabled ────────────────────────────────
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

  IF NOT public.is_buyer_loyalty_redeem_enabled() THEN
    RETURN jsonb_build_object(
      'success', true,
      'available_points', 0,
      'max_points', 0,
      'discount_rupees', 0,
      'rate', 1,
      'funding_source', 'platform',
      'loyalty_redeem_disabled', true
    );
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

CREATE OR REPLACE FUNCTION public.reserve_loyalty_points(
  _points integer,
  _idempotency_key text DEFAULT NULL,
  _checkout_key text DEFAULT NULL,
  _order_ids uuid[] DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  w public.loyalty_wallets;
  r public.loyalty_reservations;
  _uid uuid := auth.uid();
BEGIN
  IF _uid IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'not_authenticated');
  END IF;

  IF NOT public.is_buyer_loyalty_redeem_enabled() THEN
    RETURN jsonb_build_object('success', false, 'error', 'loyalty_redeem_disabled');
  END IF;

  IF _points IS NULL OR _points <= 0 THEN
    RETURN jsonb_build_object('success', false, 'error', 'points_must_be_positive');
  END IF;

  IF _idempotency_key IS NOT NULL THEN
    SELECT * INTO r FROM public.loyalty_reservations WHERE idempotency_key = _idempotency_key;
    IF FOUND THEN
      RETURN jsonb_build_object(
        'success', true,
        'reservation_id', r.id,
        'points', r.points,
        'status', r.status,
        'deduplicated', true
      );
    END IF;
  END IF;

  w := public.loyalty_ensure_wallet(_uid);

  IF w.available_points < _points THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'insufficient_points',
      'available', w.available_points
    );
  END IF;

  UPDATE public.loyalty_wallets
  SET
    available_points = available_points - _points,
    pending_points = pending_points + _points,
    updated_at = now()
  WHERE user_id = _uid
  RETURNING * INTO w;

  INSERT INTO public.loyalty_reservations (
    user_id, points, status, idempotency_key, checkout_key, order_ids
  ) VALUES (
    _uid, _points, 'held', _idempotency_key, _checkout_key, COALESCE(_order_ids, '{}')
  )
  RETURNING * INTO r;

  INSERT INTO public.loyalty_ledger (
    user_id, entry_type, points, funding_source, reservation_id, reference_id, description, metadata, idempotency_key
  ) VALUES (
    _uid, 'reserve', 0, 'platform', r.id, r.id::text,
    'Reserved ' || _points || ' points for checkout',
    jsonb_build_object('points', _points, 'checkout_key', _checkout_key),
    CASE WHEN _idempotency_key IS NULL THEN NULL ELSE 'reserve:' || _idempotency_key END
  );

  RETURN jsonb_build_object(
    'success', true,
    'reservation_id', r.id,
    'points', r.points,
    'status', r.status,
    'available_points', w.available_points,
    'pending_points', w.pending_points
  );
END;
$$;

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

  IF NOT public.is_buyer_loyalty_redeem_enabled() THEN
    RETURN jsonb_build_object('success', false, 'error', 'loyalty_redeem_disabled');
  END IF;

  IF _order_ids IS NULL OR coalesce(array_length(_order_ids, 1), 0) = 0 THEN
    RETURN jsonb_build_object('success', false, 'error', 'no_orders');
  END IF;

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

  IF lower(COALESCE(_payment_method, 'cod')) IN ('cod', 'wallet') THEN
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
    'status', CASE WHEN lower(COALESCE(_payment_method, 'cod')) IN ('cod', 'wallet') THEN 'committed' ELSE 'held' END
  );
END;
$$;
