-- Payment-mode-dependent Sociva Balance refunds + block wallet on COD (forward-only).

-- ── funding_party on refunds ─────────────────────────────────────────────────
ALTER TABLE public.refund_requests
  ADD COLUMN IF NOT EXISTS funding_party text;

COMMENT ON COLUMN public.refund_requests.funding_party IS
  'SELLER_FUNDED | SOCIVA_FUNDED | SHARED — who funded the buyer credit resolution';

ALTER TABLE public.refund_requests
  DROP CONSTRAINT IF EXISTS refund_requests_refund_destination_check;

ALTER TABLE public.refund_requests
  ADD CONSTRAINT refund_requests_refund_destination_check
  CHECK (refund_destination IN ('original_payment', 'wallet', 'split', 'seller_resolution'));

-- ── Platform online gate (authoritative: admin_settings.payment_gateway_mode) ─
CREATE OR REPLACE FUNCTION public.is_online_payment_platform_enabled()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT public.get_public_payment_mode() <> 'off';
$$;

REVOKE ALL ON FUNCTION public.is_online_payment_platform_enabled() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_online_payment_platform_enabled() TO authenticated, service_role;

-- ── Order payment source (COD vs controlled online) ──────────────────────────
CREATE OR REPLACE FUNCTION public.is_order_online_payment_source(p_order_id uuid)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_pm text;
BEGIN
  SELECT lower(trim(COALESCE(o.payment_type, o.payment_method, '')))
  INTO v_pm
  FROM public.orders o
  WHERE o.id = p_order_id;

  IF NOT FOUND OR v_pm = '' THEN
    RETURN false;
  END IF;

  IF v_pm IN ('cod', 'cash') THEN
    RETURN false;
  END IF;

  -- wallet / online / upi / razorpay / card = controlled or prepaid paths
  RETURN v_pm IN (
    'wallet', 'online', 'upi', 'razorpay', 'card',
    'upi_deep_link', 'prepaid'
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.is_order_online_payment_source(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_order_online_payment_source(uuid) TO authenticated, service_role;

-- ── Central eligibility (server + UI) ────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.get_sociva_balance_refund_eligibility(p_order_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_mode text;
  v_wallet_flag boolean := false;
  v_online_platform boolean;
  v_online_order boolean;
  v_pm text;
  v_eligible boolean := false;
  v_reason text;
  v_message text;
BEGIN
  v_mode := public.get_public_payment_mode();
  v_online_platform := v_mode <> 'off';

  SELECT COALESCE(enabled, false) INTO v_wallet_flag
  FROM public.financial_feature_flags
  WHERE key = 'wallet_refund_credit_enabled';

  SELECT lower(trim(COALESCE(o.payment_type, o.payment_method, '')))
  INTO v_pm
  FROM public.orders o
  WHERE o.id = p_order_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object(
      'eligible', false,
      'reason', 'ORDER_NOT_FOUND',
      'message', 'Order not found',
      'payment_gateway_mode', v_mode,
      'payment_method', null,
      'refund_destination', null
    );
  END IF;

  v_online_order := public.is_order_online_payment_source(p_order_id);

  IF NOT v_online_platform THEN
    v_reason := 'PLATFORM_ONLINE_DISABLED';
    v_message := 'Online payment refunds are unavailable while the platform is in COD-only mode.';
  ELSIF NOT COALESCE(v_wallet_flag, false) THEN
    v_reason := 'WALLET_REFUND_FLAG_DISABLED';
    v_message := 'Sociva Balance refunds are temporarily disabled.';
  ELSIF NOT v_online_order THEN
    v_reason := 'COD_PAYMENT_NOT_SUPPORTED_FOR_SOCIVA_BALANCE_REFUND';
    v_message := 'Sociva Balance refunds are not available for Cash on Delivery orders.';
  ELSE
    v_eligible := true;
    v_reason := 'ONLINE_PAYMENT_SUPPORTED';
    v_message := 'Seller may approve a refund as Sociva Balance for this online-paid order.';
  END IF;

  RETURN jsonb_build_object(
    'eligible', v_eligible,
    'reason', v_reason,
    'message', v_message,
    'payment_gateway_mode', v_mode,
    'payment_method', v_pm,
    'online_platform_enabled', v_online_platform,
    'wallet_refund_credit_enabled', COALESCE(v_wallet_flag, false),
    'refund_destination', CASE WHEN v_eligible THEN 'wallet' ELSE null END
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.get_sociva_balance_refund_eligibility(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_sociva_balance_refund_eligibility(uuid) TO authenticated, service_role;

-- ── Block wallet apply on COD (forward-only) ─────────────────────────────────
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
  _pm text;
BEGIN
  IF _want <= 0 THEN
    RETURN jsonb_build_object('success', true, 'amount', 0, 'skipped', true);
  END IF;

  _pm := lower(COALESCE(NULLIF(trim(_payment_method), ''), 'cod'));
  IF _pm = 'cod' THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'wallet_not_eligible_for_cod',
      'message', 'Sociva Balance cannot be used with Cash on Delivery.'
    );
  END IF;

  IF NOT public.is_online_payment_platform_enabled() THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'wallet_spend_platform_offline',
      'message', 'Sociva Balance spending requires an enabled online payment mode.'
    );
  END IF;

  IF _order_ids IS NULL OR coalesce(array_length(_order_ids, 1), 0) = 0 THEN
    RETURN jsonb_build_object('success', false, 'error', 'no_orders');
  END IF;

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

  _sum_bases := NULLIF(_quote_base, 0);
  _remaining_cash := _cash_total;
  _remaining_promo := _promo_total;

  FOR _i IN 1.._n LOOP
    IF _i = _n THEN
      _share_cash := _remaining_cash;
      _share_promo := _remaining_promo;
    ELSE
      _share_total := ROUND((_bases[_i] / _sum_bases) * (_cash_total + _promo_total), 2);
      _plan := public.wallet_plan_spend(
        ROUND((_bases[_i] / _sum_bases) * _cash_total, 2),
        ROUND((_bases[_i] / _sum_bases) * _promo_total, 2),
        _share_total
      );
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

  -- Commit only for prepaid wallet checkout — never for COD
  IF _pm = 'wallet' THEN
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
    'status', CASE WHEN _pm = 'wallet' THEN 'committed' ELSE 'held' END
  );
END;
$$;

-- ── complete_wallet_refund: enforce eligibility ──────────────────────────────
CREATE OR REPLACE FUNCTION public.complete_wallet_refund(p_refund_id uuid)
RETURNS refund_requests
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  r public.refund_requests;
  _credit jsonb;
  v_elig jsonb;
BEGIN
  SELECT * INTO r FROM public.refund_requests WHERE id = p_refund_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Refund not found'; END IF;

  v_elig := public.get_sociva_balance_refund_eligibility(r.order_id);
  IF COALESCE((v_elig->>'eligible')::boolean, false) IS NOT TRUE THEN
    RAISE EXCEPTION 'Sociva Balance refund not allowed: %',
      COALESCE(v_elig->>'message', v_elig->>'reason', 'ineligible');
  END IF;

  IF r.refund_state = 'refund_completed' THEN
    RETURN r;
  END IF;

  IF r.refund_state <> 'approved' AND r.refund_state NOT IN ('refund_initiated', 'refund_processing') THEN
    RAISE EXCEPTION 'Refund cannot be wallet-completed from state: %', r.refund_state;
  END IF;

  IF COALESCE(r.refund_destination, 'wallet') <> 'wallet' THEN
    RAISE EXCEPTION 'Refund destination is not wallet';
  END IF;

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

-- ── seller_respond_refund: gate approve paths ────────────────────────────────
CREATE OR REPLACE FUNCTION public.seller_respond_refund(
  p_refund_id uuid,
  p_action text,
  p_amount numeric DEFAULT NULL,
  p_message text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  r public.refund_requests;
  v_seller_profile uuid;
  v_seller_user uuid;
  v_action text;
  v_cap numeric;
  v_approved numeric;
  v_decision text;
  v_ticket uuid;
  v_item_line text;
  v_before text;
  v_completed public.refund_requests;
  v_elig jsonb;
  v_pm text;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'authentication required';
  END IF;

  v_action := lower(trim(COALESCE(p_action, '')));
  IF v_action NOT IN ('approve_full', 'approve_partial', 'reject', 'request_info') THEN
    RAISE EXCEPTION 'Invalid action: %', p_action;
  END IF;

  SELECT * INTO r FROM public.refund_requests WHERE id = p_refund_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Refund not found'; END IF;
  v_before := r.refund_state;

  SELECT o.seller_id, lower(trim(COALESCE(o.payment_type, o.payment_method, '')))
  INTO v_seller_profile, v_pm
  FROM public.orders o WHERE o.id = r.order_id;

  SELECT sp.user_id INTO v_seller_user FROM public.seller_profiles sp WHERE sp.id = v_seller_profile;

  IF v_seller_user IS DISTINCT FROM auth.uid() AND NOT public.is_admin(auth.uid()) THEN
    RAISE EXCEPTION 'Only the seller can respond to this refund' USING ERRCODE = '42501';
  END IF;

  IF v_action IN ('approve_full', 'approve_partial', 'reject') AND r.refund_state <> 'requested' THEN
    RAISE EXCEPTION 'Refund cannot be actioned from state: %', r.refund_state;
  END IF;

  v_cap := ROUND(COALESCE(r.requested_amount, r.amount, 0)::numeric, 2);
  IF v_cap <= 0 AND v_action IN ('approve_full', 'approve_partial') THEN
    RAISE EXCEPTION 'Invalid refund cap';
  END IF;

  IF v_action IN ('approve_full', 'approve_partial') THEN
    v_elig := public.get_sociva_balance_refund_eligibility(r.order_id);
    IF COALESCE((v_elig->>'eligible')::boolean, false) IS NOT TRUE THEN
      RAISE EXCEPTION '%', COALESCE(v_elig->>'message', 'Sociva Balance refund is not available for this order');
    END IF;
  END IF;

  IF v_action = 'reject' THEN
    IF p_message IS NULL OR length(trim(p_message)) < 5 THEN
      RAISE EXCEPTION 'Rejection reason must be at least 5 characters';
    END IF;

    UPDATE public.refund_requests
    SET refund_state = 'rejected',
        status = 'rejected',
        rejection_reason = trim(p_message),
        seller_decision = 'reject',
        updated_at = now()
    WHERE id = p_refund_id
    RETURNING * INTO r;

    INSERT INTO public.refund_audit_log(refund_id, action, actor_id, actor_role, before_state, after_state, metadata)
    VALUES (p_refund_id, 'reject', auth.uid(), 'seller', v_before, 'rejected',
            jsonb_build_object('reason', trim(p_message)));

    INSERT INTO public.notification_queue(user_id, title, body, type, reference_path, payload)
    VALUES (
      r.buyer_id,
      'Refund request declined',
      left('The seller declined your refund request. Reason: ' || trim(p_message), 240),
      'order',
      '/orders/' || r.order_id,
      jsonb_build_object(
        'orderId', r.order_id,
        'refundId', r.id,
        'status', 'refund_rejected',
        'target_role', 'buyer',
        'high_priority', true
      )
    );

    PERFORM public.recompute_buyer_refund_risk(r.buyer_id);

    RETURN jsonb_build_object('success', true, 'action', 'reject', 'refund', to_jsonb(r));
  END IF;

  IF v_action = 'request_info' THEN
    IF p_message IS NULL OR length(trim(p_message)) < 5 THEN
      RAISE EXCEPTION 'Message must be at least 5 characters';
    END IF;

    UPDATE public.refund_requests
    SET notes = COALESCE(notes, '') ||
      CASE WHEN notes IS NULL OR notes = '' THEN '' ELSE E'\n' END ||
      '[seller ' || to_char(now(), 'YYYY-MM-DD HH24:MI') || '] ' || trim(p_message),
        seller_decision = 'request_info',
        updated_at = now()
    WHERE id = p_refund_id
    RETURNING * INTO r;

    SELECT dt.id INTO v_ticket
    FROM public.dispute_tickets dt
    WHERE dt.order_id = r.order_id
    ORDER BY dt.created_at DESC
    LIMIT 1;

    IF v_ticket IS NOT NULL THEN
      INSERT INTO public.dispute_comments (ticket_id, author_id, body)
      VALUES (v_ticket, auth.uid(), trim(p_message));
    END IF;

    INSERT INTO public.refund_audit_log(refund_id, action, actor_id, actor_role, before_state, after_state, metadata)
    VALUES (p_refund_id, 'request_info', auth.uid(), 'seller', v_before, v_before,
            jsonb_build_object('message', trim(p_message)));

    INSERT INTO public.notification_queue(user_id, title, body, type, reference_path, payload)
    VALUES (
      r.buyer_id,
      'Seller needs more info',
      left(trim(p_message), 240),
      'order',
      '/orders/' || r.order_id,
      jsonb_build_object(
        'orderId', r.order_id,
        'refundId', r.id,
        'status', 'refund_info_requested',
        'target_role', 'buyer',
        'high_priority', true
      )
    );

    RETURN jsonb_build_object('success', true, 'action', 'request_info', 'refund', to_jsonb(r));
  END IF;

  IF v_action = 'approve_full' THEN
    v_approved := v_cap;
    v_decision := 'approve_full';
  ELSE
    v_approved := ROUND(COALESCE(p_amount, 0)::numeric, 2);
    v_decision := 'approve_partial';
    IF v_approved <= 0 OR v_approved > v_cap THEN
      RAISE EXCEPTION 'Partial amount must be between 0.01 and %', v_cap;
    END IF;
  END IF;

  UPDATE public.refund_requests
  SET refund_destination = 'wallet',
      refund_method = 'wallet',
      approved_amount = v_approved,
      wallet_credit_amount = v_approved,
      funding_party = 'SELLER_FUNDED',
      seller_decision = v_decision,
      refund_state = 'approved',
      status = 'approved',
      approved_at = now(),
      approved_by = auth.uid(),
      sla_deadline = now() + interval '72 hours',
      updated_at = now()
  WHERE id = p_refund_id
  RETURNING * INTO r;

  INSERT INTO public.refund_audit_log(refund_id, action, actor_id, actor_role, before_state, after_state, metadata)
  VALUES (p_refund_id, 'approve', auth.uid(), 'seller', v_before, 'approved',
          jsonb_build_object(
            'seller_decision', v_decision,
            'approved_amount', v_approved,
            'refund_destination', 'wallet',
            'funding_party', 'SELLER_FUNDED',
            'payment_method', v_pm
          ));

  v_completed := public.complete_wallet_refund(p_refund_id);

  v_item_line := public.seller_order_item_summary(r.order_id);

  INSERT INTO public.notification_queue(user_id, title, body, type, reference_path, payload)
  VALUES (
    v_seller_user,
    'Refund approved — settlement adjusted',
    left(
      'You approved ₹' || trim(to_char(v_approved, 'FM9999990.00'))
      || ' as Sociva Balance for the buyer. Buyer received instant wallet credit; your payout is adjusted accordingly.'
      || CASE WHEN v_item_line IS NOT NULL THEN ' · ' || v_item_line ELSE '' END,
      240
    ),
    'order',
    '/orders/' || r.order_id,
    jsonb_build_object(
      'orderId', r.order_id,
      'refundId', r.id,
      'status', 'refund_approved_seller',
      'target_role', 'seller',
      'approved_amount', v_approved,
      'seller_decision', v_decision
    )
  );

  RETURN jsonb_build_object(
    'success', true,
    'action', v_action,
    'approved_amount', v_approved,
    'refund', to_jsonb(v_completed)
  );
END;
$function$;

-- ── request_refund: payment-mode-aware destination ───────────────────────────
CREATE OR REPLACE FUNCTION public.request_refund(
  p_order_id uuid,
  p_reason text,
  p_category text DEFAULT 'order_issue'::text,
  p_evidence_urls text[] DEFAULT NULL::text[],
  p_refund_destination text DEFAULT 'wallet'::text
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_order record;
  v_refund_id uuid;
  v_existing uuid;
  v_seller_user uuid;
  v_eligibility jsonb;
  v_refund_elig jsonb;
  v_dest text;
  v_item_line text;
  v_idem text;
  v_amount numeric;
  v_valid_categories text[] := ARRAY[
    'order_issue','quality_issue','wrong_item','not_received','seller_cancelled','other'
  ];
  v_use_wallet boolean := false;
BEGIN
  IF p_category IS NULL OR NOT (p_category = ANY(v_valid_categories)) THEN
    RAISE EXCEPTION 'Invalid refund category: %', COALESCE(p_category, 'NULL');
  END IF;

  SELECT id, buyer_id, seller_id, society_id, total_amount, frozen_total, payment_status, status,
         payment_type, wallet_cash_amount, wallet_promo_amount
  INTO v_order
  FROM orders
  WHERE id = p_order_id AND buyer_id = auth.uid();

  IF v_order IS NULL THEN
    RAISE EXCEPTION 'Order not found or does not belong to you';
  END IF;

  IF v_order.payment_status NOT IN ('paid', 'buyer_confirmed', 'seller_verified', 'completed') THEN
    RAISE EXCEPTION 'No payment found for this order';
  END IF;

  v_eligibility := public.get_buyer_refund_eligibility(p_order_id);
  IF COALESCE((v_eligibility->>'eligible')::boolean, false) IS NOT TRUE THEN
    IF v_eligibility->>'reason' = 'window_closed' THEN
      RAISE EXCEPTION 'Refund window closed. Refunds must be requested within 2 hours of delivery.';
    ELSIF v_eligibility->>'reason' = 'not_delivered' THEN
      RAISE EXCEPTION 'Refunds can only be requested after the order is delivered';
    ELSE
      RAISE EXCEPTION 'This order is not eligible for a refund request';
    END IF;
  END IF;

  v_refund_elig := public.get_sociva_balance_refund_eligibility(p_order_id);
  v_use_wallet := COALESCE((v_refund_elig->>'eligible')::boolean, false);
  v_dest := CASE WHEN v_use_wallet THEN 'wallet' ELSE 'seller_resolution' END;

  SELECT id INTO v_existing
  FROM refund_requests
  WHERE order_id = p_order_id
    AND refund_state NOT IN ('rejected', 'refund_completed')
  ORDER BY created_at DESC
  LIMIT 1
  FOR UPDATE;

  IF v_existing IS NOT NULL THEN
    RETURN v_existing;
  END IF;

  v_amount := COALESCE(
    NULLIF(v_order.frozen_total, 0),
    COALESCE(v_order.total_amount, 0)
      + COALESCE(v_order.wallet_cash_amount, 0)
      + COALESCE(v_order.wallet_promo_amount, 0)
  );

  BEGIN
    INSERT INTO refund_requests (
      order_id, buyer_id, seller_id, society_id, amount, requested_amount, reason, category,
      evidence_urls, refund_method, refund_destination, wallet_credit_amount,
      status, refund_state
    )
    VALUES (
      p_order_id,
      v_order.buyer_id,
      v_order.seller_id,
      v_order.society_id,
      v_amount,
      v_amount,
      p_reason,
      p_category,
      p_evidence_urls,
      CASE WHEN v_use_wallet THEN 'wallet' ELSE 'seller_resolution' END,
      v_dest,
      CASE WHEN v_use_wallet THEN v_amount ELSE NULL END,
      'requested',
      'requested'
    )
    RETURNING id INTO v_refund_id;
  EXCEPTION
    WHEN unique_violation THEN
      SELECT id INTO v_refund_id
      FROM refund_requests
      WHERE order_id = p_order_id
        AND refund_state NOT IN ('rejected', 'refund_completed')
      ORDER BY created_at DESC
      LIMIT 1;
      IF v_refund_id IS NULL THEN
        RAISE;
      END IF;
      RETURN v_refund_id;
  END;

  IF NOT EXISTS (
    SELECT 1 FROM dispute_tickets
    WHERE order_id = p_order_id AND status != 'resolved'
  ) THEN
    INSERT INTO dispute_tickets (order_id, raised_by, against_user, reason, category, status, society_id)
    VALUES (
      p_order_id,
      auth.uid(),
      (SELECT sp.user_id FROM seller_profiles sp WHERE sp.id = v_order.seller_id),
      p_reason,
      p_category,
      'open',
      v_order.society_id
    );
  END IF;

  SELECT sp.user_id INTO v_seller_user
  FROM seller_profiles sp
  WHERE sp.id = v_order.seller_id;

  IF v_seller_user IS NOT NULL THEN
    v_item_line := public.seller_order_item_summary(p_order_id);
    v_idem := md5(p_order_id::text || '-refund_requested-' || v_refund_id::text);

    INSERT INTO public.notification_queue (
      user_id, type, title, body, reference_path, payload, idempotency_key
    )
    VALUES (
      v_seller_user,
      'refund_request',
      CASE WHEN v_use_wallet THEN 'Refund / dispute needs response' ELSE 'Buyer dispute needs response' END,
      left(
        COALESCE(
          (SELECT name FROM profiles WHERE id = v_order.buyer_id),
          'A buyer'
        ) || ' raised a dispute on ₹' || trim(to_char(v_amount, 'FM9999990'))
        || CASE WHEN v_use_wallet THEN ' (Sociva Balance if approved)' ELSE '' END
        || CASE WHEN v_item_line IS NOT NULL THEN ' · ' || v_item_line ELSE '' END
        || '. Respond within 48 hours.',
        240
      ),
      '/seller?tab=refunds&refundId=' || v_refund_id::text,
      jsonb_build_object(
        'orderId', p_order_id,
        'refundId', v_refund_id,
        'status', 'refund_requested',
        'target_role', 'seller',
        'high_priority', true,
        'wa_template', 'sociva_refund_update',
        'refund_destination', v_dest,
        'sociva_balance_refund_eligible', v_use_wallet,
        'refund_amount', v_amount,
        'item_summary', v_item_line,
        'reference_path', '/seller?tab=refunds&refundId=' || v_refund_id::text,
        'action', 'view_refund'
      ),
      v_idem
    )
    ON CONFLICT ON CONSTRAINT idx_notification_queue_idempotency DO NOTHING;
  END IF;

  PERFORM public.recompute_buyer_refund_risk(v_order.buyer_id);

  RETURN v_refund_id;
END;
$function$;

-- ── approve_refund service path: eligibility gate ────────────────────────────
CREATE OR REPLACE FUNCTION public.approve_refund(p_refund_id uuid)
RETURNS public.refund_requests
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_res jsonb;
  r public.refund_requests;
  v_cap numeric;
  v_elig jsonb;
BEGIN
  IF auth.uid() IS NOT NULL THEN
    v_res := public.seller_respond_refund(p_refund_id, 'approve_full', NULL, NULL);
    SELECT * INTO r FROM public.refund_requests WHERE id = p_refund_id;
    RETURN r;
  END IF;

  SELECT * INTO r FROM public.refund_requests WHERE id = p_refund_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Refund not found'; END IF;
  IF r.refund_state <> 'requested' THEN
    RAISE EXCEPTION 'Refund cannot be approved from state: %', r.refund_state;
  END IF;

  v_elig := public.get_sociva_balance_refund_eligibility(r.order_id);
  IF COALESCE((v_elig->>'eligible')::boolean, false) IS NOT TRUE THEN
    RAISE EXCEPTION 'Sociva Balance refund not allowed: %',
      COALESCE(v_elig->>'message', v_elig->>'reason');
  END IF;

  v_cap := ROUND(COALESCE(r.requested_amount, r.amount, 0)::numeric, 2);

  UPDATE public.refund_requests
  SET refund_destination = 'wallet',
      refund_method = 'wallet',
      approved_amount = v_cap,
      wallet_credit_amount = v_cap,
      funding_party = 'SELLER_FUNDED',
      seller_decision = COALESCE(seller_decision, 'approve_full'),
      refund_state = 'approved',
      status = 'approved',
      approved_at = now(),
      sla_deadline = now() + interval '72 hours',
      updated_at = now()
  WHERE id = p_refund_id
  RETURNING * INTO r;

  INSERT INTO public.refund_audit_log(refund_id, action, actor_role, before_state, after_state, metadata)
  VALUES (p_refund_id, 'approve', 'system', 'requested', 'approved',
          jsonb_build_object('approved_amount', v_cap, 'refund_destination', 'wallet', 'funding_party', 'SELLER_FUNDED'));

  PERFORM public.complete_wallet_refund(p_refund_id);
  SELECT * INTO r FROM public.refund_requests WHERE id = p_refund_id;
  RETURN r;
END;
$$;

-- ── enforce_refund_destination_switch: payment-mode aware ────────────────────
CREATE OR REPLACE FUNCTION finance.enforce_refund_destination_switch()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = finance, public, pg_temp
AS $$
DECLARE
  v_elig jsonb;
BEGIN
  IF NEW.refund_destination = 'wallet'
     AND (
       TG_OP = 'INSERT'
       OR NEW.refund_destination IS DISTINCT FROM OLD.refund_destination
     ) THEN
    v_elig := public.get_sociva_balance_refund_eligibility(NEW.order_id);
    IF COALESCE((v_elig->>'eligible')::boolean, false) IS NOT TRUE THEN
      RAISE EXCEPTION 'Sociva Balance refund not allowed: %',
        COALESCE(v_elig->>'message', v_elig->>'reason', 'ineligible');
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

-- ── get_financial_capabilities: derived refund/spend gates ───────────────────
CREATE OR REPLACE FUNCTION public.get_financial_capabilities()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path = public, finance, pg_temp
AS $$
DECLARE
  v_result jsonb;
  v_online boolean;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'authentication required';
  END IF;

  v_online := public.is_online_payment_platform_enabled();

  SELECT jsonb_build_object(
    'payment_gateway_mode', public.get_public_payment_mode(),
    'online_payment_enabled', v_online,
    'wallet_refund_credit_enabled', COALESCE(bool_or(enabled) FILTER (
      WHERE key = 'wallet_refund_credit_enabled'
    ), false),
    'wallet_spend_enabled', COALESCE(bool_or(enabled) FILTER (
      WHERE key = 'wallet_spend_enabled'
    ), false),
    'seller_payout_enabled', COALESCE(bool_or(enabled) FILTER (
      WHERE key = 'seller_payout_enabled'
    ), false),
    'sociva_balance_refund_enabled', v_online AND COALESCE(bool_or(enabled) FILTER (
      WHERE key = 'wallet_refund_credit_enabled'
    ), false),
    'sociva_balance_spend_enabled', v_online AND COALESCE(bool_or(enabled) FILTER (
      WHERE key = 'wallet_spend_enabled'
    ), false)
  )
  INTO v_result
  FROM public.financial_feature_flags;

  RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION public.get_financial_capabilities() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_financial_capabilities() TO authenticated;
