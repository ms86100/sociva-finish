-- ============================================================
-- Phase 1: Platform-funded Loyalty Rewards (production-safe)
-- Funding model: Sociva platform absorbs redemption cost
-- (sellers settle on pre-loyalty gross; platform_loyalty_subsidy)
-- ============================================================

-- ------------------------------------------------------------
-- 1. Schema: wallets, immutable ledger, reservations
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.loyalty_wallets (
  user_id uuid PRIMARY KEY,
  available_points integer NOT NULL DEFAULT 0 CHECK (available_points >= 0),
  pending_points integer NOT NULL DEFAULT 0 CHECK (pending_points >= 0),
  lifetime_earned integer NOT NULL DEFAULT 0 CHECK (lifetime_earned >= 0),
  lifetime_redeemed integer NOT NULL DEFAULT 0 CHECK (lifetime_redeemed >= 0),
  funding_source text NOT NULL DEFAULT 'platform'
    CHECK (funding_source IN ('platform', 'merchant', 'hybrid')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.loyalty_ledger (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  entry_type text NOT NULL CHECK (entry_type IN (
    'earn', 'redeem', 'refund_restore', 'reverse_earn',
    'expire', 'adjustment', 'reserve', 'release', 'commit'
  )),
  points integer NOT NULL DEFAULT 0,
  funding_source text NOT NULL DEFAULT 'platform'
    CHECK (funding_source IN ('platform', 'merchant', 'hybrid')),
  store_id uuid,
  order_id uuid,
  reservation_id uuid,
  reference_id text,
  idempotency_key text,
  description text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_loyalty_ledger_idempotency
  ON public.loyalty_ledger (idempotency_key)
  WHERE idempotency_key IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_loyalty_ledger_user_created
  ON public.loyalty_ledger (user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_loyalty_ledger_order
  ON public.loyalty_ledger (order_id)
  WHERE order_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_loyalty_ledger_reservation
  ON public.loyalty_ledger (reservation_id)
  WHERE reservation_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.loyalty_reservations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.loyalty_wallets(user_id),
  points integer NOT NULL CHECK (points > 0),
  status text NOT NULL DEFAULT 'held'
    CHECK (status IN ('held', 'committed', 'released', 'expired')),
  idempotency_key text,
  checkout_key text,
  order_ids uuid[] NOT NULL DEFAULT '{}',
  expires_at timestamptz NOT NULL DEFAULT (now() + interval '45 minutes'),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_loyalty_reservations_idempotency
  ON public.loyalty_reservations (idempotency_key)
  WHERE idempotency_key IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_loyalty_reservations_user_status
  ON public.loyalty_reservations (user_id, status);

-- Orders: loyalty money fields
ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS loyalty_discount_amount numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS loyalty_points_redeemed integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS loyalty_reservation_id uuid;

-- Settlements: explicit platform subsidy
ALTER TABLE public.seller_settlements
  ADD COLUMN IF NOT EXISTS platform_loyalty_subsidy numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS gross_before_loyalty numeric;

-- RLS
ALTER TABLE public.loyalty_wallets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.loyalty_ledger ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.loyalty_reservations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view own loyalty wallet" ON public.loyalty_wallets;
CREATE POLICY "Users can view own loyalty wallet"
  ON public.loyalty_wallets FOR SELECT TO authenticated
  USING (user_id = auth.uid());

DROP POLICY IF EXISTS "Users can view own loyalty ledger" ON public.loyalty_ledger;
CREATE POLICY "Users can view own loyalty ledger"
  ON public.loyalty_ledger FOR SELECT TO authenticated
  USING (user_id = auth.uid());

DROP POLICY IF EXISTS "Users can view own loyalty reservations" ON public.loyalty_reservations;
CREATE POLICY "Users can view own loyalty reservations"
  ON public.loyalty_reservations FOR SELECT TO authenticated
  USING (user_id = auth.uid());

DROP POLICY IF EXISTS "Admins can view all loyalty wallets" ON public.loyalty_wallets;
CREATE POLICY "Admins can view all loyalty wallets"
  ON public.loyalty_wallets FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

DROP POLICY IF EXISTS "Admins can view all loyalty ledger" ON public.loyalty_ledger;
CREATE POLICY "Admins can view all loyalty ledger"
  ON public.loyalty_ledger FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

-- ------------------------------------------------------------
-- 2. Migrate existing loyalty_points -> wallets + ledger
-- ------------------------------------------------------------
INSERT INTO public.loyalty_wallets (
  user_id, available_points, pending_points, lifetime_earned, lifetime_redeemed, funding_source
)
SELECT
  lp.user_id,
  GREATEST(COALESCE(SUM(lp.points), 0), 0)::integer,
  0,
  GREATEST(COALESCE(SUM(CASE WHEN lp.points > 0 THEN lp.points ELSE 0 END), 0), 0)::integer,
  GREATEST(COALESCE(SUM(CASE WHEN lp.points < 0 THEN -lp.points ELSE 0 END), 0), 0)::integer,
  'platform'
FROM public.loyalty_points lp
GROUP BY lp.user_id
ON CONFLICT (user_id) DO NOTHING;

INSERT INTO public.loyalty_ledger (
  id, user_id, entry_type, points, funding_source, order_id, reference_id, description, metadata, created_at
)
SELECT
  lp.id,
  lp.user_id,
  CASE lp.type
    WHEN 'earned' THEN 'earn'
    WHEN 'bonus' THEN 'earn'
    WHEN 'redeemed' THEN 'redeem'
    WHEN 'expired' THEN 'expire'
    WHEN 'adjusted' THEN 'adjustment'
    ELSE 'adjustment'
  END,
  lp.points,
  'platform',
  CASE
    WHEN lp.reference_id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      THEN lp.reference_id::uuid
    ELSE NULL
  END,
  lp.reference_id,
  lp.description,
  jsonb_build_object(
    'migrated_from', 'loyalty_points',
    'legacy_type', lp.type,
    'legacy_source', lp.source
  ),
  lp.created_at
FROM public.loyalty_points lp
WHERE NOT EXISTS (SELECT 1 FROM public.loyalty_ledger ll WHERE ll.id = lp.id);

-- ------------------------------------------------------------
-- 3. Core helpers
-- ------------------------------------------------------------
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
      ON CONFLICT (idempotency_key) WHERE idempotency_key IS NOT NULL DO NOTHING;
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
    ON CONFLICT (idempotency_key) WHERE idempotency_key IS NOT NULL DO NOTHING;
  END IF;

  INSERT INTO public.loyalty_ledger (
    user_id, entry_type, points, funding_source, reservation_id, description, metadata, idempotency_key
  ) VALUES (
    r.user_id, 'commit', 0, 'platform', r.id,
    'Committed reservation ' || r.id::text,
    jsonb_build_object('points', r.points),
    'commit:' || r.id::text
  )
  ON CONFLICT (idempotency_key) WHERE idempotency_key IS NOT NULL DO NOTHING;

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
  ON CONFLICT (idempotency_key) WHERE idempotency_key IS NOT NULL DO NOTHING;

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
