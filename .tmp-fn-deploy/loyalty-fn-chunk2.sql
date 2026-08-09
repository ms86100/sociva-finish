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

CREATE OR REPLACE FUNCTION public.commit_loyalty_reservation(
  _reservation_id uuid,
  _order_ids uuid[] DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  r public.loyalty_reservations;
  w public.loyalty_wallets;
  _oid uuid;
BEGIN
  IF _reservation_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'reservation_required');
  END IF;

  SELECT * INTO r
  FROM public.loyalty_reservations
  WHERE id = _reservation_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'reservation_not_found');
  END IF;

  IF r.status = 'committed' THEN
    RETURN jsonb_build_object('success', true, 'reservation_id', r.id, 'status', 'committed', 'deduplicated', true);
  END IF;

  IF r.status <> 'held' THEN
    RETURN jsonb_build_object('success', false, 'error', 'invalid_status', 'status', r.status);
  END IF;

  -- Allow service_role / triggers (auth.uid null) or owner
  IF auth.uid() IS NOT NULL AND auth.uid() IS DISTINCT FROM r.user_id
     AND NOT public.has_role(auth.uid(), 'admin') THEN
    RETURN jsonb_build_object('success', false, 'error', 'forbidden');
  END IF;

  w := public.loyalty_ensure_wallet(r.user_id);

  IF w.pending_points < r.points THEN
    -- Self-heal then fail closed
    PERFORM public.loyalty_reconcile_wallet(r.user_id);
    RETURN jsonb_build_object('success', false, 'error', 'pending_mismatch');
  END IF;

  UPDATE public.loyalty_wallets
  SET
    pending_points = pending_points - r.points,
    lifetime_redeemed = lifetime_redeemed + r.points,
    updated_at = now()
  WHERE user_id = r.user_id;

  UPDATE public.loyalty_reservations
  SET
    status = 'committed',
    order_ids = COALESCE(_order_ids, order_ids),
    updated_at = now()
  WHERE id = r.id
  RETURNING * INTO r;

  -- One redeem ledger row per order share when order_ids known; else single row
  IF _order_ids IS NOT NULL AND coalesce(array_length(_order_ids, 1), 0) > 0 THEN
    FOR _oid IN SELECT unnest(_order_ids)
    LOOP
      INSERT INTO public.loyalty_ledger (
        user_id, entry_type, points, funding_source, order_id, store_id, reservation_id,
        reference_id, description, metadata, idempotency_key
      )
      SELECT
        r.user_id,
        'redeem',
        -COALESCE(o.loyalty_points_redeemed, 0),
        'platform',
        o.id,
        o.seller_id,
        r.id,
        o.id::text,
        'Redeemed ' || COALESCE(o.loyalty_points_redeemed, 0) || ' points (platform-funded)',
        jsonb_build_object(
          'discount_rupees', COALESCE(o.loyalty_discount_amount, 0),
          'funding_source', 'platform'
        ),
        'redeem:' || r.id::text || ':' || o.id::text
      FROM public.orders o
      WHERE o.id = _oid
        AND COALESCE(o.loyalty_points_redeemed, 0) > 0
      ON CONFLICT (idempotency_key) DO NOTHING;
    END LOOP;
  ELSE
    INSERT INTO public.loyalty_ledger (
      user_id, entry_type, points, funding_source, reservation_id, reference_id, description, metadata, idempotency_key
    ) VALUES (
      r.user_id, 'redeem', -r.points, 'platform', r.id, r.id::text,
      'Redeemed ' || r.points || ' points (platform-funded)',
      jsonb_build_object('funding_source', 'platform'),
      'redeem:' || r.id::text
    )
    ON CONFLICT (idempotency_key) DO NOTHING;
  END IF;

  INSERT INTO public.loyalty_ledger (
    user_id, entry_type, points, funding_source, reservation_id, description, metadata, idempotency_key
  ) VALUES (
    r.user_id, 'commit', 0, 'platform', r.id,
    'Committed reservation ' || r.id::text,
    jsonb_build_object('points', r.points),
    'commit:' || r.id::text
  )
  ON CONFLICT (idempotency_key) DO NOTHING;

  RETURN jsonb_build_object('success', true, 'reservation_id', r.id, 'status', 'committed', 'points', r.points);
END;
$$;

CREATE OR REPLACE FUNCTION public.release_loyalty_reservation(_reservation_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  r public.loyalty_reservations;
BEGIN
  IF _reservation_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'reservation_required');
  END IF;

  SELECT * INTO r
  FROM public.loyalty_reservations
  WHERE id = _reservation_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'reservation_not_found');
  END IF;

  IF r.status = 'released' OR r.status = 'expired' THEN
    RETURN jsonb_build_object('success', true, 'reservation_id', r.id, 'status', r.status, 'deduplicated', true);
  END IF;

  IF r.status = 'committed' THEN
    RETURN jsonb_build_object('success', false, 'error', 'already_committed');
  END IF;

  IF auth.uid() IS NOT NULL AND auth.uid() IS DISTINCT FROM r.user_id
     AND NOT public.has_role(auth.uid(), 'admin') THEN
    RETURN jsonb_build_object('success', false, 'error', 'forbidden');
  END IF;

  UPDATE public.loyalty_wallets
  SET
    available_points = available_points + r.points,
    pending_points = GREATEST(pending_points - r.points, 0),
    updated_at = now()
  WHERE user_id = r.user_id;

  UPDATE public.loyalty_reservations
  SET status = 'released', updated_at = now()
  WHERE id = r.id;

  INSERT INTO public.loyalty_ledger (
    user_id, entry_type, points, funding_source, reservation_id, description, metadata, idempotency_key
  ) VALUES (
    r.user_id, 'release', 0, 'platform', r.id,
    'Released reservation of ' || r.points || ' points',
    jsonb_build_object('points', r.points),
    'release:' || r.id::text
  )
  ON CONFLICT (idempotency_key) DO NOTHING;

  RETURN jsonb_build_object('success', true, 'reservation_id', r.id, 'status', 'released', 'points', r.points);
