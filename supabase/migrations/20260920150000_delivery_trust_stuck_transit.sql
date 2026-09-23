-- Delivery trust: dismiss review prompts, transit escalation, admin force-resolve, SLA transitions

-- 1) Buyer can dismiss review prompts even when no row existed yet (fallback banner path)
CREATE OR REPLACE FUNCTION public.dismiss_review_prompt_for_order(_order_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_buyer uuid := auth.uid();
  v_seller uuid;
  v_seller_name text;
BEGIN
  IF v_buyer IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  SELECT o.seller_id, sp.business_name
  INTO v_seller, v_seller_name
  FROM public.orders o
  LEFT JOIN public.seller_profiles sp ON sp.id = o.seller_id
  WHERE o.id = _order_id AND o.buyer_id = v_buyer;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Order not found';
  END IF;

  INSERT INTO public.review_prompts (order_id, buyer_id, seller_id, seller_name, prompt_at, status)
  VALUES (_order_id, v_buyer, v_seller, v_seller_name, now(), 'dismissed')
  ON CONFLICT (order_id, buyer_id) DO UPDATE
    SET status = 'dismissed',
        updated_at = now();
END;
$$;

GRANT EXECUTE ON FUNCTION public.dismiss_review_prompt_for_order(uuid) TO authenticated;

-- 2) Allow seller/system to leave stuck transit via no_show / cancelled
INSERT INTO public.category_status_transitions (
  parent_group, transaction_type, from_status, to_status, allowed_actor, is_side_action, display_label
)
SELECT *
FROM (VALUES
  ('default', 'seller_delivery', 'on_the_way', 'no_show', 'seller', true, 'Could not deliver'),
  ('default', 'seller_delivery', 'on_the_way', 'no_show', 'system', false, 'Auto no-show'),
  ('default', 'seller_delivery', 'on_the_way', 'cancelled', 'system', false, 'Auto cancel stuck transit'),
  ('default', 'seller_delivery', 'picked_up', 'no_show', 'seller', true, 'Could not deliver'),
  ('default', 'seller_delivery', 'picked_up', 'no_show', 'system', false, 'Auto no-show'),
  ('default', 'seller_delivery', 'at_gate', 'no_show', 'seller', true, 'Could not deliver'),
  ('default', 'seller_delivery', 'at_gate', 'no_show', 'system', false, 'Auto no-show'),
  ('food_beverages', 'seller_delivery', 'on_the_way', 'no_show', 'seller', true, 'Could not deliver'),
  ('food_beverages', 'seller_delivery', 'on_the_way', 'no_show', 'system', false, 'Auto no-show'),
  ('food_beverages', 'seller_delivery', 'on_the_way', 'cancelled', 'system', false, 'Auto cancel stuck transit'),
  ('food_beverages', 'seller_delivery', 'picked_up', 'no_show', 'seller', true, 'Could not deliver'),
  ('food_beverages', 'seller_delivery', 'picked_up', 'no_show', 'system', false, 'Auto no-show'),
  ('food_beverages', 'seller_delivery', 'at_gate', 'no_show', 'seller', true, 'Could not deliver'),
  ('food_beverages', 'seller_delivery', 'at_gate', 'no_show', 'system', false, 'Auto no-show')
) AS v(parent_group, transaction_type, from_status, to_status, allowed_actor, is_side_action, display_label)
WHERE NOT EXISTS (
  SELECT 1 FROM public.category_status_transitions t
  WHERE t.parent_group = v.parent_group
    AND t.transaction_type = v.transaction_type
    AND t.from_status = v.from_status
    AND t.to_status = v.to_status
    AND t.allowed_actor = v.allowed_actor
);

INSERT INTO public.category_status_flows (
  parent_group, transaction_type, status_key, sort_order, is_terminal, is_success, actor, display_label
)
SELECT *
FROM (VALUES
  ('default', 'seller_delivery', 'no_show', 95, true, false, 'seller', 'Could not deliver'),
  ('food_beverages', 'seller_delivery', 'no_show', 95, true, false, 'seller', 'Could not deliver')
) AS v(parent_group, transaction_type, status_key, sort_order, is_terminal, is_success, actor, display_label)
WHERE NOT EXISTS (
  SELECT 1 FROM public.category_status_flows f
  WHERE f.parent_group = v.parent_group
    AND f.transaction_type = v.transaction_type
    AND f.status_key = v.status_key
);

