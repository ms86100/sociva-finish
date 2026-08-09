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