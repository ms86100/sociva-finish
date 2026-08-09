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