-- 3) Transit stuck notification templates + rules
INSERT INTO public.notification_templates (key, channel, title_template, body_template, description, active)
VALUES
  ('order_on_the_way_seller_l1', 'push', 'Delivery still open', 'Order #{order_number} has been on the way for a while - confirm delivery with OTP or report an issue.', 'Transit soft nudge', true),
  ('order_on_the_way_seller_l2', 'push', 'Overdue delivery', 'Order #{order_number} is overdue. Confirm delivery or mark could not deliver.', 'Transit warning', true),
  ('order_on_the_way_seller_l3', 'push', 'Urgent: stuck delivery', 'Order #{order_number} has been in transit too long. Resolve now.', 'Transit urgent', true),
  ('order_on_the_way_buyer_l1', 'push', 'Your order is delayed', 'Your order from {seller_name} is taking longer than expected. We are following up.', 'Buyer reassure', true),
  ('order_on_the_way_buyer_l2', 'push', 'Need help with your order?', 'Your order still has not been confirmed delivered. Tap for help or a refund request.', 'Buyer escape', true),
  ('order_picked_up_seller_l1', 'push', 'Update delivery status', 'Order #{order_number} is picked up - mark on the way when you leave.', 'Picked up stall', true),
  ('order_at_gate_seller_l1', 'push', 'Complete delivery', 'Order #{order_number} is at the gate - enter the buyer OTP to finish.', 'At gate stall', true)
ON CONFLICT (key) DO NOTHING;

INSERT INTO public.notification_rules
  (key, entity_type, trigger_status, delay_seconds, repeat_interval_seconds, max_repeats, escalation_level, target_actor, template_key, priority, payload_extra, description, active)
VALUES
  ('order_on_the_way_seller_l1', 'order', 'on_the_way', 2700, NULL, 0, 1, 'seller', 'order_on_the_way_seller_l1', 6,
   '{"type":"order_lifecycle","action":"Confirm delivery"}'::jsonb, 'Soft nudge after 45m in transit', true),
  ('order_on_the_way_seller_l2', 'order', 'on_the_way', 7200, NULL, 0, 2, 'seller', 'order_on_the_way_seller_l2', 8,
   '{"type":"order_lifecycle","action":"Confirm or report issue"}'::jsonb, 'Warning at 2h in transit', true),
  ('order_on_the_way_seller_l3', 'order', 'on_the_way', 21600, NULL, 0, 3, 'seller', 'order_on_the_way_seller_l3', 10,
   '{"type":"order_lifecycle","action":"Resolve overdue delivery"}'::jsonb, 'Urgent at 6h in transit', true),
  ('order_on_the_way_buyer_l1', 'order', 'on_the_way', 3600, NULL, 0, 1, 'buyer', 'order_on_the_way_buyer_l1', 5,
   '{"type":"order_lifecycle"}'::jsonb, 'Buyer delay reassure at 1h', true),
  ('order_on_the_way_buyer_l2', 'order', 'on_the_way', 21600, NULL, 0, 2, 'buyer', 'order_on_the_way_buyer_l2', 7,
   '{"type":"order_lifecycle","action":"Get help"}'::jsonb, 'Buyer escape hatch at 6h', true),
  ('order_picked_up_seller_l1', 'order', 'picked_up', 3600, NULL, 0, 1, 'seller', 'order_picked_up_seller_l1', 6,
   '{"type":"order_lifecycle","action":"Mark on the way"}'::jsonb, 'Picked up with no progress 1h', true),
  ('order_at_gate_seller_l1', 'order', 'at_gate', 1800, NULL, 0, 1, 'seller', 'order_at_gate_seller_l1', 7,
   '{"type":"order_lifecycle","action":"Complete with OTP"}'::jsonb, 'At gate without completion 30m', true)
ON CONFLICT (key) DO NOTHING;

-- 4) Late-delivery support: stop auto-apologizing away
UPDATE public.auto_resolution_rules
SET action_json = '{"type":"create_ticket","category":"late_delivery"}'::jsonb
WHERE issue_type = 'late_delivery'
  AND (action_json->>'type') = 'apology';

INSERT INTO public.auto_resolution_rules (issue_type, condition_json, action_json, priority, is_active)
SELECT 'late_delivery',
       '{"order_status_in":["picked_up","on_the_way","at_gate"],"eta_breached_minutes":360}'::jsonb,
       '{"type":"create_ticket","category":"late_delivery","priority":"high"}'::jsonb,
       20,
       true
