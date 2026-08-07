-- Phase 2: status-gate hot order triggers, portfolio aggregate RPCs, more RLS initplan.

-- ═══════════════════════════════════════════════════════════════════════════
-- 1. Status-gate ANY-UPDATE triggers that only care about status changes
-- ═══════════════════════════════════════════════════════════════════════════

DROP TRIGGER IF EXISTS trg_audit_order_status ON public.orders;
CREATE TRIGGER trg_audit_order_status
  AFTER UPDATE ON public.orders
  FOR EACH ROW
  WHEN (OLD.status IS DISTINCT FROM NEW.status)
  EXECUTE FUNCTION trg_audit_order_status();

DROP TRIGGER IF EXISTS trg_auto_assign_delivery ON public.orders;
CREATE TRIGGER trg_auto_assign_delivery
  AFTER UPDATE ON public.orders
  FOR EACH ROW
  WHEN (OLD.status IS DISTINCT FROM NEW.status)
  EXECUTE FUNCTION trg_auto_assign_delivery();

DROP TRIGGER IF EXISTS trg_auto_refund_on_seller_cancel ON public.orders;
CREATE TRIGGER trg_auto_refund_on_seller_cancel
  BEFORE UPDATE ON public.orders
  FOR EACH ROW
  WHEN (OLD.status IS DISTINCT FROM NEW.status)
  EXECUTE FUNCTION fn_auto_refund_on_seller_cancel();

DROP TRIGGER IF EXISTS trg_compute_delivery_eta ON public.orders;
CREATE TRIGGER trg_compute_delivery_eta
  BEFORE UPDATE ON public.orders
  FOR EACH ROW
  WHEN (OLD.status IS DISTINCT FROM NEW.status)
  EXECUTE FUNCTION trg_compute_delivery_eta();

DROP TRIGGER IF EXISTS trg_create_seller_delivery_assignment ON public.orders;
CREATE TRIGGER trg_create_seller_delivery_assignment
  AFTER UPDATE ON public.orders
  FOR EACH ROW
  WHEN (OLD.status IS DISTINCT FROM NEW.status)
  EXECUTE FUNCTION trg_create_seller_delivery_assignment();

DROP TRIGGER IF EXISTS trg_enqueue_review_prompt ON public.orders;
CREATE TRIGGER trg_enqueue_review_prompt
  AFTER UPDATE ON public.orders
  FOR EACH ROW
  WHEN (OLD.status IS DISTINCT FROM NEW.status)
  EXECUTE FUNCTION fn_enqueue_review_prompt();

DROP TRIGGER IF EXISTS trg_generate_delivery_code ON public.orders;
CREATE TRIGGER trg_generate_delivery_code
  AFTER UPDATE ON public.orders
  FOR EACH ROW
  WHEN (OLD.status IS DISTINCT FROM NEW.status)
  EXECUTE FUNCTION generate_delivery_code();

DROP TRIGGER IF EXISTS trg_log_reputation_on_order ON public.orders;
CREATE TRIGGER trg_log_reputation_on_order
  AFTER UPDATE ON public.orders
  FOR EACH ROW
  WHEN (OLD.status IS DISTINCT FROM NEW.status)
  EXECUTE FUNCTION log_reputation_on_order();

DROP TRIGGER IF EXISTS trg_order_status_seller_stats ON public.orders;
CREATE TRIGGER trg_order_status_seller_stats
  AFTER UPDATE ON public.orders
  FOR EACH ROW
  WHEN (OLD.status IS DISTINCT FROM NEW.status)
  EXECUTE FUNCTION trg_update_seller_stats_on_order();

DROP TRIGGER IF EXISTS trg_set_order_ready_at ON public.orders;
CREATE TRIGGER trg_set_order_ready_at
  BEFORE UPDATE ON public.orders
  FOR EACH ROW
  WHEN (OLD.status IS DISTINCT FROM NEW.status)
  EXECUTE FUNCTION set_order_ready_at();

DROP TRIGGER IF EXISTS trg_sync_booking_status ON public.orders;
CREATE TRIGGER trg_sync_booking_status
  AFTER UPDATE ON public.orders
  FOR EACH ROW
  WHEN (OLD.status IS DISTINCT FROM NEW.status)
  EXECUTE FUNCTION sync_booking_status_on_order_update();

DROP TRIGGER IF EXISTS trg_sync_order_to_delivery_assignment ON public.orders;
CREATE TRIGGER trg_sync_order_to_delivery_assignment
  AFTER UPDATE ON public.orders
  FOR EACH ROW
  WHEN (OLD.status IS DISTINCT FROM NEW.status)
  EXECUTE FUNCTION sync_order_to_delivery_assignment();

