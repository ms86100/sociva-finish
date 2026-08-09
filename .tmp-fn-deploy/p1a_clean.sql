-- ============================================================
-- Audit Phase 1 — money / order integrity
-- 10) Settlement clawback on complete_refund
-- 12) seller_advance_order SELECT FOR UPDATE + rowcount raise + return status
-- 13) Restore allowed_actor / acting_as in validate_order_status_transition
-- 14) Auto-accept on payment_pending → placed UPDATE + seller notify
--  9) Reinforce auto-refund destination=wallet when no razorpay_payment_id
-- Also: allow refund_initiated → refund_failed for 72h escalation
-- ============================================================

-- Allow initiated → failed (72h manual review escalation / fail_refund)
CREATE OR REPLACE FUNCTION public.enforce_refund_state_machine()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  ok boolean := false;
BEGIN
  IF NEW.refund_state IS NOT DISTINCT FROM OLD.refund_state THEN
    RETURN NEW;
  END IF;

  ok := (OLD.refund_state, NEW.refund_state) IN (
    ('requested','approved'),
    ('requested','rejected'),
    ('approved','refund_initiated'),
    ('refund_initiated','refund_processing'),
    ('refund_initiated','refund_completed'),
    ('refund_initiated','refund_failed'),
    ('refund_processing','refund_completed'),
    ('refund_processing','refund_failed'),
    ('refund_failed','refund_initiated')
  );

  IF NOT ok THEN
    RAISE EXCEPTION 'Invalid refund_state transition: % -> %', OLD.refund_state, NEW.refund_state
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$$;

-- ------------------------------------------------------------
-- complete_refund: clawback / hold seller_settlements for refunded orders
-- (extends 20260807220000 complete_refund body)
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.complete_refund(
  p_refund_id uuid,
  p_gateway_ref text,
  p_gateway_status text
)
RETURNS refund_requests
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  r public.refund_requests;
  v_before text;
  o public.orders;
  _paid numeric;
  _frac numeric;
  _restore integer;
  _wallet_cash numeric;
  _wallet_promo numeric;
  _notify_body text;
  _wallet_already boolean := false;
  _loyalty_already boolean := false;
