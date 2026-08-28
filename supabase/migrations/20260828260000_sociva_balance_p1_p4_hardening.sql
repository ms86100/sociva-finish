-- P1–P4 hardening: Sociva Balance copy, wallet spend gate, settlement accuracy, admin reporting.

-- ── credit_wallet_from_refund: product language ────────────────────────────────
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

  _amt := ROUND(COALESCE(r.approved_amount, r.wallet_credit_amount, r.amount, 0)::numeric, 2);
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
    'Refund added to Sociva Balance'
  );

  UPDATE public.refund_requests
  SET wallet_credit_amount = _amt,
      funding_party = COALESCE(funding_party, 'SELLER_FUNDED')
  WHERE id = r.id;

  RETURN _res;
END;
$$;

-- ── quote_wallet_application: platform + spend flag gate ─────────────────────
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
  _spend_enabled boolean := false;
BEGIN
  IF _uid IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'not_authenticated');
  END IF;

  IF NOT public.is_online_payment_platform_enabled() THEN
    RETURN jsonb_build_object(
      'success', true,
      'max_amount', 0,
      'cash_available', 0,
      'promo_available', 0,
      'reason', 'platform_offline',
      'plan', jsonb_build_object('promo_amount', 0, 'cash_amount', 0, 'total', 0)
    );
  END IF;

  SELECT COALESCE(enabled, false) INTO _spend_enabled
  FROM public.financial_feature_flags
  WHERE key = 'wallet_spend_enabled';

  IF NOT COALESCE(_spend_enabled, false) THEN
    RETURN jsonb_build_object(
      'success', true,
      'max_amount', 0,
      'cash_available', 0,
      'promo_available', 0,
      'reason', 'wallet_spend_disabled',
      'plan', jsonb_build_object('promo_amount', 0, 'cash_amount', 0, 'total', 0)
    );
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

-- ── complete_refund: gross order value + Sociva Balance buyer notification ─────
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
  _notify_title text;
  v_refunded numeric;
  v_full boolean;
  v_settle numeric;
  v_order_gross numeric;
