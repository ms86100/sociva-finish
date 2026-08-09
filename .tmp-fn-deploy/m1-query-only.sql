-- ============================================================
-- Sociva Credit (enterprise wallet) MVP — schema + core RPCs
-- Append-only double-entry SCL + cached buyer_wallets + FIFO lots
-- Parallel to loyalty; does NOT overload payment_ledger
-- ============================================================

-- ------------------------------------------------------------
-- 1. Schema
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.buyer_wallets (
  user_id uuid PRIMARY KEY,
  cash_available numeric(12,2) NOT NULL DEFAULT 0 CHECK (cash_available >= 0),
  promo_available numeric(12,2) NOT NULL DEFAULT 0 CHECK (promo_available >= 0),
  cash_pending numeric(12,2) NOT NULL DEFAULT 0 CHECK (cash_pending >= 0),
  promo_pending numeric(12,2) NOT NULL DEFAULT 0 CHECK (promo_pending >= 0),
  lifetime_credited numeric(12,2) NOT NULL DEFAULT 0 CHECK (lifetime_credited >= 0),
  lifetime_spent numeric(12,2) NOT NULL DEFAULT 0 CHECK (lifetime_spent >= 0),
  lifetime_expired numeric(12,2) NOT NULL DEFAULT 0 CHECK (lifetime_expired >= 0),
  version integer NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'frozen', 'closed')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.wallet_credit_lots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.buyer_wallets(user_id),
  bucket text NOT NULL CHECK (bucket IN ('cash', 'promo')),
  source text NOT NULL DEFAULT 'support'
    CHECK (source IN (
      'refund', 'promo_campaign', 'referral', 'support',
      'clawback_adjust', 'spend_restore', 'admin'
    )),
  original_amount numeric(12,2) NOT NULL CHECK (original_amount > 0),
  remaining_amount numeric(12,2) NOT NULL CHECK (remaining_amount >= 0),
  expires_at timestamptz,
  order_id uuid,
  refund_id uuid,
  campaign_id text,
  status text NOT NULL DEFAULT 'open'
    CHECK (status IN ('open', 'depleted', 'expired', 'reversed')),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT wallet_lots_remaining_lte_original
    CHECK (remaining_amount <= original_amount)
);

CREATE INDEX IF NOT EXISTS idx_wallet_lots_user_fifo
  ON public.wallet_credit_lots (user_id, bucket, expires_at NULLS LAST, created_at)
  WHERE status = 'open' AND remaining_amount > 0;