WHERE NOT EXISTS (
  SELECT 1 FROM public.auto_resolution_rules
  WHERE issue_type = 'late_delivery'
    AND condition_json::text LIKE '%on_the_way%'
    AND (action_json->>'type') = 'create_ticket'
);

-- 5) Admin force-complete / force-fail delivery (OTP bypass with audit)
CREATE OR REPLACE FUNCTION public.admin_force_complete_delivery(
  _order_id uuid,
  _reason text DEFAULT 'admin_force_complete'
)
RETURNS order_status
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_status order_status;
  v_assignment_id uuid;
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_admin(auth.uid()) THEN
    RAISE EXCEPTION 'Admin only';
  END IF;

  PERFORM set_config('app.otp_verified', 'true', true);
  PERFORM set_config('app.acting_as', 'admin', true);

  UPDATE public.orders
  SET status = 'delivered',
      delivered_at = COALESCE(delivered_at, now()),
      needs_attention = false,
      needs_attention_reason = null,
      updated_at = now()
  WHERE id = _order_id
  RETURNING status INTO v_status;

  IF v_status IS NULL THEN
    RAISE EXCEPTION 'Order not found';
  END IF;

  UPDATE public.delivery_assignments
  SET status = 'delivered',
      otp_verified = true,
      delivered_at = COALESCE(delivered_at, now()),
      updated_at = now()
  WHERE order_id = _order_id
  RETURNING id INTO v_assignment_id;

  INSERT INTO public.audit_log (action, target_type, target_id, actor_id, metadata)
  VALUES (
    'admin_force_complete_delivery',
    'order',
    _order_id,
    auth.uid(),
    jsonb_build_object('reason', COALESCE(_reason, 'admin_force_complete'), 'assignment_id', v_assignment_id)
  );

  RETURN v_status;
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_force_fail_delivery(
  _order_id uuid,
  _reason text DEFAULT 'admin_force_fail',
  _target_status text DEFAULT 'no_show'
)
RETURNS order_status
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_status order_status;
  v_target text := COALESCE(NULLIF(btrim(_target_status), ''), 'no_show');
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_admin(auth.uid()) THEN
    RAISE EXCEPTION 'Admin only';
  END IF;

  IF v_target NOT IN ('no_show', 'cancelled', 'failed', 'returned') THEN
    RAISE EXCEPTION 'Invalid target status %', v_target;
  END IF;

  PERFORM set_config('app.otp_verified', 'true', true);
  PERFORM set_config('app.acting_as', 'system', true);

  UPDATE public.orders
  SET status = v_target::order_status,
      needs_attention = false,
      needs_attention_reason = null,
      failure_owner = COALESCE(failure_owner, 'seller'),
      rejection_reason = COALESCE(rejection_reason, _reason),
      updated_at = now()
  WHERE id = _order_id
  RETURNING status INTO v_status;

  IF v_status IS NULL THEN
    RAISE EXCEPTION 'Order not found';
  END IF;

  UPDATE public.delivery_assignments
  SET status = 'cancelled',
      updated_at = now()
  WHERE order_id = _order_id
    AND status IS DISTINCT FROM 'delivered';

  INSERT INTO public.audit_log (action, target_type, target_id, actor_id, metadata)
  VALUES (
    'admin_force_fail_delivery',
    'order',
    _order_id,
    auth.uid(),
    jsonb_build_object('reason', COALESCE(_reason, 'admin_force_fail'), 'target_status', v_target)
  );

  RETURN v_status;
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_force_complete_delivery(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_force_fail_delivery(uuid, text, text) TO authenticated;

-- 6) System helper used by cron: flag / auto-resolve stuck transit
CREATE OR REPLACE FUNCTION public.system_resolve_stuck_transit_orders(
  _overdue_hours numeric DEFAULT 6,
  _auto_fail_hours numeric DEFAULT 24,
  _limit integer DEFAULT 50
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  r record;
  flagged int := 0;
  failed int := 0;
BEGIN
  PERFORM set_config('app.otp_verified', 'true', true);
  PERFORM set_config('app.acting_as', 'system', true);

  FOR r IN
    SELECT o.id, o.status, o.status_changed_at, o.updated_at, o.created_at
    FROM public.orders o
    WHERE o.status::text IN ('picked_up', 'on_the_way', 'at_gate', 'en_route', 'assigned', 'arrived')
      AND COALESCE(o.status_changed_at, o.updated_at, o.created_at)
          < now() - ((_overdue_hours || ' hours')::interval)
    ORDER BY COALESCE(o.status_changed_at, o.updated_at) ASC
    LIMIT _limit
  LOOP
    IF COALESCE(r.status_changed_at, r.updated_at, r.created_at)
         < now() - ((_auto_fail_hours || ' hours')::interval) THEN
      UPDATE public.orders
      SET status = 'no_show'::order_status,
          needs_attention = false,
          needs_attention_reason = null,
          failure_owner = COALESCE(failure_owner, 'seller'),
          rejection_reason = COALESCE(rejection_reason, 'Auto-closed: stuck in transit beyond SLA'),
          updated_at = now()
      WHERE id = r.id;
      failed := failed + 1;
    ELSE
      UPDATE public.orders
      SET needs_attention = true,
          needs_attention_reason = COALESCE(needs_attention_reason, 'Stuck in transit - confirm delivery or report issue'),
          updated_at = now()
      WHERE id = r.id
        AND COALESCE(needs_attention, false) = false;
      IF FOUND THEN flagged := flagged + 1; END IF;
    END IF;
  END LOOP;

  RETURN jsonb_build_object('flagged', flagged, 'auto_failed', failed);
END;
$$;

GRANT EXECUTE ON FUNCTION public.system_resolve_stuck_transit_orders(numeric, numeric, integer) TO service_role;

-- 7) Wire transit failures (no_show / failed / returned) into reliability penalty
CREATE OR REPLACE FUNCTION public.compute_seller_reliability_score(_seller_id uuid)
RETURNS numeric
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  _total_orders integer;
  _completed integer;
  _failed integer;
  _on_time_pct numeric;
  _avg_response numeric;
  _repeat_pct numeric;
  _rating numeric;
  _score numeric;
