-- Seller financial truth: keep Settled GMV and seller payable separate.
-- Wallet is a read model over settlements / refunds / payouts / COD.
-- Do not enable seller_payout_enabled.

ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS amount_refunded numeric NOT NULL DEFAULT 0;

COMMENT ON COLUMN public.orders.amount_refunded IS
  'Cumulative completed refunds. Settled GMV uses GREATEST(total_amount - amount_refunded, 0).';

ALTER TABLE public.seller_settlements
  ADD COLUMN IF NOT EXISTS offline_transfer_ref text,
  ADD COLUMN IF NOT EXISTS offline_transfer_method text,
  ADD COLUMN IF NOT EXISTS offline_transferred_at timestamptz,
  ADD COLUMN IF NOT EXISTS offline_transferred_by uuid;

CREATE TABLE IF NOT EXISTS public.seller_withdrawal_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  seller_id uuid NOT NULL REFERENCES public.seller_profiles(id),
  requested_by uuid REFERENCES auth.users(id),
  amount numeric NOT NULL CHECK (amount > 0),
  available_snapshot numeric NOT NULL DEFAULT 0,
  destination_label text,
  destination_id uuid,
  status text NOT NULL DEFAULT 'requested'
    CHECK (status IN ('requested','approved','processing','transferred','rejected','cancelled')),
  transfer_method text,
  transfer_ref text,
  transferred_at timestamptz,
  transferred_by uuid,
  admin_notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_seller_withdrawal_requests_seller
  ON public.seller_withdrawal_requests (seller_id, created_at DESC);

ALTER TABLE public.seller_withdrawal_requests ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS seller_withdrawal_requests_select_own ON public.seller_withdrawal_requests;
CREATE POLICY seller_withdrawal_requests_select_own
  ON public.seller_withdrawal_requests
  FOR SELECT
  TO authenticated
  USING (
    public.is_admin(auth.uid())
    OR EXISTS (
      SELECT 1 FROM public.seller_profiles sp
      WHERE sp.id = seller_id AND sp.user_id = auth.uid()
    )
  );

REVOKE INSERT, UPDATE, DELETE ON public.seller_withdrawal_requests FROM PUBLIC, anon, authenticated;

INSERT INTO public.system_settings (key, value, description)
VALUES (
  'settlement_cooldown_hours',
  '48'::jsonb,
  'Hours after delivery before a settlement becomes eligible'
)
ON CONFLICT (key) DO UPDATE
SET value = COALESCE(public.system_settings.value, '48'::jsonb),
    description = COALESCE(public.system_settings.description, EXCLUDED.description);

UPDATE public.system_settings
SET value = '48'::jsonb
WHERE key = 'settlement_cooldown_hours'
  AND (
    value IS NULL
    OR value::text IN ('null', '""', '')
  );

CREATE OR REPLACE FUNCTION public.order_settled_gmv(
  p_status text,
  p_payment_status text,
  p_total numeric,
  p_amount_refunded numeric
)
RETURNS numeric
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE
    WHEN p_status NOT IN ('completed', 'delivered', 'buyer_received') THEN 0
    WHEN COALESCE(p_payment_status, '') = 'refunded' AND COALESCE(p_amount_refunded, 0) <= 0 THEN 0
    ELSE GREATEST(ROUND(COALESCE(p_total, 0) - COALESCE(p_amount_refunded, 0), 2), 0)
  END;