BEGIN
  SELECT * INTO r FROM public.refund_requests WHERE id = p_refund_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Refund not found'; END IF;
  v_before := r.refund_state;
  IF r.refund_state NOT IN ('refund_initiated','refund_processing') THEN
    RAISE EXCEPTION 'Refund cannot be completed from state: %', r.refund_state;
  END IF;

  v_settle := ROUND(COALESCE(r.approved_amount, r.amount, 0)::numeric, 2);

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

  SELECT COALESCE(SUM(ROUND(COALESCE(rr.approved_amount, rr.amount, 0)::numeric, 2)), 0) INTO v_refunded
  FROM public.refund_requests rr
  WHERE rr.order_id = r.order_id
    AND rr.refund_state = 'refund_completed';

  SELECT * INTO o FROM public.orders WHERE id = r.order_id FOR UPDATE;

  v_order_gross := ROUND(COALESCE(
    NULLIF(o.frozen_total, 0),
    COALESCE(o.total_amount, 0)
      + COALESCE(o.wallet_cash_amount, 0)
      + COALESCE(o.wallet_promo_amount, 0)
  )::numeric, 2);

  v_full := v_order_gross > 0 AND ROUND(v_refunded, 2) >= v_order_gross;

  UPDATE public.orders
  SET amount_refunded = ROUND(v_refunded, 2),
      payment_status = CASE WHEN v_full THEN 'refunded' ELSE payment_status END,
      updated_at = now()
  WHERE id = r.order_id;

  IF v_full THEN
    UPDATE public.payment_records
    SET payment_status = 'refunded'
    WHERE order_id = r.order_id
      AND payment_status IN ('paid', 'refund_initiated', 'refund_processing');
  END IF;

  UPDATE public.seller_settlements s
  SET net_amount = GREATEST(ROUND(COALESCE(s.net_amount, 0) - v_settle, 2), 0),
      settlement_status = CASE
        WHEN v_full OR GREATEST(ROUND(COALESCE(s.net_amount, 0) - v_settle, 2), 0) <= 0 THEN
          CASE WHEN s.settlement_status = 'settled' THEN 'disputed' ELSE 'on_hold' END
        ELSE s.settlement_status
      END,
      hold_reason = CASE
        WHEN v_full OR GREATEST(ROUND(COALESCE(s.net_amount, 0) - v_settle, 2), 0) <= 0 THEN
          COALESCE(s.hold_reason, '') ||
          CASE WHEN s.hold_reason IS NULL OR s.hold_reason = '' THEN '' ELSE ' | ' END ||
          'Order refunded (' || p_gateway_ref || ')'
        ELSE COALESCE(s.hold_reason, '') ||
          CASE WHEN s.hold_reason IS NULL OR s.hold_reason = '' THEN '' ELSE ' | ' END ||
          'Partial refund ' || v_settle::text || ' (' || p_gateway_ref || ')'
      END,
      eligible_at = CASE
        WHEN v_full OR GREATEST(ROUND(COALESCE(s.net_amount, 0) - v_settle, 2), 0) <= 0
          THEN NULL
        ELSE s.eligible_at
      END,
      updated_at = now()
  WHERE s.order_id = r.order_id
    AND s.settlement_status IN ('pending', 'eligible', 'processing', 'settled', 'on_hold');

  SELECT * INTO o FROM public.orders WHERE id = r.order_id;
  IF FOUND THEN
    IF o.checkout_group_id IS NOT NULL AND v_settle > 0 THEN
      UPDATE public.checkout_groups cg
      SET amount_refunded = ROUND(COALESCE(cg.amount_refunded, 0) + v_settle, 2),
          payment_status = CASE
            WHEN ROUND(COALESCE(cg.amount_refunded, 0) + v_settle, 2)
                 >= ROUND(COALESCE(cg.gateway_captured_amount, cg.total_amount, 0), 2)
              THEN 'refunded'
            ELSE 'partially_refunded'
          END,
          updated_at = now()
      WHERE cg.id = o.checkout_group_id;
    END IF;

    _paid := NULLIF(v_order_gross, 0);
    IF _paid IS NOT NULL AND v_settle > 0 THEN
      _frac := LEAST(GREATEST(v_settle / NULLIF(_paid, 0), 0), 1);
    ELSE
      _frac := 1;
    END IF;

    PERFORM public.reverse_loyalty_earn_for_order(o.id, _frac);

    _restore := FLOOR(COALESCE(o.loyalty_points_redeemed, 0) * _frac)::integer;
    IF _restore > 0 THEN
      PERFORM public.restore_loyalty_for_order(o.id, _restore, 'refund');
    END IF;

    IF COALESCE(r.refund_destination, 'wallet') <> 'wallet' THEN
      _wallet_cash := ROUND(COALESCE(o.wallet_cash_amount, 0) * _frac, 2);
      _wallet_promo := ROUND(COALESCE(o.wallet_promo_amount, 0) * _frac, 2);
      IF _wallet_cash > 0 OR _wallet_promo > 0 THEN
        PERFORM public.restore_wallet_for_order(o.id, _wallet_cash, _wallet_promo, 'refund');
      END IF;
    END IF;
  END IF;

  IF COALESCE(r.refund_destination, 'wallet') = 'wallet' THEN
    _notify_title := 'Sociva Balance added';
    _notify_body := 'Your refund of ₹' || trim(to_char(v_settle, 'FM9999990.00'))
      || ' from order #' || left(replace(r.order_id::text, '-', ''), 8)
      || ' has been added to your Sociva Balance. Use it on eligible online purchases on Sociva.';
  ELSE
    _notify_title := 'Refund completed';
    _notify_body := 'Your refund of ₹' || trim(to_char(v_settle, 'FM9999990.00'))
      || ' has been settled to your original payment method. Ref: ' || p_gateway_ref;
  END IF;

  INSERT INTO public.refund_audit_log(refund_id, action, actor_role, before_state, after_state, metadata)
  VALUES (p_refund_id, 'complete', 'system', v_before, 'refund_completed',
          jsonb_build_object(
            'gateway_ref', p_gateway_ref,
            'gateway_status', p_gateway_status,
            'refund_destination', r.refund_destination,
            'funding_party', r.funding_party,
            'approved_amount', v_settle,
            'full_order_refund', v_full,
            'order_amount_refunded', v_refunded,
            'order_gross', v_order_gross
          ));

  INSERT INTO public.notification_queue(user_id, title, body, type, reference_path, action_url, payload)
  VALUES (r.buyer_id,
          _notify_title,
          _notify_body,
          'order',
          '/orders/' || r.order_id,
          '/orders/' || r.order_id,
          jsonb_build_object(
            'orderId', r.order_id,
            'refundId', r.id,
            'status', 'refund_completed',
            'target_role', 'buyer',
            'refund_destination', r.refund_destination,
            'refund_amount', v_settle,
            'funding_party', r.funding_party,
            'high_priority', true,
            'wa_template', 'sociva_refund_update'
          ));

  PERFORM public.recompute_buyer_refund_risk(r.buyer_id);

  RETURN r;
