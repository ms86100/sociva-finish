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