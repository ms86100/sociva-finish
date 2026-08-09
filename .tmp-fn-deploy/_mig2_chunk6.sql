CREATE OR REPLACE FUNCTION public.complete_wallet_refund(p_refund_id uuid)
RETURNS refund_requests
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  r public.refund_requests;
  _credit jsonb;
BEGIN
  SELECT * INTO r FROM public.refund_requests WHERE id = p_refund_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Refund not found'; END IF;

  IF r.refund_state = 'refund_completed' THEN
    RETURN r;
  END IF;

  IF r.refund_state <> 'approved' AND r.refund_state NOT IN ('refund_initiated', 'refund_processing') THEN
    RAISE EXCEPTION 'Refund cannot be wallet-completed from state: %', r.refund_state;
  END IF;

  IF COALESCE(r.refund_destination, 'original_payment') <> 'wallet' THEN
    RAISE EXCEPTION 'Refund destination is not wallet';
  END IF;

  -- Move to initiated if still approved
  IF r.refund_state = 'approved' THEN
    UPDATE public.refund_requests
    SET refund_state = 'refund_initiated',
        status = 'processing',
        processed_at = now(),
        updated_at = now()
    WHERE id = p_refund_id
    RETURNING * INTO r;
  END IF;

  _credit := public.credit_wallet_from_refund(p_refund_id);
  IF COALESCE((_credit->>'success')::boolean, false) IS NOT TRUE THEN
    RAISE EXCEPTION 'wallet credit failed: %', coalesce(_credit->>'error', 'unknown');
  END IF;

  RETURN public.complete_refund(
    p_refund_id,
    COALESCE(_credit->>'txn_id', 'wallet_' || p_refund_id::text),
    'wallet_credited'
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.complete_wallet_refund(uuid) TO service_role;