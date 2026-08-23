-- 1) Review prompt push: use product name(s), not truncated order UUID (#B0506F).
-- 2) Expose admin billing rates on seller credit summary for dynamic recharge copy.
-- 3) Let approved sellers read billing rates (amounts only via SELECT).

CREATE OR REPLACE FUNCTION public.fn_enqueue_review_prompt()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  _flow RECORD;
  _txn_type TEXT;
  _parent_group TEXT;
  _seller_name TEXT;
  _item_label TEXT;
  _item_count int;
  _body TEXT;
  _already_reviewed BOOLEAN;
BEGIN
  IF TG_OP != 'UPDATE' OR OLD.status IS NOT DISTINCT FROM NEW.status THEN
    RETURN NEW;
  END IF;

  _txn_type := COALESCE(NEW.transaction_type, 'self_fulfillment');

  SELECT resolve_transition_parent_group(sp.primary_group), sp.business_name
  INTO _parent_group, _seller_name
  FROM seller_profiles sp WHERE sp.id = NEW.seller_id;

  _parent_group := COALESCE(_parent_group, 'default');

  SELECT * INTO _flow FROM category_status_flows
  WHERE transaction_type = _txn_type AND parent_group = _parent_group
    AND status_key = NEW.status::text AND is_terminal = true AND is_success = true
  LIMIT 1;

  IF _flow.id IS NULL THEN
    SELECT * INTO _flow FROM category_status_flows
    WHERE transaction_type = _txn_type AND parent_group = 'default'
      AND status_key = NEW.status::text AND is_terminal = true AND is_success = true
    LIMIT 1;
  END IF;

  IF _flow.id IS NULL THEN RETURN NEW; END IF;

  SELECT EXISTS(SELECT 1 FROM reviews WHERE order_id = NEW.id AND buyer_id = NEW.buyer_id)
  INTO _already_reviewed;

  IF _already_reviewed THEN RETURN NEW; END IF;

  SELECT left(trim(oi.product_name), 60)
  INTO _item_label
  FROM order_items oi
  WHERE oi.order_id = NEW.id
    AND COALESCE(NULLIF(trim(oi.product_name), ''), '') <> ''
  ORDER BY oi.created_at ASC NULLS LAST, oi.id ASC
  LIMIT 1;

  SELECT COUNT(*)::int INTO _item_count
  FROM order_items oi
  WHERE oi.order_id = NEW.id;

  IF _item_label IS NULL OR length(trim(_item_label)) = 0 THEN
    _item_label := 'your order';
  ELSIF COALESCE(_item_count, 0) > 1 THEN
    _item_label := _item_label || ' +' || (_item_count - 1)::text || ' more';
  END IF;

  _body := 'Rate ' || _item_label
    || ' from ' || COALESCE(NULLIF(trim(_seller_name), ''), 'the seller')
    || '. Tap to share your experience.';

  INSERT INTO notification_queue (user_id, title, body, type, reference_path, payload)
  VALUES (
    NEW.buyer_id,
    '⭐ How was your order?',
    _body,
    'review_prompt',
    '/orders/' || NEW.id::text,
    jsonb_build_object(
      'order_id', NEW.id,
      'orderId', NEW.id,
      'seller_id', NEW.seller_id,
      'action', 'review',
      'item_label', _item_label,
      'target_role', 'buyer'
    )
  );

  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.get_seller_credit_summary(p_seller_ids uuid[])
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_available numeric := 0;
  v_reserved numeric := 0;
  v_purchased numeric := 0;
  v_consumed numeric := 0;
  v_adjusted numeric := 0;
  v_used numeric := 0;
  v_orders int := 0;
  v_enquiries int := 0;
  v_bookings int := 0;
  v_contacts int := 0;
  v_healthy numeric;
  v_low numeric;
  v_critical numeric;
  v_rates jsonb := '[]'::jsonb;