END;
$function$;

-- ── list_seller_refund_requests: payment + settlement context ────────────────
CREATE OR REPLACE FUNCTION public.list_seller_refund_requests(p_seller_ids uuid[])
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path = public, pg_temp
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'authentication required';
  END IF;
  IF p_seller_ids IS NULL OR cardinality(p_seller_ids) = 0 THEN
    RETURN '[]'::jsonb;
  END IF;
  IF EXISTS (
    SELECT 1
    FROM unnest(p_seller_ids) AS sid
    WHERE NOT EXISTS (
      SELECT 1
      FROM public.seller_profiles sp
      WHERE sp.id = sid AND sp.user_id = auth.uid()
    )
  ) THEN
    RAISE EXCEPTION 'seller scope forbidden';
  END IF;

  RETURN COALESCE((
    SELECT jsonb_agg(to_jsonb(r) ORDER BY r.created_at DESC)
    FROM (
      SELECT
        rr.id,
        rr.order_id,
        rr.status,
        rr.refund_state,
        rr.category,
        rr.reason,
        rr.amount,
        rr.requested_amount,
        rr.approved_amount,
        rr.seller_decision,
        rr.refund_destination,
        rr.funding_party,
        rr.created_at,
        rr.seller_id,
        lower(trim(COALESCE(o.payment_type, o.payment_method, ''))) AS payment_type,
        COALESCE(o.wallet_cash_amount, 0) AS wallet_cash_amount,
        COALESCE(o.wallet_promo_amount, 0) AS wallet_promo_amount,
        o.total_amount AS order_residual,
        o.frozen_total,
        s.net_amount AS settlement_net,
        s.settlement_status,
        (public.get_sociva_balance_refund_eligibility(rr.order_id)->>'eligible')::boolean AS sociva_balance_refund_eligible
      FROM public.refund_requests rr
      JOIN public.orders o ON o.id = rr.order_id
      LEFT JOIN public.seller_settlements s ON s.order_id = rr.order_id
      WHERE rr.seller_id = ANY(p_seller_ids)
      ORDER BY rr.created_at DESC
      LIMIT 100
    ) r
  ), '[]'::jsonb);
END;
$$;

-- ── admin_list_seller_refunds: funding + payment context ─────────────────────
CREATE OR REPLACE FUNCTION public.admin_list_seller_refunds(p_limit integer DEFAULT 80)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_admin(auth.uid()) THEN
    RAISE EXCEPTION 'admin required';
  END IF;
  RETURN COALESCE((
    SELECT jsonb_agg(to_jsonb(rows) ORDER BY rows.created_at DESC)
    FROM (
      SELECT
        r.id,
        r.order_id,
        r.seller_id,
        r.amount,
        r.requested_amount,
        r.approved_amount,
        r.refund_state,
        r.status,
        r.refund_destination,
        r.funding_party,
        r.seller_decision,
        r.created_at,
        r.settled_at,
        o.total_amount AS order_residual,
        o.amount_refunded AS order_amount_refunded,
        lower(trim(COALESCE(o.payment_type, o.payment_method, ''))) AS payment_type,
        COALESCE(o.wallet_cash_amount, 0) AS wallet_cash_amount,
        COALESCE(o.wallet_promo_amount, 0) AS wallet_promo_amount,
        sp.business_name AS seller_name,
        public.get_public_payment_mode() AS payment_gateway_mode,
        (public.get_sociva_balance_refund_eligibility(r.order_id)->>'eligible')::boolean AS sociva_balance_refund_eligible
      FROM public.refund_requests r
      LEFT JOIN public.orders o ON o.id = r.order_id
      LEFT JOIN public.seller_profiles sp ON sp.id = r.seller_id
      ORDER BY r.created_at DESC
      LIMIT LEAST(GREATEST(p_limit, 1), 200)
    ) rows
  ), '[]'::jsonb);