-- log_order_activity: keep INSERT always; gate UPDATE half via replace
DROP TRIGGER IF EXISTS trg_log_order_activity ON public.orders;
CREATE TRIGGER trg_log_order_activity_ins
  AFTER INSERT ON public.orders
  FOR EACH ROW
  EXECUTE FUNCTION log_order_activity();
CREATE TRIGGER trg_log_order_activity_upd
  AFTER UPDATE ON public.orders
  FOR EACH ROW
  WHEN (OLD.status IS DISTINCT FROM NEW.status)
  EXECUTE FUNCTION log_order_activity();

-- Payment record: gate on payment_status change (not every column touch)
DROP TRIGGER IF EXISTS trg_populate_payment_record ON public.orders;
CREATE TRIGGER trg_populate_payment_record
  AFTER UPDATE ON public.orders
  FOR EACH ROW
  WHEN (OLD.payment_status IS DISTINCT FROM NEW.payment_status)
  EXECUTE FUNCTION fn_populate_payment_record();

-- Add WHEN to UPDATE OF status triggers that lacked it
DROP TRIGGER IF EXISTS trg_earn_loyalty_on_delivery ON public.orders;
CREATE TRIGGER trg_earn_loyalty_on_delivery
  AFTER UPDATE OF status ON public.orders
  FOR EACH ROW
  WHEN (OLD.status IS DISTINCT FROM NEW.status)
  EXECUTE FUNCTION fn_earn_loyalty_on_delivery();

DROP TRIGGER IF EXISTS trg_loyalty_on_order_cancelled ON public.orders;
CREATE TRIGGER trg_loyalty_on_order_cancelled
  AFTER UPDATE OF status ON public.orders
  FOR EACH ROW
  WHEN (OLD.status IS DISTINCT FROM NEW.status)
  EXECUTE FUNCTION fn_loyalty_on_order_cancelled();

DROP TRIGGER IF EXISTS trg_restore_stock_on_order_cancel ON public.orders;
CREATE TRIGGER trg_restore_stock_on_order_cancel
  AFTER UPDATE OF status ON public.orders
  FOR EACH ROW
  WHEN (OLD.status IS DISTINCT FROM NEW.status)
  EXECUTE FUNCTION restore_stock_on_order_cancel();

DROP TRIGGER IF EXISTS trg_update_reliability_on_order ON public.orders;
CREATE TRIGGER trg_update_reliability_on_order
  AFTER UPDATE OF status ON public.orders
  FOR EACH ROW
  WHEN (OLD.status IS DISTINCT FROM NEW.status)
  EXECUTE FUNCTION fn_update_reliability_on_order_change();

DROP TRIGGER IF EXISTS trg_wallet_on_order_cancelled ON public.orders;
CREATE TRIGGER trg_wallet_on_order_cancelled
  AFTER UPDATE OF status ON public.orders
  FOR EACH ROW
  WHEN (OLD.status IS DISTINCT FROM NEW.status)
  EXECUTE FUNCTION fn_wallet_on_order_cancelled();

DROP TRIGGER IF EXISTS trg_recompute_seller_stats ON public.orders;
CREATE TRIGGER trg_recompute_seller_stats
  AFTER UPDATE OF status ON public.orders
  FOR EACH ROW
  WHEN (OLD.status IS DISTINCT FROM NEW.status)
  EXECUTE FUNCTION trigger_recompute_seller_stats();

DROP TRIGGER IF EXISTS trg_create_review_prompt ON public.orders;
CREATE TRIGGER trg_create_review_prompt
  AFTER UPDATE OF status ON public.orders
  FOR EACH ROW
  WHEN (OLD.status IS DISTINCT FROM NEW.status)
  EXECUTE FUNCTION fn_create_review_prompt();

DROP TRIGGER IF EXISTS trg_mark_order_notifications_read_on_terminal ON public.orders;
CREATE TRIGGER trg_mark_order_notifications_read_on_terminal
  AFTER UPDATE OF status ON public.orders
  FOR EACH ROW
  WHEN (OLD.status IS DISTINCT FROM NEW.status)
  EXECUTE FUNCTION fn_mark_order_notifications_read_on_terminal();

DROP TRIGGER IF EXISTS trg_auto_dismiss_delivery_notifications ON public.orders;
CREATE TRIGGER trg_auto_dismiss_delivery_notifications
  AFTER UPDATE OF status ON public.orders
  FOR EACH ROW
  WHEN (OLD.status IS DISTINCT FROM NEW.status)
  EXECUTE FUNCTION auto_dismiss_delivery_notifications();