$$;

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
  v_refunded numeric;
  v_full boolean;
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

  SELECT COALESCE(SUM(rr.amount), 0) INTO v_refunded
  FROM public.refund_requests rr
  WHERE rr.order_id = r.order_id
    AND rr.refund_state = 'refund_completed';

  SELECT * INTO o FROM public.orders WHERE id = r.order_id FOR UPDATE;
  v_full := ROUND(v_refunded, 2) >= ROUND(COALESCE(o.total_amount, 0), 2)
            AND COALESCE(o.total_amount, 0) > 0;

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
  SET net_amount = GREATEST(ROUND(COALESCE(s.net_amount, 0) - COALESCE(r.amount, 0), 2), 0),
      settlement_status = CASE
        WHEN v_full OR GREATEST(ROUND(COALESCE(s.net_amount, 0) - COALESCE(r.amount, 0), 2), 0) <= 0 THEN
          CASE WHEN s.settlement_status = 'settled' THEN 'disputed' ELSE 'on_hold' END
        ELSE s.settlement_status
      END,
      hold_reason = CASE
        WHEN v_full OR GREATEST(ROUND(COALESCE(s.net_amount, 0) - COALESCE(r.amount, 0), 2), 0) <= 0 THEN
          COALESCE(s.hold_reason, '') ||
          CASE WHEN s.hold_reason IS NULL OR s.hold_reason = '' THEN '' ELSE ' | ' END ||
          'Order refunded (' || p_gateway_ref || ')'
        ELSE COALESCE(s.hold_reason, '') ||
          CASE WHEN s.hold_reason IS NULL OR s.hold_reason = '' THEN '' ELSE ' | ' END ||
          'Partial refund ' || COALESCE(r.amount, 0)::text || ' (' || p_gateway_ref || ')'
      END,
      eligible_at = CASE
        WHEN v_full OR GREATEST(ROUND(COALESCE(s.net_amount, 0) - COALESCE(r.amount, 0), 2), 0) <= 0
          THEN NULL
        ELSE s.eligible_at
      END,
      updated_at = now()
  WHERE s.order_id = r.order_id
    AND s.settlement_status IN ('pending', 'eligible', 'processing', 'settled', 'on_hold');

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

    _restore := FLOOR(COALESCE(o.loyalty_points_redeemed, 0) * _frac)::integer;
    IF _restore > 0 THEN
      PERFORM public.restore_loyalty_for_order(o.id, _restore, 'refund');
    END IF;

    IF COALESCE(r.refund_destination, 'original_payment') <> 'wallet' THEN
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
            'full_order_refund', v_full,
            'order_amount_refunded', v_refunded
          ));

  INSERT INTO public.notification_queue(user_id, title, body, type, reference_path, action_url, payload)
  VALUES (r.buyer_id,
          'Refund completed',
          _notify_body,
          'order',
          '/orders/' || r.order_id,
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

REVOKE ALL ON FUNCTION public.complete_refund(uuid, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.complete_refund(uuid, text, text) TO service_role;

CREATE OR REPLACE FUNCTION public.get_seller_dashboard_kpis(p_seller_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_today_start timestamptz;
  v_week_start timestamptz;
  v_month_start timestamptz;
  v_30d timestamptz := now() - interval '30 days';
  v_result jsonb;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.seller_profiles sp
    WHERE sp.id = p_seller_id AND sp.user_id = v_uid
  ) AND NOT EXISTS (
    SELECT 1 FROM public.user_roles ur
    WHERE ur.user_id = v_uid AND ur.role = 'admin'
  ) THEN
    RAISE EXCEPTION 'not authorized';
  END IF;

  v_today_start := (timezone('Asia/Kolkata', now())::date)::timestamp AT TIME ZONE 'Asia/Kolkata';
  v_week_start := v_today_start
    - ((EXTRACT(DOW FROM timezone('Asia/Kolkata', now()))::integer) * interval '1 day');
  v_month_start := date_trunc('month', timezone('Asia/Kolkata', now())) AT TIME ZONE 'Asia/Kolkata';

  WITH visible AS (
    SELECT
      o.id,
      o.status::text AS status,
      o.payment_status,
      o.total_amount,
      COALESCE(o.amount_refunded, 0) AS amount_refunded,
      public.order_settled_gmv(o.status::text, o.payment_status, o.total_amount, COALESCE(o.amount_refunded, 0)) AS settled_gmv,
      o.created_at,
      o.updated_at,
      o.delivered_at,
      o.status_changed_at,
      CASE
        WHEN o.status = 'payment_pending' AND o.payment_status IS DISTINCT FROM 'buyer_confirmed'
          THEN 'hidden'
        WHEN o.status = 'payment_pending' AND o.payment_status = 'buyer_confirmed'
          THEN 'action_needed'
        WHEN o.status::text IN (
          'placed','pending','accepted','confirmed','requested','scheduled','rescheduled'
        ) THEN 'action_needed'
        WHEN o.status::text IN ('enquired','quoted') THEN 'enquiries'
        WHEN o.status::text IN ('preparing','in_progress') THEN 'preparing'
        WHEN o.status::text = 'ready' THEN 'ready'
        WHEN o.status::text IN (
          'picked_up','on_the_way','at_gate','en_route','assigned','arrived'
        ) THEN 'in_transit'
        WHEN o.status::text = 'awaiting_cod_confirmation' THEN 'cod_confirm'
        WHEN o.status::text IN ('completed','delivered','buyer_received') THEN 'done'
        WHEN o.status::text IN ('cancelled','rejected') THEN 'cancelled'
        WHEN o.status::text = 'no_show' THEN 'no_show'
        WHEN o.status::text IN ('returned','failed') THEN 'terminal_fail'
        ELSE 'action_needed'
      END AS bucket,
      (o.payment_status = 'refunded') AS is_refunded,
      (
        o.status::text IN ('completed','delivered','buyer_received')
        AND public.order_settled_gmv(o.status::text, o.payment_status, o.total_amount, COALESCE(o.amount_refunded, 0)) > 0
      ) AS is_settled
    FROM public.orders o
    WHERE o.seller_id = p_seller_id
  ),
  agg AS (
    SELECT
      COUNT(*) FILTER (WHERE bucket <> 'hidden') AS total_orders,
      COUNT(*) FILTER (WHERE bucket = 'action_needed') AS pending_orders,
      COUNT(*) FILTER (WHERE bucket = 'preparing') AS preparing_orders,
      COUNT(*) FILTER (WHERE bucket = 'ready') AS ready_orders,
      COUNT(*) FILTER (WHERE bucket = 'in_transit') AS in_transit_orders,
      COUNT(*) FILTER (WHERE bucket = 'cod_confirm') AS cod_confirm_orders,
      COUNT(*) FILTER (WHERE bucket = 'done') AS completed_orders,
      COUNT(*) FILTER (WHERE bucket = 'done' AND created_at >= v_today_start) AS done_today,
      COUNT(*) FILTER (WHERE bucket = 'cancelled') AS cancelled_orders,
      COUNT(*) FILTER (WHERE bucket = 'no_show') AS no_show_orders,
      COUNT(*) FILTER (WHERE bucket = 'terminal_fail') AS terminal_fail_orders,
      COUNT(*) FILTER (WHERE bucket = 'enquiries') AS enquiry_orders,
      COUNT(*) FILTER (WHERE bucket <> 'hidden' AND created_at >= v_today_start) AS today_orders,
      COALESCE(SUM(settled_gmv), 0) AS total_earnings,
      COALESCE(SUM(settled_gmv) FILTER (WHERE created_at >= v_today_start), 0) AS today_earnings,
      COALESCE(SUM(settled_gmv) FILTER (WHERE created_at >= v_week_start), 0) AS week_earnings,
      COALESCE(SUM(settled_gmv) FILTER (WHERE created_at >= v_month_start), 0) AS month_earnings,
      ROUND(AVG(
        EXTRACT(EPOCH FROM (
          COALESCE(delivered_at, status_changed_at, updated_at) - created_at
        )) / 60.0
      ) FILTER (
        WHERE is_settled
          AND COALESCE(delivered_at, status_changed_at, updated_at) IS NOT NULL
          AND COALESCE(delivered_at, status_changed_at, updated_at) >= created_at
          AND COALESCE(delivered_at, status_changed_at, updated_at) - created_at < interval '7 days'
      )) AS avg_fulfill_minutes,
      COUNT(*) FILTER (
        WHERE bucket <> 'hidden' AND created_at >= v_30d
      ) AS considered_30d,
      COUNT(*) FILTER (
        WHERE bucket IN ('cancelled','terminal_fail','no_show') AND created_at >= v_30d
      ) AS cancel_30d,
      COUNT(*) FILTER (
        WHERE is_refunded AND created_at >= v_30d
      ) AS refund_30d
    FROM visible
  ),
  refunds AS (
    SELECT COUNT(*)::bigint AS pending_refunds
    FROM public.refund_requests rr
    JOIN public.orders o ON o.id = rr.order_id
    WHERE o.seller_id = p_seller_id
      AND rr.status = 'requested'
  )
  SELECT jsonb_build_object(
    'total_orders', a.total_orders,
    'pending_orders', a.pending_orders,
    'preparing_orders', a.preparing_orders,
    'ready_orders', a.ready_orders,
    'in_transit_orders', a.in_transit_orders,
    'cod_confirm_orders', a.cod_confirm_orders,
    'completed_orders', a.completed_orders,
    'done_today', a.done_today,
    'cancelled_orders', a.cancelled_orders,
    'no_show_orders', a.no_show_orders,
    'terminal_fail_orders', a.terminal_fail_orders,
    'enquiry_orders', a.enquiry_orders,
    'today_orders', a.today_orders,
    'pending_refunds', COALESCE(r.pending_refunds, 0),
    'total_earnings', a.total_earnings,
    'today_earnings', a.today_earnings,
    'week_earnings', a.week_earnings,
    'month_earnings', a.month_earnings,
    'avg_fulfill_minutes', a.avg_fulfill_minutes,
    'cancel_rate_30d', CASE WHEN a.considered_30d > 0
      THEN ROUND((a.cancel_30d::numeric / a.considered_30d) * 100) ELSE 0 END,
    'refund_rate_30d', CASE WHEN a.considered_30d > 0
      THEN ROUND((a.refund_30d::numeric / a.considered_30d) * 100) ELSE 0 END
  )
  INTO v_result
  FROM agg a CROSS JOIN refunds r;

  RETURN COALESCE(v_result, '{}'::jsonb);
END;
$$;

COMMENT ON FUNCTION public.get_seller_dashboard_kpis(uuid) IS
  'Seller dashboard KPIs. Settled GMV = order_settled_gmv for completed|delivered|buyer_received. Payable lives in get_seller_financial_summary.';

CREATE OR REPLACE FUNCTION public.get_seller_portfolio_kpis(p_seller_ids uuid[])
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_ids uuid[];
  v_today_start timestamptz;
  v_week_start timestamptz;
  v_month_start timestamptz;
  v_30d timestamptz := now() - interval '30 days';
  v_result jsonb;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;

  IF p_seller_ids IS NULL OR cardinality(p_seller_ids) = 0 THEN
    RETURN '{}'::jsonb;
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.user_roles ur
    WHERE ur.user_id = v_uid AND ur.role = 'admin'
  ) THEN
    v_ids := p_seller_ids;
  ELSE
    SELECT coalesce(array_agg(sp.id), ARRAY[]::uuid[])
    INTO v_ids
    FROM public.seller_profiles sp
    WHERE sp.user_id = v_uid
      AND sp.id = ANY (p_seller_ids);
  END IF;

  IF cardinality(v_ids) = 0 THEN
    RAISE EXCEPTION 'not authorized';
  END IF;

  v_today_start := (timezone('Asia/Kolkata', now())::date)::timestamp AT TIME ZONE 'Asia/Kolkata';
  v_week_start := v_today_start
    - ((EXTRACT(DOW FROM timezone('Asia/Kolkata', now()))::integer) * interval '1 day');
  v_month_start := date_trunc('month', timezone('Asia/Kolkata', now())) AT TIME ZONE 'Asia/Kolkata';

  WITH visible AS (
    SELECT
      o.id,
      o.status::text AS status,
      o.payment_status,
      o.total_amount,
      public.order_settled_gmv(o.status::text, o.payment_status, o.total_amount, COALESCE(o.amount_refunded, 0)) AS settled_gmv,
      o.created_at,
      o.updated_at,
      o.delivered_at,
      o.status_changed_at,
      CASE
        WHEN o.status = 'payment_pending' AND o.payment_status IS DISTINCT FROM 'buyer_confirmed'
          THEN 'hidden'
        WHEN o.status = 'payment_pending' AND o.payment_status = 'buyer_confirmed'
          THEN 'action_needed'
        WHEN o.status::text IN (
          'placed','pending','accepted','confirmed','requested','scheduled','rescheduled'
        ) THEN 'action_needed'
        WHEN o.status::text IN ('enquired','quoted') THEN 'enquiries'
        WHEN o.status::text IN ('preparing','in_progress') THEN 'preparing'
        WHEN o.status::text = 'ready' THEN 'ready'
        WHEN o.status::text IN (
          'picked_up','on_the_way','at_gate','en_route','assigned','arrived'
        ) THEN 'in_transit'
        WHEN o.status::text = 'awaiting_cod_confirmation' THEN 'cod_confirm'
        WHEN o.status::text IN ('completed','delivered','buyer_received') THEN 'done'
        WHEN o.status::text IN ('cancelled','rejected') THEN 'cancelled'
        WHEN o.status::text = 'no_show' THEN 'no_show'
        WHEN o.status::text IN ('returned','failed') THEN 'terminal_fail'
        ELSE 'action_needed'
      END AS bucket,
      (o.payment_status = 'refunded') AS is_refunded,
      (
        o.status::text IN ('completed','delivered','buyer_received')
        AND public.order_settled_gmv(o.status::text, o.payment_status, o.total_amount, COALESCE(o.amount_refunded, 0)) > 0
      ) AS is_settled
    FROM public.orders o
    WHERE o.seller_id = ANY (v_ids)
  ),
  agg AS (
    SELECT
      COUNT(*) FILTER (WHERE bucket <> 'hidden') AS total_orders,
      COUNT(*) FILTER (WHERE bucket = 'action_needed') AS pending_orders,
      COUNT(*) FILTER (WHERE bucket = 'preparing') AS preparing_orders,
      COUNT(*) FILTER (WHERE bucket = 'ready') AS ready_orders,
      COUNT(*) FILTER (WHERE bucket = 'in_transit') AS in_transit_orders,
      COUNT(*) FILTER (WHERE bucket = 'cod_confirm') AS cod_confirm_orders,
      COUNT(*) FILTER (WHERE bucket = 'done') AS completed_orders,
      COUNT(*) FILTER (WHERE bucket = 'done' AND created_at >= v_today_start) AS done_today,
      COUNT(*) FILTER (WHERE bucket = 'cancelled') AS cancelled_orders,
      COUNT(*) FILTER (WHERE bucket = 'no_show') AS no_show_orders,
      COUNT(*) FILTER (WHERE bucket = 'terminal_fail') AS terminal_fail_orders,
      COUNT(*) FILTER (WHERE bucket = 'enquiries') AS enquiry_orders,
      COUNT(*) FILTER (WHERE bucket <> 'hidden' AND created_at >= v_today_start) AS today_orders,
      COALESCE(SUM(settled_gmv), 0) AS total_earnings,
      COALESCE(SUM(settled_gmv) FILTER (WHERE created_at >= v_today_start), 0) AS today_earnings,
      COALESCE(SUM(settled_gmv) FILTER (WHERE created_at >= v_week_start), 0) AS week_earnings,
      COALESCE(SUM(settled_gmv) FILTER (WHERE created_at >= v_month_start), 0) AS month_earnings,
      ROUND(AVG(
        EXTRACT(EPOCH FROM (
          COALESCE(delivered_at, status_changed_at, updated_at) - created_at
        )) / 60.0
      ) FILTER (
        WHERE is_settled
          AND COALESCE(delivered_at, status_changed_at, updated_at) IS NOT NULL
          AND COALESCE(delivered_at, status_changed_at, updated_at) >= created_at
          AND COALESCE(delivered_at, status_changed_at, updated_at) - created_at < interval '7 days'
      )) AS avg_fulfill_minutes,
      COUNT(*) FILTER (
        WHERE bucket <> 'hidden' AND created_at >= v_30d
      ) AS considered_30d,
      COUNT(*) FILTER (
        WHERE bucket IN ('cancelled','terminal_fail','no_show') AND created_at >= v_30d
      ) AS cancel_30d,
      COUNT(*) FILTER (
        WHERE is_refunded AND created_at >= v_30d
      ) AS refund_30d
    FROM visible
  ),
  refunds AS (
    SELECT COUNT(*)::bigint AS pending_refunds
    FROM public.refund_requests rr
    JOIN public.orders o ON o.id = rr.order_id
    WHERE o.seller_id = ANY (v_ids)
      AND rr.status = 'requested'
  )
  SELECT jsonb_build_object(
    'total_orders', a.total_orders,
    'pending_orders', a.pending_orders,
    'preparing_orders', a.preparing_orders,
    'ready_orders', a.ready_orders,
    'in_transit_orders', a.in_transit_orders,
    'cod_confirm_orders', a.cod_confirm_orders,
    'completed_orders', a.completed_orders,
    'done_today', a.done_today,
    'cancelled_orders', a.cancelled_orders,
    'no_show_orders', a.no_show_orders,
    'terminal_fail_orders', a.terminal_fail_orders,
    'enquiry_orders', a.enquiry_orders,
    'today_orders', a.today_orders,
    'pending_refunds', COALESCE(r.pending_refunds, 0),
    'total_earnings', a.total_earnings,
    'today_earnings', a.today_earnings,
    'week_earnings', a.week_earnings,
    'month_earnings', a.month_earnings,
    'avg_fulfill_minutes', a.avg_fulfill_minutes,
    'cancel_rate_30d', CASE WHEN a.considered_30d > 0
      THEN ROUND((a.cancel_30d::numeric / a.considered_30d) * 100) ELSE 0 END,
    'refund_rate_30d', CASE WHEN a.considered_30d > 0
      THEN ROUND((a.refund_30d::numeric / a.considered_30d) * 100) ELSE 0 END
  )
  INTO v_result
  FROM agg a CROSS JOIN refunds r;

  RETURN COALESCE(v_result, '{}'::jsonb);
END;
$function$;

CREATE OR REPLACE FUNCTION public.get_seller_financial_summary(
  p_seller_ids uuid[]
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path = public, finance, pg_temp
AS $$
DECLARE
  v_result jsonb;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'authentication required';
  END IF;
  IF p_seller_ids IS NULL OR cardinality(p_seller_ids) = 0 THEN
    RAISE EXCEPTION 'seller ids required';
  END IF;
  IF NOT public.is_admin(auth.uid()) AND EXISTS (
    SELECT 1
    FROM unnest(p_seller_ids) requested(id)
    LEFT JOIN public.seller_profiles sp
      ON sp.id = requested.id AND sp.user_id = auth.uid()
    WHERE sp.id IS NULL
  ) THEN
    RAISE EXCEPTION 'seller scope forbidden';
  END IF;

  SELECT jsonb_build_object(
    'pending', COALESCE(sum(s.net_amount) FILTER (
      WHERE s.settlement_status = 'pending'
    ), 0),
    'available', COALESCE(sum(s.net_amount) FILTER (
      WHERE s.settlement_status = 'eligible'
    ), 0),
    'reserved', COALESCE(sum(s.net_amount) FILTER (
      WHERE s.settlement_status = 'processing'
    ), 0),
    'on_hold', COALESCE(sum(s.net_amount) FILTER (
      WHERE s.settlement_status = 'on_hold'
    ), 0),
    'paid_out', COALESCE(sum(s.net_amount) FILTER (
      WHERE s.settlement_status = 'settled'
        AND (
          s.razorpay_transfer_id IS NOT NULL
          OR NULLIF(s.offline_transfer_ref, '') IS NOT NULL
        )
    ), 0),
    'legacy_settled_unverified', COALESCE(sum(s.net_amount) FILTER (
      WHERE s.settlement_status = 'settled'
        AND s.razorpay_transfer_id IS NULL
        AND NULLIF(s.offline_transfer_ref, '') IS NULL
    ), 0),
    'refunded', COALESCE((
      SELECT sum(r.amount)
      FROM public.refund_requests r
      WHERE r.seller_id = ANY(p_seller_ids)
        AND r.refund_state = 'refund_completed'
    ), 0),
    'cod_expected', COALESCE((
      SELECT sum(c.expected_amount_minor)::numeric / 100
      FROM public.cod_transactions c
      WHERE c.seller_id = ANY(p_seller_ids)
        AND c.status IN ('expected', 'not_received', 'disputed')
    ), 0),
    'cod_collected', COALESCE((
      SELECT sum(c.collected_amount_minor)::numeric / 100
      FROM public.cod_transactions c
      WHERE c.seller_id = ANY(p_seller_ids)
        AND c.status IN ('collected', 'confirmed', 'reconciled')
    ), 0),
    'currency', 'INR',
    'as_of', now()
  )
  INTO v_result
  FROM public.seller_settlements s
  WHERE s.seller_id = ANY(p_seller_ids);
  RETURN v_result;
END;
$$;

CREATE OR REPLACE FUNCTION public.get_seller_financial_activity(
  p_seller_ids uuid[],
  p_limit integer DEFAULT 50,
  p_before timestamptz DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path = public, finance, pg_temp
AS $$
DECLARE
  v_result jsonb;
BEGIN
  PERFORM public.get_seller_financial_summary(p_seller_ids);
  WITH activity AS (
    SELECT
      'settlement'::text AS type,
      s.id,
      s.order_id,
      s.seller_id,
      s.net_amount AS amount,
      s.settlement_status AS status,
      COALESCE(s.updated_at, s.created_at) AS event_at,
      jsonb_build_object(
        'provider_transfer_id', COALESCE(s.razorpay_transfer_id, s.offline_transfer_ref),
        'offline_transfer_ref', s.offline_transfer_ref,
        'transfer_method', CASE
          WHEN NULLIF(s.offline_transfer_ref, '') IS NOT NULL THEN COALESCE(s.offline_transfer_method, 'offline')
          WHEN s.razorpay_transfer_id IS NOT NULL THEN 'razorpay'
          ELSE NULL
        END,
        'hold_reason', s.hold_reason
      ) AS metadata
    FROM public.seller_settlements s
    WHERE s.seller_id = ANY(p_seller_ids)
    UNION ALL
    SELECT
      'refund', r.id, r.order_id, r.seller_id,
      -r.amount, r.refund_state, COALESCE(r.updated_at, r.created_at),
      jsonb_build_object(
        'destination', r.refund_destination,
        'gateway_refund_id', r.gateway_refund_id
      )
    FROM public.refund_requests r
    WHERE r.seller_id = ANY(p_seller_ids)
    UNION ALL
    SELECT
      'cod', c.id, c.order_id, c.seller_id,
      COALESCE(c.collected_amount_minor, c.expected_amount_minor)::numeric / 100,
      c.status, c.updated_at,
      jsonb_build_object(
        'collector_type', c.collector_type,
        'not_withdrawable', true
      )
    FROM public.cod_transactions c
    WHERE c.seller_id = ANY(p_seller_ids)
    UNION ALL
    SELECT
      'withdrawal', w.id, NULL, w.seller_id,
      w.amount, w.status, COALESCE(w.updated_at, w.created_at),
      jsonb_build_object(
        'transfer_ref', w.transfer_ref,
        'transfer_method', w.transfer_method,
        'destination_label', w.destination_label
      )
    FROM public.seller_withdrawal_requests w
    WHERE w.seller_id = ANY(p_seller_ids)
  )
  SELECT COALESCE(jsonb_agg(to_jsonb(rows) ORDER BY rows.event_at DESC), '[]'::jsonb)
  INTO v_result
  FROM (
    SELECT *
    FROM activity
    WHERE p_before IS NULL OR event_at < p_before
    ORDER BY event_at DESC
    LIMIT LEAST(GREATEST(p_limit, 1), 100)
  ) rows;
  RETURN v_result;
END;
$$;

CREATE OR REPLACE FUNCTION public.enqueue_seller_settlement_notification()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  _seller_user_id uuid;
  _title text;
  _body text;
  _status text;
  _amount numeric;
  _transfer text;
  _method text;
  _available numeric;
BEGIN
  SELECT user_id INTO _seller_user_id FROM seller_profiles WHERE id = NEW.seller_id;
  IF _seller_user_id IS NULL THEN RETURN NEW; END IF;

  _amount := COALESCE(NEW.net_amount, 0);
  _status := COALESCE(NEW.settlement_status, NEW.status);
  _transfer := NULLIF(COALESCE(NEW.razorpay_transfer_id, NEW.offline_transfer_ref, ''), '');
  _method := CASE
    WHEN NULLIF(NEW.offline_transfer_ref, '') IS NOT NULL THEN COALESCE(NEW.offline_transfer_method, 'Offline UPI/bank')
    WHEN NULLIF(NEW.razorpay_transfer_id, '') IS NOT NULL THEN 'Razorpay'
    ELSE NULL
  END;

  IF TG_OP = 'INSERT' THEN
    _title := 'Settlement pending';
    _body := 'A settlement of ₹' || _amount || ' was created and will become eligible after cooldown.';
    _status := 'settlement_pending';
  ELSIF TG_OP = 'UPDATE'
    AND (
      COALESCE(NEW.settlement_status, NEW.status) IS DISTINCT FROM COALESCE(OLD.settlement_status, OLD.status)
      OR COALESCE(NEW.razorpay_transfer_id, NEW.offline_transfer_ref, '') IS DISTINCT FROM COALESCE(OLD.razorpay_transfer_id, OLD.offline_transfer_ref, '')
    )
  THEN
    IF COALESCE(NEW.settlement_status, NEW.status) IN ('eligible') THEN
      _title := 'Settlement eligible';
      _body := '₹' || _amount || ' is now eligible for payout (not yet transferred).';
      _status := 'settlement_eligible';
    ELSIF COALESCE(NEW.settlement_status, NEW.status) IN ('settled', 'released', 'paid') THEN
      IF _transfer IS NOT NULL THEN
        SELECT COALESCE(SUM(s.net_amount), 0)
        INTO _available
        FROM public.seller_settlements s
        WHERE s.seller_id = NEW.seller_id
          AND s.settlement_status = 'eligible';
        _title := 'Payment transferred';
        _body := '₹' || _amount || ' transferred via ' || COALESCE(_method, 'bank') ||
                 '. Ref: ' || _transfer || '. Available now: ₹' || COALESCE(_available, 0) || '.';
        _status := 'settlement_paid';
      ELSE
        _title := 'Settlement recorded';
        _body := '₹' || _amount || ' marked settled internally — payout transfer pending confirmation.';
        _status := 'settlement_recorded';
      END IF;
    ELSE
      RETURN NEW;
    END IF;
  ELSE
    RETURN NEW;
  END IF;

  INSERT INTO notification_queue (user_id, title, body, type, reference_path, action_url, payload)
  VALUES (
    _seller_user_id,
    _title,
    _body,
    CASE WHEN _status = 'settlement_paid' THEN 'seller_transfer' ELSE 'settlement' END,
    '/seller/wallet',
    '/seller/wallet',
    jsonb_build_object(
      'settlement_id', NEW.id,
      'order_id', NEW.order_id,
      'amount', _amount,
      'status', _status,
      'transfer_id', _transfer,
      'method', _method,
      'available', _available,
      'target_role', 'seller'
    )
  );
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION finance.enforce_payout_release_prerequisites()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = finance, public, pg_temp
AS $$
DECLARE
  v_order public.orders%ROWTYPE;
  v_capture public.payment_captures%ROWTYPE;
  v_destination public.seller_payout_destinations%ROWTYPE;
BEGIN
  IF NEW.settlement_status NOT IN ('eligible', 'processing', 'settled')
     OR NEW.settlement_status IS NOT DISTINCT FROM OLD.settlement_status THEN
    RETURN NEW;
  END IF;

  IF current_setting('app.offline_payout', true) = 'true' THEN
    IF auth.uid() IS NULL OR NOT public.is_admin(auth.uid()) THEN
      RAISE EXCEPTION 'offline payout requires admin';
    END IF;
    IF NULLIF(NEW.offline_transfer_ref, '') IS NULL
       AND NULLIF(NEW.razorpay_transfer_id, '') IS NULL THEN
      RAISE EXCEPTION 'payout blocked: transfer reference required';
    END IF;
    RETURN NEW;
  END IF;

  SELECT * INTO v_order
  FROM public.orders
  WHERE id = NEW.order_id
  FOR UPDATE;
  IF NOT FOUND OR v_order.payment_status IS DISTINCT FROM 'paid' THEN
    RAISE EXCEPTION 'payout blocked: order payment is not paid';
  END IF;
  IF NEW.eligible_at IS NULL OR NEW.eligible_at > now() THEN
    RAISE EXCEPTION 'payout blocked: settlement cooling period not complete';
  END IF;
  IF lower(COALESCE(v_order.payment_type, '')) IN (
    'cod', 'cash', 'cash_on_delivery'
  ) THEN
    RAISE EXCEPTION 'payout blocked: COD is not platform-held online tender';
  END IF;

  SELECT c.* INTO v_capture
  FROM public.payment_capture_allocations a
  JOIN public.payment_captures c ON c.id = a.capture_id
  WHERE a.order_id = NEW.order_id
    AND c.status = 'captured'
    AND a.amount_minor = round(COALESCE(v_order.total_amount, 0) * 100)::bigint
  FOR UPDATE OF c;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'payout blocked: complete captured allocation required';
  END IF;
  IF NOT EXISTS (
    SELECT 1
    FROM finance.capture_allocation_variances v
    WHERE v.capture_id = v_capture.id
      AND v.difference_minor = 0
  ) THEN
    RAISE EXCEPTION 'payout blocked: capture allocation variance';
  END IF;
  IF NOT EXISTS (
    SELECT 1
    FROM public.financial_reconciliation_records r
    WHERE r.provider = v_capture.provider
      AND r.reference_type = 'payment_capture'
      AND r.reference_id = v_capture.provider_payment_id
      AND r.status = 'matched'
      AND r.difference_minor = 0
  ) THEN
    RAISE EXCEPTION 'payout blocked: clean internal allocation reconciliation required';
  END IF;
  IF NOT EXISTS (
    SELECT 1
    FROM public.financial_reconciliation_records r
    WHERE r.provider = v_capture.provider
      AND r.reference_type = 'provider_payment'
      AND r.reference_id = v_capture.provider_payment_id
      AND r.status = 'matched'
      AND r.difference_minor = 0
      AND NULLIF(r.metadata->>'provider_statement_row_id', '') IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'payout blocked: exact external provider statement required';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM public.refund_requests r
    WHERE r.order_id = NEW.order_id
      AND r.refund_state IN (
        'approved', 'refund_initiated', 'refund_processing',
        'needs_manual_review'
      )
  ) THEN
    RAISE EXCEPTION 'payout blocked: refund conflict';
  END IF;

  SELECT * INTO v_destination
  FROM public.seller_payout_destinations
  WHERE seller_id = NEW.seller_id
    AND provider = 'razorpay_route'
    AND verification_status = 'verified'
    AND active
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'payout blocked: verified destination required';
  END IF;
  IF v_destination.cooling_until IS NOT NULL
     AND v_destination.cooling_until > now() THEN
    RAISE EXCEPTION 'payout blocked: destination cooling period';
  END IF;
  IF NOT COALESCE((
    SELECT enabled FROM public.financial_feature_flags
    WHERE key = 'seller_payout_enabled'
  ), false) OR COALESCE((
    SELECT value FROM public.financial_configuration
    WHERE key = 'provider_payout_mode'
  ), 'disabled') <> 'razorpay_route_deferred' THEN
    RAISE EXCEPTION 'payout blocked: money movement gate disabled';
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.get_seller_payout_readiness()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'authentication required';
  END IF;
  RETURN jsonb_build_object(
    'seller_payout_enabled', COALESCE((
      SELECT enabled FROM public.financial_feature_flags WHERE key = 'seller_payout_enabled'
    ), false),
    'provider_payout_mode', COALESCE((
      SELECT value FROM public.financial_configuration WHERE key = 'provider_payout_mode'
    ), 'disabled')
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.list_seller_withdrawal_requests(p_seller_ids uuid[])
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
BEGIN
  PERFORM public.get_seller_financial_summary(p_seller_ids);
  RETURN COALESCE((
    SELECT jsonb_agg(to_jsonb(w) ORDER BY w.created_at DESC)
    FROM public.seller_withdrawal_requests w
    WHERE w.seller_id = ANY(p_seller_ids)
  ), '[]'::jsonb);
END;
$$;

CREATE OR REPLACE FUNCTION public.request_seller_withdrawal(
  p_seller_id uuid,
  p_amount numeric,
  p_destination_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_ready jsonb;
  v_summary jsonb;
  v_available numeric;
  v_id uuid;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'authentication required';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.seller_profiles sp
    WHERE sp.id = p_seller_id AND sp.user_id = auth.uid()
  ) THEN
    RAISE EXCEPTION 'seller scope forbidden';
  END IF;
  v_ready := public.get_seller_payout_readiness();
  IF COALESCE((v_ready->>'seller_payout_enabled')::boolean, false) IS NOT TRUE
     OR COALESCE(v_ready->>'provider_payout_mode', '') <> 'razorpay_route_deferred' THEN
    RAISE EXCEPTION 'withdrawals are not enabled yet';
  END IF;
  IF COALESCE(p_amount, 0) <= 0 THEN
    RAISE EXCEPTION 'amount must be greater than zero';
  END IF;
  v_summary := public.get_seller_financial_summary(ARRAY[p_seller_id]);
  v_available := COALESCE((v_summary->>'available')::numeric, 0);
  IF p_amount > v_available THEN
    RAISE EXCEPTION 'amount exceeds available online earnings';
  END IF;

  INSERT INTO public.seller_withdrawal_requests (
    seller_id, requested_by, amount, available_snapshot, destination_id, status
  ) VALUES (
    p_seller_id, auth.uid(), ROUND(p_amount, 2), v_available, p_destination_id, 'requested'
  )
  RETURNING id INTO v_id;

  RETURN jsonb_build_object('id', v_id, 'status', 'requested', 'available', v_available);
END;
$$;

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
        r.id, r.order_id, r.seller_id, r.amount, r.refund_state, r.status,
        r.refund_destination, r.created_at,
        o.total_amount AS order_total,
        o.amount_refunded AS order_amount_refunded,
        sp.business_name AS seller_name
      FROM public.refund_requests r
      LEFT JOIN public.orders o ON o.id = r.order_id
      LEFT JOIN public.seller_profiles sp ON sp.id = r.seller_id
      ORDER BY r.created_at DESC
      LIMIT LEAST(GREATEST(p_limit, 1), 200)
    ) rows
  ), '[]'::jsonb);
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_list_seller_withdrawals(p_limit integer DEFAULT 80)
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
      SELECT w.*, sp.business_name AS seller_name
      FROM public.seller_withdrawal_requests w
      LEFT JOIN public.seller_profiles sp ON sp.id = w.seller_id
      ORDER BY w.created_at DESC
      LIMIT LEAST(GREATEST(p_limit, 1), 200)
    ) rows
  ), '[]'::jsonb);
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_list_eligible_settlements(p_seller_id uuid)
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
    SELECT jsonb_agg(to_jsonb(s) ORDER BY COALESCE(s.eligible_at, s.created_at))
    FROM public.seller_settlements s
    WHERE s.seller_id = p_seller_id
      AND s.settlement_status = 'eligible'
  ), '[]'::jsonb);
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_record_offline_seller_transfer(
  p_seller_id uuid,
  p_amount numeric,
  p_destination text,
  p_transfer_ref text,
  p_transferred_at timestamptz DEFAULT now(),
  p_admin_notes text DEFAULT NULL,
  p_withdrawal_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_remaining numeric;
  v_row public.seller_settlements%ROWTYPE;
  v_marked int := 0;
  v_withdrawal uuid;
  v_available numeric;
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_admin(auth.uid()) THEN
    RAISE EXCEPTION 'admin required';
  END IF;
  IF COALESCE(p_amount, 0) <= 0 THEN
    RAISE EXCEPTION 'amount must be greater than zero';
  END IF;
  IF NULLIF(btrim(p_destination), '') IS NULL THEN
    RAISE EXCEPTION 'destination is required';
  END IF;
  IF NULLIF(btrim(p_transfer_ref), '') IS NULL THEN
    RAISE EXCEPTION 'UTR / transfer reference is required';
  END IF;
  IF NULLIF(btrim(p_admin_notes), '') IS NULL THEN
    RAISE EXCEPTION 'admin notes are required';
  END IF;

  PERFORM set_config('app.offline_payout', 'true', true);
  v_remaining := ROUND(p_amount, 2);

  FOR v_row IN
    SELECT *
    FROM public.seller_settlements
    WHERE seller_id = p_seller_id
      AND settlement_status = 'eligible'
    ORDER BY COALESCE(eligible_at, created_at), created_at
    FOR UPDATE
  LOOP
    EXIT WHEN v_remaining <= 0.009;
    IF ROUND(COALESCE(v_row.net_amount, 0), 2) <= v_remaining + 0.009 THEN
      UPDATE public.seller_settlements
      SET settlement_status = 'settled',
          offline_transfer_ref = btrim(p_transfer_ref),
          offline_transfer_method = 'offline_upi_bank',
          offline_transferred_at = COALESCE(p_transferred_at, now()),
          offline_transferred_by = auth.uid(),
          settled_at = COALESCE(p_transferred_at, now()),
          updated_at = now()
      WHERE id = v_row.id;
      v_remaining := ROUND(v_remaining - COALESCE(v_row.net_amount, 0), 2);
      v_marked := v_marked + 1;
    ELSE
      RAISE EXCEPTION 'amount does not match whole eligible settlements';
    END IF;
  END LOOP;

  IF v_remaining > 0.009 THEN
    RAISE EXCEPTION 'insufficient eligible settlements for this amount';
  END IF;

  IF p_withdrawal_id IS NOT NULL THEN
    UPDATE public.seller_withdrawal_requests
    SET status = 'transferred',
        transfer_method = 'offline_upi_bank',
        transfer_ref = btrim(p_transfer_ref),
        destination_label = btrim(p_destination),
        transferred_at = COALESCE(p_transferred_at, now()),
        transferred_by = auth.uid(),
        admin_notes = p_admin_notes,
        updated_at = now()
    WHERE id = p_withdrawal_id
      AND seller_id = p_seller_id
    RETURNING id INTO v_withdrawal;
  END IF;

  IF v_withdrawal IS NULL THEN
    INSERT INTO public.seller_withdrawal_requests (
      seller_id, requested_by, amount, available_snapshot, destination_label,
      status, transfer_method, transfer_ref, transferred_at, transferred_by, admin_notes
    ) VALUES (
      p_seller_id, auth.uid(), ROUND(p_amount, 2), 0, btrim(p_destination),
      'transferred', 'offline_upi_bank', btrim(p_transfer_ref),
      COALESCE(p_transferred_at, now()), auth.uid(), p_admin_notes
    )
    RETURNING id INTO v_withdrawal;
  END IF;

  SELECT COALESCE((public.get_seller_financial_summary(ARRAY[p_seller_id])->>'available')::numeric, 0)
  INTO v_available;

  INSERT INTO public.notification_queue (user_id, title, body, type, reference_path, action_url, payload)
  SELECT
    sp.user_id,
    'Payment transferred',
    '₹' || ROUND(p_amount, 2) || ' transferred via Offline UPI/bank. Ref: ' ||
      btrim(p_transfer_ref) || '. Available now: ₹' || COALESCE(v_available, 0) || '.',
    'seller_transfer',
    '/seller/wallet',
    '/seller/wallet',
    jsonb_build_object(
      'withdrawal_id', v_withdrawal,
      'amount', ROUND(p_amount, 2),
      'method', 'offline_upi_bank',
      'transfer_id', btrim(p_transfer_ref),
      'available', v_available,
      'target_role', 'seller'
    )
  FROM public.seller_profiles sp
  WHERE sp.id = p_seller_id;

  RETURN jsonb_build_object(
    'withdrawal_id', v_withdrawal,
    'settlements_marked', v_marked,
    'available', v_available
  );
END;
$$;

REVOKE ALL ON FUNCTION public.get_seller_payout_readiness() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.list_seller_withdrawal_requests(uuid[]) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.request_seller_withdrawal(uuid, numeric, uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.admin_list_seller_refunds(integer) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.admin_list_seller_withdrawals(integer) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.admin_list_eligible_settlements(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.admin_record_offline_seller_transfer(uuid, numeric, text, text, timestamptz, text, uuid) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.get_seller_payout_readiness() TO authenticated;
GRANT EXECUTE ON FUNCTION public.list_seller_withdrawal_requests(uuid[]) TO authenticated;
GRANT EXECUTE ON FUNCTION public.request_seller_withdrawal(uuid, numeric, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_list_seller_refunds(integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_list_seller_withdrawals(integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_list_eligible_settlements(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_record_offline_seller_transfer(uuid, numeric, text, text, timestamptz, text, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_seller_financial_summary(uuid[]) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_seller_financial_activity(uuid[], integer, timestamptz) TO authenticated;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'seller_withdrawal_requests'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.seller_withdrawal_requests;
  END IF;
END $$;