END;
$$;

-- ── P4: admin Sociva Balance / refund dashboard ───────────────────────────────
CREATE OR REPLACE FUNCTION public.admin_get_sociva_balance_refund_dashboard()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
DECLARE
  v_mode text;
  v_online boolean;
  v_wallet_refund boolean;
  v_wallet_spend boolean;
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_admin(auth.uid()) THEN
    RAISE EXCEPTION 'admin required';
  END IF;

  v_mode := public.get_public_payment_mode();
  v_online := v_mode <> 'off';

  SELECT COALESCE(bool_or(enabled) FILTER (WHERE key = 'wallet_refund_credit_enabled'), false),
         COALESCE(bool_or(enabled) FILTER (WHERE key = 'wallet_spend_enabled'), false)
  INTO v_wallet_refund, v_wallet_spend
  FROM public.financial_feature_flags;

  RETURN jsonb_build_object(
    'payment_gateway_mode', v_mode,
    'online_payment_enabled', v_online,
    'wallet_refund_credit_enabled', v_wallet_refund,
    'wallet_spend_enabled', v_wallet_spend,
    'sociva_balance_refund_enabled', v_online AND v_wallet_refund,
    'sociva_balance_spend_enabled', v_online AND v_wallet_spend,
    'buyer_wallet', (
      SELECT jsonb_build_object(
        'active_accounts', COUNT(*) FILTER (WHERE status = 'active'),
        'frozen_accounts', COUNT(*) FILTER (WHERE status = 'frozen'),
        'total_cash_available', ROUND(COALESCE(SUM(cash_available) FILTER (WHERE status = 'active'), 0), 2),
        'total_promo_available', ROUND(COALESCE(SUM(promo_available) FILTER (WHERE status = 'active'), 0), 2),
        'total_available', ROUND(COALESCE(SUM(cash_available + promo_available) FILTER (WHERE status = 'active'), 0), 2)
      )
      FROM public.buyer_wallets
    ),
    'refunds_last_30d', (
      SELECT jsonb_build_object(
        'total_requests', COUNT(*),
        'completed_wallet', COUNT(*) FILTER (WHERE refund_destination = 'wallet' AND refund_state = 'refund_completed'),
        'seller_resolution', COUNT(*) FILTER (WHERE refund_destination = 'seller_resolution'),
        'pending', COUNT(*) FILTER (WHERE refund_state IN ('requested', 'approved', 'refund_initiated', 'refund_processing')),
        'total_approved_amount', ROUND(COALESCE(SUM(approved_amount) FILTER (WHERE refund_state = 'refund_completed'), 0), 2)
      )
      FROM public.refund_requests
      WHERE created_at >= now() - interval '30 days'
    ),
    'funding_party_breakdown', (
      SELECT COALESCE(jsonb_object_agg(COALESCE(funding_party, 'UNKNOWN'), cnt), '{}'::jsonb)
      FROM (
        SELECT funding_party, COUNT(*)::int AS cnt
        FROM public.refund_requests
        WHERE refund_state = 'refund_completed'
          AND created_at >= now() - interval '90 days'
        GROUP BY funding_party
      ) fp
    ),
    'cod_wallet_historical_orders', (
      SELECT COUNT(*)::int
      FROM public.orders o
      WHERE lower(trim(COALESCE(o.payment_type, o.payment_method, ''))) IN ('cod', 'cash')
        AND (COALESCE(o.wallet_cash_amount, 0) > 0 OR COALESCE(o.wallet_promo_amount, 0) > 0)
    ),
    'open_disputes', (
      SELECT COUNT(*)::int
      FROM public.refund_requests
      WHERE refund_state IN ('requested', 'approved', 'refund_initiated', 'refund_processing', 'needs_manual_review')
    )
  );
END;
$$;

REVOKE ALL ON FUNCTION public.admin_get_sociva_balance_refund_dashboard() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_get_sociva_balance_refund_dashboard() TO authenticated;