BEGIN
  SELECT
    COUNT(*) FILTER (WHERE status NOT IN ('payment_pending')),
    COUNT(*) FILTER (WHERE status IN ('completed', 'delivered')),
    COUNT(*) FILTER (WHERE status IN ('cancelled', 'no_show', 'failed', 'returned', 'rejected'))
  INTO _total_orders, _completed, _failed
  FROM public.orders WHERE seller_id = _seller_id;

  IF _total_orders = 0 THEN
    UPDATE public.seller_profiles SET reliability_score = 50, reliability_updated_at = now() WHERE id = _seller_id;
    RETURN 50;
  END IF;

  SELECT COALESCE(on_time_delivery_pct, 80) INTO _on_time_pct
  FROM public.seller_profiles WHERE id = _seller_id;

  SELECT CASE
    WHEN COALESCE(avg_response_minutes, 0) = 0 THEN 70
    WHEN avg_response_minutes <= 5 THEN 100
    WHEN avg_response_minutes <= 15 THEN 90
    WHEN avg_response_minutes <= 30 THEN 75
    WHEN avg_response_minutes <= 60 THEN 60
    ELSE 40
  END INTO _avg_response
  FROM public.seller_profiles WHERE id = _seller_id;

  SELECT CASE
    WHEN COUNT(DISTINCT buyer_id) = 0 THEN 0
    ELSE (COUNT(DISTINCT buyer_id) FILTER (WHERE cnt > 1) * 100.0 / COUNT(DISTINCT buyer_id))
  END INTO _repeat_pct
  FROM (
    SELECT buyer_id, COUNT(*) as cnt
    FROM public.orders
    WHERE seller_id = _seller_id AND status IN ('completed', 'delivered')
    GROUP BY buyer_id
  ) sub;

  SELECT COALESCE(rating, 3.5) * 20 INTO _rating
  FROM public.seller_profiles WHERE id = _seller_id;

  _score := ROUND(
    (CASE WHEN _total_orders > 0 THEN (_completed::numeric / _total_orders * 100) ELSE 0 END) * 0.30 +
    LEAST(_on_time_pct, 100) * 0.20 +
    _avg_response * 0.15 +
    LEAST(_repeat_pct, 100) * 0.15 +
    LEAST(_rating, 100) * 0.10 +
    (100 - LEAST((_failed::numeric / GREATEST(_total_orders, 1) * 100), 100)) * 0.10
  , 1);

  _score := GREATEST(0, LEAST(100, _score));

  UPDATE public.seller_profiles
  SET reliability_score = _score, reliability_updated_at = now()
  WHERE id = _seller_id;

  RETURN _score;
END;
$$;