END;
$$;

-- Restore redeemed points for a single order (cancel / refund)
CREATE OR REPLACE FUNCTION public.restore_loyalty_for_order(
  _order_id uuid,
  _points integer DEFAULT NULL,
  _reason text DEFAULT 'cancel'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  o public.orders;
  _restore integer;
  _idem text;
BEGIN
  SELECT * INTO o FROM public.orders WHERE id = _order_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'order_not_found');
  END IF;

  _restore := COALESCE(_points, o.loyalty_points_redeemed, 0);
  IF _restore <= 0 THEN
    RETURN jsonb_build_object('success', true, 'restored', 0, 'skipped', true);
  END IF;

  _idem := 'restore:' || _order_id::text || ':' || _reason || ':' || _restore::text;

  IF EXISTS (SELECT 1 FROM public.loyalty_ledger WHERE idempotency_key = _idem) THEN
    RETURN jsonb_build_object('success', true, 'restored', _restore, 'deduplicated', true);
  END IF;

  PERFORM public.loyalty_ensure_wallet(o.buyer_id);

  UPDATE public.loyalty_wallets
  SET
    available_points = available_points + _restore,
    lifetime_redeemed = GREATEST(lifetime_redeemed - _restore, 0),
    updated_at = now()
  WHERE user_id = o.buyer_id;

  INSERT INTO public.loyalty_ledger (
    user_id, entry_type, points, funding_source, store_id, order_id,
    reservation_id, reference_id, description, metadata, idempotency_key
  ) VALUES (
    o.buyer_id, 'refund_restore', _restore, 'platform', o.seller_id, o.id,
    o.loyalty_reservation_id, o.id::text,
    'Restored ' || _restore || ' points (' || _reason || ')',
    jsonb_build_object('reason', _reason, 'funding_source', 'platform'),
    _idem
  );

  RETURN jsonb_build_object('success', true, 'restored', _restore);
END;
$$;

CREATE OR REPLACE FUNCTION public.reverse_loyalty_earn_for_order(
  _order_id uuid,
  _fraction numeric DEFAULT 1
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  o public.orders;
  _earned integer;
  _reverse integer;
  _idem text;
  w public.loyalty_wallets;
BEGIN
  SELECT * INTO o FROM public.orders WHERE id = _order_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'order_not_found');
  END IF;

  SELECT COALESCE(SUM(points), 0)::integer INTO _earned
  FROM public.loyalty_ledger
  WHERE order_id = _order_id AND entry_type = 'earn';

  IF _earned <= 0 THEN
    -- legacy fallback
    SELECT COALESCE(SUM(points), 0)::integer INTO _earned
    FROM public.loyalty_points
    WHERE reference_id = _order_id::text AND type = 'earned' AND source = 'order';
  END IF;

  _reverse := GREATEST(FLOOR(_earned * LEAST(GREATEST(COALESCE(_fraction, 1), 0), 1))::integer, 0);
  IF _reverse <= 0 THEN
    RETURN jsonb_build_object('success', true, 'reversed', 0, 'skipped', true);
  END IF;

  _idem := 'reverse_earn:' || _order_id::text || ':' || _reverse::text;
  IF EXISTS (SELECT 1 FROM public.loyalty_ledger WHERE idempotency_key = _idem) THEN
    RETURN jsonb_build_object('success', true, 'reversed', _reverse, 'deduplicated', true);
  END IF;

  w := public.loyalty_ensure_wallet(o.buyer_id);

  UPDATE public.loyalty_wallets
  SET
    available_points = GREATEST(available_points - LEAST(available_points, _reverse), 0),
    lifetime_earned = GREATEST(lifetime_earned - _reverse, 0),
    updated_at = now()
  WHERE user_id = o.buyer_id;

  INSERT INTO public.loyalty_ledger (
    user_id, entry_type, points, funding_source, store_id, order_id,
    reference_id, description, metadata, idempotency_key
  ) VALUES (
    o.buyer_id, 'reverse_earn', -_reverse, 'platform', o.seller_id, o.id,
    o.id::text,
    'Reversed ' || _reverse || ' earned points on refund/cancel',
    jsonb_build_object('fraction', _fraction, 'earned_original', _earned),
    _idem
  );

  RETURN jsonb_build_object('success', true, 'reversed', _reverse, 'earned_original', _earned);
END;
$$;

-- Apply proportional loyalty discounts to a set of orders + reserve/commit