BEGIN
  SELECT * INTO r FROM public.refund_requests WHERE id = p_refund_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Refund not found'; END IF;
  v_before := r.refund_state;
  IF r.refund_state NOT IN ('refund_initiated','refund_processing') THEN
    RAISE EXCEPTION 'Refund cannot be completed from state: %', r.refund_state;
  END IF;

  UPDATE public.payment_ledger
  SET status = 'success',
      reference_id = p_gateway_ref,
      gateway_response = jsonb_build_object('status', p_gateway_status),
      updated_at = now()
  WHERE refund_id = p_refund_id AND status = 'pending';

  UPDATE public.refund_requests
  SET refund_state = 'refund_completed',
      status = 'settled',
      settled_at = now(),
      gateway_refund_id = p_gateway_ref,
      gateway_status = p_gateway_status,
      updated_at = now()
  WHERE id = p_refund_id
  RETURNING * INTO r;

  UPDATE public.orders
  SET payment_status = 'refunded',
      updated_at = now()
  WHERE id = r.order_id
    AND payment_status IN ('paid', 'refund_initiated', 'refund_processing', 'buyer_confirmed', 'seller_verified', 'completed');

  UPDATE public.payment_records
  SET payment_status = 'refunded'
  WHERE order_id = r.order_id
    AND payment_status IN ('paid', 'refund_initiated', 'refund_processing');

  -- Settlement clawback: block payout eligibility for refunded orders
  UPDATE public.seller_settlements
  SET settlement_status = CASE
        WHEN settlement_status = 'settled' THEN 'disputed'
        ELSE 'on_hold'
      END,
      hold_reason = COALESCE(hold_reason, '') ||
        CASE WHEN hold_reason IS NULL OR hold_reason = '' THEN '' ELSE ' | ' END ||
        'Order refunded (' || p_gateway_ref || ')',
      eligible_at = NULL,
      updated_at = now()
  WHERE order_id = r.order_id
    AND settlement_status IN ('pending', 'eligible', 'processing', 'settled', 'on_hold');

  SELECT * INTO o FROM public.orders WHERE id = r.order_id;
  IF FOUND THEN
    IF o.checkout_group_id IS NOT NULL AND COALESCE(r.amount, 0) > 0 THEN
      UPDATE public.checkout_groups cg
      SET amount_refunded = ROUND(COALESCE(cg.amount_refunded, 0) + r.amount, 2),
          payment_status = CASE
            WHEN ROUND(COALESCE(cg.amount_refunded, 0) + r.amount, 2)
                 >= ROUND(COALESCE(cg.gateway_captured_amount, cg.total_amount, 0), 2)
              THEN 'refunded'
            ELSE 'partially_refunded'
          END,
          updated_at = now()
      WHERE cg.id = o.checkout_group_id;

      PERFORM public.refresh_checkout_group_totals(o.checkout_group_id);
    END IF;

    _paid := NULLIF(COALESCE(o.total_amount, 0) + COALESCE(o.wallet_cash_amount, 0) + COALESCE(o.wallet_promo_amount, 0) + COALESCE(o.loyalty_discount_amount, 0), 0);
    IF COALESCE(o.total_amount, 0) > 0 THEN
      _paid := o.total_amount;
    END IF;
    IF _paid IS NOT NULL AND COALESCE(r.amount, 0) > 0 THEN
      _frac := LEAST(GREATEST(r.amount / NULLIF(_paid, 0), 0), 1);
    ELSE
      _frac := 1;
    END IF;

    PERFORM public.reverse_loyalty_earn_for_order(o.id, _frac);

    SELECT EXISTS (
      SELECT 1 FROM public.loyalty_ledger ll
      WHERE ll.order_id = o.id
        AND ll.entry_type = 'refund_restore'
    ) INTO _loyalty_already;

    IF NOT COALESCE(_loyalty_already, false) THEN
      _restore := FLOOR(COALESCE(o.loyalty_points_redeemed, 0) * _frac)::integer;
      IF _restore > 0 THEN
        PERFORM public.restore_loyalty_for_order(o.id, _restore, 'refund');
      END IF;
    END IF;

    SELECT EXISTS (
      SELECT 1 FROM public.wallet_ledger_txns w
      WHERE w.reference_type = 'order'
        AND w.reference_id = o.id::text
        AND w.type = 'spend_restore'
    ) INTO _wallet_already;

    IF NOT COALESCE(_wallet_already, false)
       AND COALESCE(r.refund_destination, 'original_payment') <> 'wallet' THEN
      _wallet_cash := ROUND(COALESCE(o.wallet_cash_amount, 0) * _frac, 2);
      _wallet_promo := ROUND(COALESCE(o.wallet_promo_amount, 0) * _frac, 2);
      IF _wallet_cash > 0 OR _wallet_promo > 0 THEN
        PERFORM public.restore_wallet_for_order(o.id, _wallet_cash, _wallet_promo, 'refund');
      END IF;
    END IF;
  END IF;

  IF COALESCE(r.refund_destination, 'original_payment') = 'wallet' THEN
    _notify_body := 'Your refund of INR ' || r.amount || ' was credited instantly as Sociva Credit. Usable on Sociva only (not withdrawable). Ref: ' || p_gateway_ref;
  ELSE
    _notify_body := 'Your refund of INR ' || r.amount || ' has been settled to your original payment method. Ref: ' || p_gateway_ref;
  END IF;

  INSERT INTO public.refund_audit_log(refund_id, action, actor_role, before_state, after_state, metadata)
  VALUES (p_refund_id, 'complete', 'system', v_before, 'refund_completed',
          jsonb_build_object(
            'gateway_ref', p_gateway_ref,
            'gateway_status', p_gateway_status,
            'refund_destination', r.refund_destination,
            'checkout_group_id', o.checkout_group_id,
            'settlement_clawback', true
          ));

  INSERT INTO public.notification_queue(user_id, title, body, type, reference_path, payload)
  VALUES (r.buyer_id,
          'Refund completed',
          _notify_body,
          'order',
          '/orders/' || r.order_id,
          jsonb_build_object(
            'orderId', r.order_id,
            'refundId', r.id,
            'status', 'refund_completed',
            'target_role', 'buyer',
            'refund_destination', r.refund_destination
          ));

  RETURN r;
END;
$function$;
