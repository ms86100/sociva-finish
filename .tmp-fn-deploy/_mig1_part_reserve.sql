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
