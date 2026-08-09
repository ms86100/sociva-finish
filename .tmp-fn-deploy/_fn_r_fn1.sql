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