CREATE INDEX IF NOT EXISTS idx_wallet_lots_refund
  ON public.wallet_credit_lots (refund_id)
  WHERE refund_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.wallet_ledger_txns (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  type text NOT NULL CHECK (type IN (
    'spend_reserve', 'spend_commit', 'spend_release',
    'refund_credit', 'promo_issue', 'promo_clawback',
    'expire', 'adjust', 'reverse', 'spend_restore'
  )),
  reference_type text,
  reference_id text,
  idempotency_key text,
  description text,
  created_by uuid,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_wallet_ledger_txns_idempotency
  ON public.wallet_ledger_txns (idempotency_key)
  WHERE idempotency_key IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_wallet_ledger_txns_user_created
  ON public.wallet_ledger_txns (user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS public.wallet_ledger_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  txn_id uuid NOT NULL REFERENCES public.wallet_ledger_txns(id),
  account text NOT NULL,
  direction text NOT NULL CHECK (direction IN ('debit', 'credit')),
  amount numeric(12,2) NOT NULL CHECK (amount > 0),
  bucket text CHECK (bucket IS NULL OR bucket IN ('cash', 'promo')),
  lot_id uuid REFERENCES public.wallet_credit_lots(id),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_wallet_ledger_entries_txn
  ON public.wallet_ledger_entries (txn_id);

CREATE TABLE IF NOT EXISTS public.wallet_reservations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.buyer_wallets(user_id),
  order_ids uuid[] NOT NULL DEFAULT '{}',
  cash_amount numeric(12,2) NOT NULL DEFAULT 0 CHECK (cash_amount >= 0),
  promo_amount numeric(12,2) NOT NULL DEFAULT 0 CHECK (promo_amount >= 0),
  status text NOT NULL DEFAULT 'held'
    CHECK (status IN ('held', 'committed', 'released', 'expired')),
  idempotency_key text,
  checkout_key text,
  expires_at timestamptz NOT NULL DEFAULT (now() + interval '45 minutes'),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT wallet_reservations_positive
    CHECK (cash_amount + promo_amount > 0)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_wallet_reservations_idempotency
  ON public.wallet_reservations (idempotency_key)
  WHERE idempotency_key IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_wallet_reservations_user_status
  ON public.wallet_reservations (user_id, status);

-- Orders: wallet money fields
ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS wallet_cash_amount numeric(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS wallet_promo_amount numeric(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS wallet_reservation_id uuid;

-- Settlements: wallet applied audit
ALTER TABLE public.seller_settlements
  ADD COLUMN IF NOT EXISTS wallet_cash_applied numeric(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS wallet_promo_applied numeric(12,2) NOT NULL DEFAULT 0;

-- Refunds: destination for Sociva Credit
ALTER TABLE public.refund_requests
  ADD COLUMN IF NOT EXISTS refund_destination text NOT NULL DEFAULT 'original_payment'
    CHECK (refund_destination IN ('original_payment', 'wallet', 'split')),
  ADD COLUMN IF NOT EXISTS wallet_credit_amount numeric(12,2);

-- RLS
ALTER TABLE public.buyer_wallets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.wallet_credit_lots ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.wallet_ledger_txns ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.wallet_ledger_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.wallet_reservations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view own buyer wallet" ON public.buyer_wallets;
CREATE POLICY "Users can view own buyer wallet"
  ON public.buyer_wallets FOR SELECT TO authenticated
  USING (user_id = auth.uid());

DROP POLICY IF EXISTS "Admins can view all buyer wallets" ON public.buyer_wallets;
CREATE POLICY "Admins can view all buyer wallets"
  ON public.buyer_wallets FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

DROP POLICY IF EXISTS "Users can view own wallet lots" ON public.wallet_credit_lots;
CREATE POLICY "Users can view own wallet lots"
  ON public.wallet_credit_lots FOR SELECT TO authenticated
  USING (user_id = auth.uid());

DROP POLICY IF EXISTS "Admins can view all wallet lots" ON public.wallet_credit_lots;
CREATE POLICY "Admins can view all wallet lots"
  ON public.wallet_credit_lots FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

DROP POLICY IF EXISTS "Users can view own wallet txns" ON public.wallet_ledger_txns;
CREATE POLICY "Users can view own wallet txns"
  ON public.wallet_ledger_txns FOR SELECT TO authenticated
  USING (user_id = auth.uid());

DROP POLICY IF EXISTS "Admins can view all wallet txns" ON public.wallet_ledger_txns;
CREATE POLICY "Admins can view all wallet txns"
  ON public.wallet_ledger_txns FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

DROP POLICY IF EXISTS "Users can view own wallet entries" ON public.wallet_ledger_entries;
CREATE POLICY "Users can view own wallet entries"
  ON public.wallet_ledger_entries FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.wallet_ledger_txns t
      WHERE t.id = txn_id AND t.user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "Admins can view all wallet entries" ON public.wallet_ledger_entries;
CREATE POLICY "Admins can view all wallet entries"
  ON public.wallet_ledger_entries FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

DROP POLICY IF EXISTS "Users can view own wallet reservations" ON public.wallet_reservations;
CREATE POLICY "Users can view own wallet reservations"
  ON public.wallet_reservations FOR SELECT TO authenticated
  USING (user_id = auth.uid());

-- Immutable ledger: revoke UPDATE/DELETE from clients (service_role bypasses RLS)
REVOKE INSERT, UPDATE, DELETE ON public.buyer_wallets FROM authenticated, anon;
REVOKE INSERT, UPDATE, DELETE ON public.wallet_credit_lots FROM authenticated, anon;
REVOKE INSERT, UPDATE, DELETE ON public.wallet_ledger_txns FROM authenticated, anon;
REVOKE INSERT, UPDATE, DELETE ON public.wallet_ledger_entries FROM authenticated, anon;
REVOKE INSERT, UPDATE, DELETE ON public.wallet_reservations FROM authenticated, anon;

-- ------------------------------------------------------------
-- 2. Helpers
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.wallet_ensure_wallet(_user_id uuid)
RETURNS public.buyer_wallets
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  w public.buyer_wallets;
BEGIN
  IF _user_id IS NULL THEN
    RAISE EXCEPTION 'user_id required';
  END IF;

  INSERT INTO public.buyer_wallets (user_id)
  VALUES (_user_id)
  ON CONFLICT (user_id) DO NOTHING;

  SELECT * INTO w
  FROM public.buyer_wallets
  WHERE user_id = _user_id
  FOR UPDATE;

  RETURN w;
END;
$$;

CREATE OR REPLACE FUNCTION public.wallet_plan_spend(
  _cash_available numeric,
  _promo_available numeric,
  _amount numeric
)
RETURNS jsonb
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  _want numeric := ROUND(GREATEST(COALESCE(_amount, 0), 0)::numeric, 2);
  _promo numeric;
  _cash numeric;
BEGIN
  _promo := LEAST(ROUND(GREATEST(COALESCE(_promo_available, 0), 0)::numeric, 2), _want);
  _cash := LEAST(
    ROUND(GREATEST(COALESCE(_cash_available, 0), 0)::numeric, 2),
    ROUND((_want - _promo)::numeric, 2)
  );
  RETURN jsonb_build_object(
    'promo_amount', _promo,
    'cash_amount', _cash,
    'total', ROUND((_promo + _cash)::numeric, 2),
    'shortfall', ROUND(GREATEST(_want - _promo - _cash, 0)::numeric, 2)
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.wallet_insert_entry(
  _txn_id uuid,
  _account text,
  _direction text,
  _amount numeric,
  _bucket text DEFAULT NULL,
  _lot_id uuid DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF COALESCE(_amount, 0) <= 0 THEN
    RETURN;
  END IF;
  INSERT INTO public.wallet_ledger_entries (
    txn_id, account, direction, amount, bucket, lot_id
  ) VALUES (
    _txn_id, _account, _direction, ROUND(_amount::numeric, 2), _bucket, _lot_id
  );
END;
$$;

-- Consume open lots FIFO (inventory only; liability moved via held→order entries)
CREATE OR REPLACE FUNCTION public.wallet_consume_lots(
  _user_id uuid,
  _bucket text,
  _amount numeric
)
RETURNS numeric
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _need numeric := ROUND(GREATEST(COALESCE(_amount, 0), 0)::numeric, 2);
  _orig numeric := _need;
  _take numeric;
  lot record;
BEGIN
  IF _need <= 0 THEN
    RETURN 0;
  END IF;

  FOR lot IN
    SELECT *
    FROM public.wallet_credit_lots
    WHERE user_id = _user_id
      AND bucket = _bucket
      AND status = 'open'
      AND remaining_amount > 0
      AND (expires_at IS NULL OR expires_at > now())
    ORDER BY
      CASE WHEN expires_at IS NULL THEN 1 ELSE 0 END,
      expires_at ASC NULLS LAST,
      created_at ASC
    FOR UPDATE
  LOOP
    EXIT WHEN _need <= 0;
    _take := LEAST(lot.remaining_amount, _need);
    UPDATE public.wallet_credit_lots
    SET
      remaining_amount = remaining_amount - _take,
      status = CASE WHEN remaining_amount - _take <= 0 THEN 'depleted' ELSE status END
    WHERE id = lot.id;
    _need := ROUND((_need - _take)::numeric, 2);
  END LOOP;

  RETURN ROUND((_orig - _need)::numeric, 2);
END;
$$;

-- ------------------------------------------------------------
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
-- 4. Reserve / commit / release
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.reserve_wallet_credit(
  _amount numeric,
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
  _uid uuid := auth.uid();
  w public.buyer_wallets;
  r public.wallet_reservations;
  _plan jsonb;
  _cash numeric;
  _promo numeric;
  _total numeric;
  _txn_id uuid;
BEGIN
  IF _uid IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'not_authenticated');
  END IF;

  IF COALESCE(_amount, 0) <= 0 THEN
    RETURN jsonb_build_object('success', false, 'error', 'amount_must_be_positive');
  END IF;

  IF _idempotency_key IS NOT NULL THEN
    SELECT * INTO r FROM public.wallet_reservations WHERE idempotency_key = _idempotency_key;
    IF FOUND THEN
      RETURN jsonb_build_object(
        'success', true,
        'reservation_id', r.id,
        'cash_amount', r.cash_amount,
        'promo_amount', r.promo_amount,
        'status', r.status,
        'deduplicated', true
      );
    END IF;
  END IF;

  w := public.wallet_ensure_wallet(_uid);

  IF w.status <> 'active' THEN
    RETURN jsonb_build_object('success', false, 'error', 'wallet_frozen');
  END IF;

  _plan := public.wallet_plan_spend(w.cash_available, w.promo_available, _amount);
  _cash := (_plan->>'cash_amount')::numeric;
  _promo := (_plan->>'promo_amount')::numeric;
  _total := (_plan->>'total')::numeric;

  IF _total <= 0 THEN
    RETURN jsonb_build_object('success', false, 'error', 'insufficient_credit', 'available', w.cash_available + w.promo_available);
  END IF;

  -- Cap to what we can actually reserve (may be less than requested)
  UPDATE public.buyer_wallets
  SET
    cash_available = cash_available - _cash,
    promo_available = promo_available - _promo,
    cash_pending = cash_pending + _cash,
    promo_pending = promo_pending + _promo,
    version = version + 1,
    updated_at = now()
  WHERE user_id = _uid
  RETURNING * INTO w;

  INSERT INTO public.wallet_reservations (
    user_id, order_ids, cash_amount, promo_amount, status, idempotency_key, checkout_key
  ) VALUES (
    _uid, COALESCE(_order_ids, '{}'), _cash, _promo, 'held', _idempotency_key, _checkout_key
  )
  RETURNING * INTO r;

  INSERT INTO public.wallet_ledger_txns (
    user_id, type, reference_type, reference_id, idempotency_key, description, created_by, metadata
  ) VALUES (
    _uid, 'spend_reserve', 'reservation', r.id::text,
    CASE WHEN _idempotency_key IS NULL THEN NULL ELSE 'wallet-reserve:' || _idempotency_key END,
    'Reserved Sociva Credit ₹' || _total::text,
    _uid,
    jsonb_build_object('cash', _cash, 'promo', _promo, 'checkout_key', _checkout_key)
  )
  RETURNING id INTO _txn_id;

  IF _cash > 0 THEN
    PERFORM public.wallet_insert_entry(_txn_id, 'user_cash:' || _uid::text, 'debit', _cash, 'cash');
    PERFORM public.wallet_insert_entry(_txn_id, 'user_cash_held:' || _uid::text, 'credit', _cash, 'cash');
  END IF;
  IF _promo > 0 THEN
    PERFORM public.wallet_insert_entry(_txn_id, 'user_promo:' || _uid::text, 'debit', _promo, 'promo');
    PERFORM public.wallet_insert_entry(_txn_id, 'user_promo_held:' || _uid::text, 'credit', _promo, 'promo');
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'reservation_id', r.id,
    'cash_amount', _cash,
    'promo_amount', _promo,
    'total', _total,
    'status', 'held',
    'cash_available', w.cash_available,
    'promo_available', w.promo_available
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.commit_wallet_reservation(
  _reservation_id uuid,
  _order_ids uuid[] DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  r public.wallet_reservations;
  w public.buyer_wallets;
  _txn_id uuid;
  _order_clearing text;
BEGIN
  IF _reservation_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'reservation_required');
  END IF;

  SELECT * INTO r
  FROM public.wallet_reservations
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

  IF auth.uid() IS NOT NULL AND auth.uid() IS DISTINCT FROM r.user_id
     AND NOT public.has_role(auth.uid(), 'admin') THEN
    RETURN jsonb_build_object('success', false, 'error', 'forbidden');
  END IF;

  w := public.wallet_ensure_wallet(r.user_id);

  IF w.cash_pending < r.cash_amount OR w.promo_pending < r.promo_amount THEN
    RETURN jsonb_build_object('success', false, 'error', 'pending_mismatch');
  END IF;

  UPDATE public.buyer_wallets
  SET
    cash_pending = cash_pending - r.cash_amount,
    promo_pending = promo_pending - r.promo_amount,
    lifetime_spent = lifetime_spent + r.cash_amount + r.promo_amount,
    version = version + 1,
    updated_at = now()
  WHERE user_id = r.user_id;

  UPDATE public.wallet_reservations
  SET
    status = 'committed',
    order_ids = COALESCE(_order_ids, order_ids),
    updated_at = now()
  WHERE id = r.id
  RETURNING * INTO r;

  INSERT INTO public.wallet_ledger_txns (
    user_id, type, reference_type, reference_id, idempotency_key, description, metadata
  ) VALUES (
    r.user_id, 'spend_commit', 'reservation', r.id::text,
    'wallet-commit:' || r.id::text,
    'Committed Sociva Credit spend',
    jsonb_build_object('cash', r.cash_amount, 'promo', r.promo_amount)
  )
  ON CONFLICT (idempotency_key) DO NOTHING
  RETURNING id INTO _txn_id;

  IF _txn_id IS NULL THEN
    SELECT id INTO _txn_id FROM public.wallet_ledger_txns WHERE idempotency_key = 'wallet-commit:' || r.id::text;
  END IF;

  _order_clearing := 'order_settlement:' || COALESCE((_order_ids)[1]::text, r.id::text);

  -- Held liability → order clearing (balanced); lots are inventory drawdown only
  IF r.cash_amount > 0 THEN
    PERFORM public.wallet_insert_entry(_txn_id, 'user_cash_held:' || r.user_id::text, 'debit', r.cash_amount, 'cash');
    PERFORM public.wallet_insert_entry(_txn_id, _order_clearing, 'credit', r.cash_amount, 'cash');
    PERFORM public.wallet_consume_lots(r.user_id, 'cash', r.cash_amount);
  END IF;
  IF r.promo_amount > 0 THEN
    PERFORM public.wallet_insert_entry(_txn_id, 'user_promo_held:' || r.user_id::text, 'debit', r.promo_amount, 'promo');
    PERFORM public.wallet_insert_entry(_txn_id, _order_clearing, 'credit', r.promo_amount, 'promo');
    PERFORM public.wallet_consume_lots(r.user_id, 'promo', r.promo_amount);
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'reservation_id', r.id,
    'status', 'committed',
    'cash_amount', r.cash_amount,
    'promo_amount', r.promo_amount
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.release_wallet_reservation(_reservation_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  r public.wallet_reservations;
  _txn_id uuid;
BEGIN
  IF _reservation_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'reservation_required');
  END IF;

  SELECT * INTO r
  FROM public.wallet_reservations
  WHERE id = _reservation_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'reservation_not_found');
  END IF;

  IF r.status IN ('released', 'expired') THEN
    RETURN jsonb_build_object('success', true, 'reservation_id', r.id, 'status', r.status, 'deduplicated', true);
  END IF;

  IF r.status = 'committed' THEN
    RETURN jsonb_build_object('success', false, 'error', 'already_committed');
  END IF;

  IF auth.uid() IS NOT NULL AND auth.uid() IS DISTINCT FROM r.user_id
     AND NOT public.has_role(auth.uid(), 'admin') THEN
    RETURN jsonb_build_object('success', false, 'error', 'forbidden');
  END IF;

  UPDATE public.buyer_wallets
  SET
    cash_available = cash_available + r.cash_amount,
    promo_available = promo_available + r.promo_amount,
    cash_pending = GREATEST(cash_pending - r.cash_amount, 0),
    promo_pending = GREATEST(promo_pending - r.promo_amount, 0),
    version = version + 1,
    updated_at = now()
  WHERE user_id = r.user_id;

  UPDATE public.wallet_reservations
  SET status = 'released', updated_at = now()
  WHERE id = r.id;

  INSERT INTO public.wallet_ledger_txns (
    user_id, type, reference_type, reference_id, idempotency_key, description, metadata
  ) VALUES (
    r.user_id, 'spend_release', 'reservation', r.id::text,
    'wallet-release:' || r.id::text,
    'Released Sociva Credit hold',
    jsonb_build_object('cash', r.cash_amount, 'promo', r.promo_amount)
  )
  ON CONFLICT (idempotency_key) DO NOTHING
  RETURNING id INTO _txn_id;

  IF _txn_id IS NOT NULL THEN
    IF r.cash_amount > 0 THEN
      PERFORM public.wallet_insert_entry(_txn_id, 'user_cash_held:' || r.user_id::text, 'debit', r.cash_amount, 'cash');
      PERFORM public.wallet_insert_entry(_txn_id, 'user_cash:' || r.user_id::text, 'credit', r.cash_amount, 'cash');
    END IF;
    IF r.promo_amount > 0 THEN
      PERFORM public.wallet_insert_entry(_txn_id, 'user_promo_held:' || r.user_id::text, 'debit', r.promo_amount, 'promo');
      PERFORM public.wallet_insert_entry(_txn_id, 'user_promo:' || r.user_id::text, 'credit', r.promo_amount, 'promo');
    END IF;
  END IF;

  RETURN jsonb_build_object('success', true, 'reservation_id', r.id, 'status', 'released');
END;
$$;

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
$$;

CREATE OR REPLACE FUNCTION public.release_wallet_for_orders(_order_ids uuid[])
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

-- ------------------------------------------------------------
-- 5. Credit / promo / restore / expire
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.credit_wallet_cash(
  _user_id uuid,
  _amount numeric,
  _source text DEFAULT 'refund',
  _idempotency_key text DEFAULT NULL,
  _refund_id uuid DEFAULT NULL,
  _order_id uuid DEFAULT NULL,
  _description text DEFAULT NULL,
  _expires_at timestamptz DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  w public.buyer_wallets;
  _amt numeric := ROUND(GREATEST(COALESCE(_amount, 0), 0)::numeric, 2);
  _txn_id uuid;
  _lot_id uuid;
  _existing uuid;
BEGIN
  IF _amt <= 0 THEN
    RETURN jsonb_build_object('success', false, 'error', 'amount_must_be_positive');
  END IF;

  IF _idempotency_key IS NOT NULL THEN
    SELECT id INTO _existing FROM public.wallet_ledger_txns WHERE idempotency_key = _idempotency_key;
    IF _existing IS NOT NULL THEN
      RETURN jsonb_build_object('success', true, 'txn_id', _existing, 'deduplicated', true);
    END IF;
  END IF;

  w := public.wallet_ensure_wallet(_user_id);

  INSERT INTO public.wallet_credit_lots (
    user_id, bucket, source, original_amount, remaining_amount,
    expires_at, order_id, refund_id, status
  ) VALUES (
    _user_id, 'cash', COALESCE(_source, 'refund'), _amt, _amt,
    _expires_at, _order_id, _refund_id, 'open'
  )
  RETURNING id INTO _lot_id;

  UPDATE public.buyer_wallets
  SET
    cash_available = cash_available + _amt,
    lifetime_credited = lifetime_credited + _amt,
    version = version + 1,
    updated_at = now()
  WHERE user_id = _user_id;

  INSERT INTO public.wallet_ledger_txns (
    user_id, type, reference_type, reference_id, idempotency_key, description, metadata
  ) VALUES (
    _user_id,
    CASE WHEN _source = 'refund' THEN 'refund_credit' ELSE 'adjust' END,
    COALESCE(CASE WHEN _refund_id IS NOT NULL THEN 'refund' WHEN _order_id IS NOT NULL THEN 'order' ELSE 'admin' END, 'admin'),
    COALESCE(_refund_id::text, _order_id::text, _idempotency_key),
    _idempotency_key,
    COALESCE(_description, 'Credited ₹' || _amt::text || ' Sociva Credit (cash)'),
    jsonb_build_object('amount', _amt, 'bucket', 'cash', 'source', _source, 'lot_id', _lot_id)
  )
  RETURNING id INTO _txn_id;

  PERFORM public.wallet_insert_entry(_txn_id, 'platform_cash_clearing', 'debit', _amt, 'cash', _lot_id);
  PERFORM public.wallet_insert_entry(_txn_id, 'user_cash:' || _user_id::text, 'credit', _amt, 'cash', _lot_id);

  RETURN jsonb_build_object('success', true, 'txn_id', _txn_id, 'lot_id', _lot_id, 'amount', _amt, 'bucket', 'cash');
END;
$$;

CREATE OR REPLACE FUNCTION public.issue_wallet_promo(
  _user_id uuid,
  _amount numeric,
  _expires_at timestamptz,
  _source text DEFAULT 'promo_campaign',
  _idempotency_key text DEFAULT NULL,
  _campaign_id text DEFAULT NULL,
  _description text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _amt numeric := ROUND(GREATEST(COALESCE(_amount, 0), 0)::numeric, 2);
  _txn_id uuid;
  _lot_id uuid;
  _existing uuid;
  _caller uuid := auth.uid();
BEGIN
  -- Admin or service_role (auth.uid null under service)
  IF _caller IS NOT NULL AND NOT public.has_role(_caller, 'admin') THEN
    RETURN jsonb_build_object('success', false, 'error', 'forbidden');
  END IF;

  IF _amt <= 0 THEN
    RETURN jsonb_build_object('success', false, 'error', 'amount_must_be_positive');
  END IF;

  IF _expires_at IS NULL OR _expires_at <= now() THEN
    RETURN jsonb_build_object('success', false, 'error', 'expires_at_required');
  END IF;

  IF _idempotency_key IS NOT NULL THEN
    SELECT id INTO _existing FROM public.wallet_ledger_txns WHERE idempotency_key = _idempotency_key;
    IF _existing IS NOT NULL THEN
      RETURN jsonb_build_object('success', true, 'txn_id', _existing, 'deduplicated', true);
    END IF;
  END IF;

  PERFORM public.wallet_ensure_wallet(_user_id);

  INSERT INTO public.wallet_credit_lots (
    user_id, bucket, source, original_amount, remaining_amount,
    expires_at, campaign_id, status
  ) VALUES (
    _user_id, 'promo', COALESCE(_source, 'promo_campaign'), _amt, _amt,
    _expires_at, _campaign_id, 'open'
  )
  RETURNING id INTO _lot_id;

  UPDATE public.buyer_wallets
  SET
    promo_available = promo_available + _amt,
    lifetime_credited = lifetime_credited + _amt,
    version = version + 1,
    updated_at = now()
  WHERE user_id = _user_id;

  INSERT INTO public.wallet_ledger_txns (
    user_id, type, reference_type, reference_id, idempotency_key, description, created_by, metadata
  ) VALUES (
    _user_id, 'promo_issue', 'campaign', COALESCE(_campaign_id, _idempotency_key),
    _idempotency_key,
    COALESCE(_description, 'Promo credit ₹' || _amt::text),
    _caller,
    jsonb_build_object('amount', _amt, 'expires_at', _expires_at, 'lot_id', _lot_id)
  )
  RETURNING id INTO _txn_id;

  PERFORM public.wallet_insert_entry(_txn_id, 'platform_promo_expense', 'debit', _amt, 'promo', _lot_id);
  PERFORM public.wallet_insert_entry(_txn_id, 'user_promo:' || _user_id::text, 'credit', _amt, 'promo', _lot_id);

  RETURN jsonb_build_object('success', true, 'txn_id', _txn_id, 'lot_id', _lot_id, 'amount', _amt);
END;
$$;

CREATE OR REPLACE FUNCTION public.restore_wallet_for_order(
  _order_id uuid,
  _cash_amount numeric DEFAULT NULL,
  _promo_amount numeric DEFAULT NULL,
  _reason text DEFAULT 'cancel'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  o public.orders;
  _cash numeric;
  _promo numeric;
  _idem text;
  _res jsonb;
BEGIN
  SELECT * INTO o FROM public.orders WHERE id = _order_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'order_not_found');
  END IF;

  _cash := ROUND(COALESCE(_cash_amount, o.wallet_cash_amount, 0)::numeric, 2);
  _promo := ROUND(COALESCE(_promo_amount, o.wallet_promo_amount, 0)::numeric, 2);

  IF _cash <= 0 AND _promo <= 0 THEN
    RETURN jsonb_build_object('success', true, 'restored', 0, 'skipped', true);
  END IF;

  _idem := 'wallet-restore:' || _order_id::text || ':' || _reason || ':' || _cash::text || ':' || _promo::text;
  IF EXISTS (SELECT 1 FROM public.wallet_ledger_txns WHERE idempotency_key = _idem) THEN
    RETURN jsonb_build_object('success', true, 'deduplicated', true, 'cash', _cash, 'promo', _promo);
  END IF;

  IF _cash > 0 THEN
    _res := public.credit_wallet_cash(
      o.buyer_id, _cash, 'spend_restore', _idem || ':cash', NULL, o.id,
      'Restored cash credit from order (' || _reason || ')'
    );
  END IF;

  IF _promo > 0 THEN
    -- Restore promo with 90-day expiry (MVP policy)
    PERFORM public.wallet_ensure_wallet(o.buyer_id);

    INSERT INTO public.wallet_credit_lots (
      user_id, bucket, source, original_amount, remaining_amount, expires_at, order_id, status
    ) VALUES (
      o.buyer_id, 'promo', 'spend_restore', _promo, _promo, now() + interval '90 days', o.id, 'open'
    );

    UPDATE public.buyer_wallets
    SET
      promo_available = promo_available + _promo,
      lifetime_credited = lifetime_credited + _promo,
      lifetime_spent = GREATEST(lifetime_spent - _promo - CASE WHEN _cash > 0 THEN 0 ELSE 0 END, 0),
      version = version + 1,
      updated_at = now()
    WHERE user_id = o.buyer_id;

    INSERT INTO public.wallet_ledger_txns (
      user_id, type, reference_type, reference_id, idempotency_key, description, metadata
    ) VALUES (
      o.buyer_id, 'spend_restore', 'order', o.id::text,
      _idem || ':promo',
      'Restored promo credit from order (' || _reason || ')',
      jsonb_build_object('promo', _promo, 'reason', _reason)
    );
  END IF;

  -- Adjust lifetime_spent for cash restore too
  IF _cash > 0 OR _promo > 0 THEN
    UPDATE public.buyer_wallets
    SET lifetime_spent = GREATEST(lifetime_spent - _cash - _promo, 0), updated_at = now()
    WHERE user_id = o.buyer_id;
  END IF;

  RETURN jsonb_build_object('success', true, 'cash', _cash, 'promo', _promo);
END;
$$;

CREATE OR REPLACE FUNCTION public.credit_wallet_from_refund(_refund_id uuid)
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
$$;

CREATE OR REPLACE FUNCTION public.expire_wallet_lots(_batch_limit integer DEFAULT 100)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  lot record;
  _n integer := 0;
  _total numeric := 0;
  _txn_id uuid;
  _amt numeric;
BEGIN
  FOR lot IN
    SELECT *
    FROM public.wallet_credit_lots
    WHERE status = 'open'
      AND remaining_amount > 0
      AND expires_at IS NOT NULL
      AND expires_at <= now()
    ORDER BY expires_at
    LIMIT LEAST(GREATEST(COALESCE(_batch_limit, 100), 1), 500)
    FOR UPDATE SKIP LOCKED
  LOOP
    _amt := lot.remaining_amount;

    UPDATE public.wallet_credit_lots
    SET remaining_amount = 0, status = 'expired'
    WHERE id = lot.id;

    UPDATE public.buyer_wallets
    SET
      promo_available = GREATEST(promo_available - CASE WHEN lot.bucket = 'promo' THEN _amt ELSE 0 END, 0),
      cash_available = GREATEST(cash_available - CASE WHEN lot.bucket = 'cash' THEN _amt ELSE 0 END, 0),
      lifetime_expired = lifetime_expired + _amt,
      version = version + 1,
      updated_at = now()
    WHERE user_id = lot.user_id;

    INSERT INTO public.wallet_ledger_txns (
      user_id, type, reference_type, reference_id, idempotency_key, description, metadata
    ) VALUES (
      lot.user_id, 'expire', 'lot', lot.id::text,
      'wallet-expire:' || lot.id::text,
      'Expired ' || lot.bucket || ' credit ₹' || _amt::text,
      jsonb_build_object('lot_id', lot.id, 'amount', _amt, 'bucket', lot.bucket)
    )
    ON CONFLICT (idempotency_key) DO NOTHING
    RETURNING id INTO _txn_id;

    IF _txn_id IS NOT NULL THEN
      IF lot.bucket = 'promo' THEN
        PERFORM public.wallet_insert_entry(_txn_id, 'user_promo:' || lot.user_id::text, 'debit', _amt, 'promo', lot.id);
        PERFORM public.wallet_insert_entry(_txn_id, 'platform_promo_clawback', 'credit', _amt, 'promo', lot.id);
      ELSE
        PERFORM public.wallet_insert_entry(_txn_id, 'user_cash:' || lot.user_id::text, 'debit', _amt, 'cash', lot.id);
        PERFORM public.wallet_insert_entry(_txn_id, 'platform_cash_clearing', 'credit', _amt, 'cash', lot.id);
      END IF;
    END IF;

    _n := _n + 1;
    _total := _total + _amt;
  END LOOP;

  RETURN jsonb_build_object('success', true, 'expired_lots', _n, 'amount', _total);
END;
$$;

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