-- ═══════════════════════════════════════════════════════════════════════════
-- 2. Portfolio aggregate RPCs (1 call instead of N)
-- ═══════════════════════════════════════════════════════════════════════════

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
        AND COALESCE(o.payment_status, '') IS DISTINCT FROM 'refunded'
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
      COALESCE(SUM(total_amount) FILTER (WHERE is_settled), 0) AS total_earnings,
      COALESCE(SUM(total_amount) FILTER (WHERE is_settled AND created_at >= v_today_start), 0) AS today_earnings,
      COALESCE(SUM(total_amount) FILTER (WHERE is_settled AND created_at >= v_week_start), 0) AS week_earnings,
      COALESCE(SUM(total_amount) FILTER (WHERE is_settled AND created_at >= v_month_start), 0) AS month_earnings,
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

CREATE OR REPLACE FUNCTION public.get_seller_portfolio_board_counts(p_seller_ids uuid[])
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

  WITH visible AS (
    SELECT
      o.id,
      o.status::text AS status,
      o.payment_status,
      o.created_at,
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
      (
        o.payment_status = 'refunded'
        OR EXISTS (
          SELECT 1 FROM public.refund_requests rr
          WHERE rr.order_id = o.id
            AND rr.status IN ('requested','approved','settled','processing','auto_approved','completed')
        )
      ) AS is_refunded
    FROM public.orders o
    WHERE o.seller_id = ANY (v_ids)
  )
  SELECT jsonb_build_object(
    'all', COUNT(*) FILTER (WHERE bucket <> 'hidden'),
    'today', COUNT(*) FILTER (WHERE bucket <> 'hidden' AND created_at >= v_today_start),
    'enquiries', COUNT(*) FILTER (WHERE bucket = 'enquiries'),
    'pending', COUNT(*) FILTER (WHERE bucket = 'action_needed'),
    'preparing', COUNT(*) FILTER (WHERE bucket = 'preparing'),
    'ready', COUNT(*) FILTER (WHERE bucket = 'ready'),
    'in_transit', COUNT(*) FILTER (WHERE bucket = 'in_transit'),
    'cod_confirm', COUNT(*) FILTER (WHERE bucket = 'cod_confirm'),
    'completed', COUNT(*) FILTER (WHERE bucket = 'done'),
    'cancelled', COUNT(*) FILTER (WHERE bucket = 'cancelled'),
    'refunded', COUNT(*) FILTER (WHERE is_refunded AND bucket <> 'hidden'),
    'no_show', COUNT(*) FILTER (WHERE bucket = 'no_show'),
    'terminal_fail', COUNT(*) FILTER (WHERE bucket = 'terminal_fail')
  )
  INTO v_result
  FROM visible;

  RETURN COALESCE(v_result, '{}'::jsonb);
END;
$function$;

REVOKE ALL ON FUNCTION public.get_seller_portfolio_kpis(uuid[]) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_seller_portfolio_board_counts(uuid[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_seller_portfolio_kpis(uuid[]) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_seller_portfolio_board_counts(uuid[]) TO authenticated, service_role;

-- 3. Safe hot-path RLS initplan wraps (exact live policy names)

DROP POLICY IF EXISTS "Users can view their own cart" ON public.cart_items;
CREATE POLICY "Users can view their own cart"
  ON public.cart_items FOR SELECT TO authenticated
  USING (user_id = (select auth.uid()));

DROP POLICY IF EXISTS "Users can update their own cart" ON public.cart_items;
CREATE POLICY "Users can update their own cart"
  ON public.cart_items FOR UPDATE TO authenticated
  USING (user_id = (select auth.uid()));

DROP POLICY IF EXISTS "Users can delete from their own cart" ON public.cart_items;
CREATE POLICY "Users can delete from their own cart"
  ON public.cart_items FOR DELETE TO authenticated
  USING (user_id = (select auth.uid()));

DROP POLICY IF EXISTS "Users can manage their own cart" ON public.cart_items;
CREATE POLICY "Users can manage their own cart"
  ON public.cart_items FOR INSERT TO authenticated
  WITH CHECK (user_id = (select auth.uid()));

DROP POLICY IF EXISTS "Users can update their own profile" ON public.profiles;
CREATE POLICY "Users can update their own profile"
  ON public.profiles FOR UPDATE TO authenticated
  USING ((id = (select auth.uid())) OR public.is_admin((select auth.uid())));

DROP POLICY IF EXISTS "Users can view all approved profiles" ON public.profiles;
CREATE POLICY "Users can view all approved profiles"
  ON public.profiles FOR SELECT TO authenticated
  USING (
    (verification_status = 'approved'::text)
    OR (id = (select auth.uid()))
    OR public.is_admin((select auth.uid()))
  );