BEGIN
  IF p_seller_ids IS NULL OR array_length(p_seller_ids, 1) IS NULL THEN
    RAISE EXCEPTION 'seller ids required';
  END IF;
  IF v_uid IS NOT NULL
     AND NOT public.is_admin(v_uid)
     AND EXISTS (
       SELECT 1
       FROM unnest(p_seller_ids) requested(id)
       LEFT JOIN public.seller_profiles sp
         ON sp.id = requested.id AND sp.user_id = v_uid
       WHERE sp.id IS NULL
     ) THEN
    RAISE EXCEPTION 'seller scope forbidden';
  END IF;

  SELECT
    COALESCE(SUM(a.available), 0),
    COALESCE(SUM(a.reserved), 0),
    COALESCE(SUM(a.lifetime_purchased), 0),
    COALESCE(SUM(a.lifetime_consumed), 0),
    COALESCE(SUM(a.lifetime_adjusted), 0)
  INTO v_available, v_reserved, v_purchased, v_consumed, v_adjusted
  FROM public.seller_credit_accounts a
  WHERE a.seller_id = ANY(p_seller_ids);

  SELECT
    COALESCE(SUM(CASE WHEN l.type = 'event_charge' THEN ABS(l.charged_amount) ELSE 0 END), 0),
    COUNT(*) FILTER (WHERE l.event_type = 'ORDER_COMPLETED' AND l.type = 'event_charge'),
    COUNT(*) FILTER (WHERE l.event_type = 'ENQUIRY_CREATED' AND l.type = 'event_charge'),
    COUNT(*) FILTER (WHERE l.event_type = 'SERVICE_BOOKING' AND l.type = 'event_charge'),
    COUNT(*) FILTER (WHERE l.event_type = 'CONTACT_REQUEST' AND l.type = 'event_charge')
  INTO v_used, v_orders, v_enquiries, v_bookings, v_contacts
  FROM public.seller_credit_ledger l
  WHERE l.seller_id = ANY(p_seller_ids)
    AND l.created_at >= date_trunc('month', now());

  SELECT value INTO v_healthy FROM public.seller_credit_thresholds WHERE key = 'healthy_min';
  SELECT value INTO v_low FROM public.seller_credit_thresholds WHERE key = 'low_min';
  SELECT value INTO v_critical FROM public.seller_credit_thresholds WHERE key = 'critical_min';

  SELECT COALESCE(
    jsonb_agg(
      jsonb_build_object(
        'event_type', r.event_type,
        'amount', r.amount,
        'enabled', r.enabled
      )
      ORDER BY r.event_type
    ),
    '[]'::jsonb
  )
  INTO v_rates
  FROM public.seller_billing_rules r;

  RETURN jsonb_build_object(
    'available', v_available,
    'reserved', v_reserved,
    'lifetime_purchased', v_purchased,
    'lifetime_consumed', v_consumed,
    'lifetime_adjusted', v_adjusted,
    'used_this_month', v_used,
    'orders_this_month', v_orders,
    'enquiries_this_month', v_enquiries,
    'bookings_this_month', v_bookings,
    'contacts_this_month', v_contacts,
    'healthy_min', v_healthy,
    'low_min', v_low,
    'critical_min', v_critical,
    'spend_enabled', public.seller_credit_flag_enabled('seller_credit_spend_enabled'),
    'purchase_enabled', public.seller_credit_flag_enabled('seller_credit_purchase_enabled'),
    'billing_rates', v_rates
  );
END;
$function$;

GRANT EXECUTE ON FUNCTION public.get_seller_credit_summary(uuid[]) TO authenticated, service_role;

DROP POLICY IF EXISTS seller_billing_rules_select ON public.seller_billing_rules;
CREATE POLICY seller_billing_rules_select ON public.seller_billing_rules
  FOR SELECT TO authenticated
  USING (
    public.is_admin(auth.uid())
    OR EXISTS (
      SELECT 1 FROM public.seller_profiles sp
      WHERE sp.user_id = auth.uid()
    )
  );
