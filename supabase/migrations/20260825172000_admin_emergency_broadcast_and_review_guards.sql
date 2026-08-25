-- 1) Emergency broadcast: client could insert emergency_broadcasts (admin RLS OK)
--    but notifySocietyMembers failed because notification_queue INSERT is
--    WITH CHECK (user_id = auth.uid()) — cannot enqueue for other residents.
-- 2) Review prompts: harden so unfinished / cancelled / unpaid checkouts never
--    get "How was your order?" pushes (defense in depth; prod evidence already
--    shows prompts only for delivered/completed).

BEGIN;

-- ── Society-wide notify (admin / security definer) ───────────────────────────
CREATE OR REPLACE FUNCTION public.admin_notify_society_members(
  p_society_id uuid,
  p_title text,
  p_body text,
  p_type text DEFAULT 'broadcast',
  p_payload jsonb DEFAULT '{}'::jsonb,
  p_include_unapproved boolean DEFAULT true,
  p_path text DEFAULT NULL,
  p_exclude_user_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_count int := 0;
  r record;
  v_payload jsonb;
  v_path text;
BEGIN
  IF v_uid IS NULL OR NOT public.is_admin(v_uid) THEN
    RAISE EXCEPTION 'Not authorized' USING ERRCODE = '42501';
  END IF;
  IF p_society_id IS NULL THEN
    RAISE EXCEPTION 'society_id required';
  END IF;
  IF NULLIF(trim(p_title), '') IS NULL OR NULLIF(trim(p_body), '') IS NULL THEN
    RAISE EXCEPTION 'title and body required';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.societies s WHERE s.id = p_society_id) THEN
    RAISE EXCEPTION 'Society not found';
  END IF;

  v_path := NULLIF(trim(COALESCE(p_path, '')), '');
  v_payload := COALESCE(p_payload, '{}'::jsonb)
    || jsonb_build_object(
      'type', COALESCE(NULLIF(trim(p_type), ''), 'broadcast'),
      'society_id', p_society_id,
      'target_role', 'resident'
    );

  FOR r IN
    SELECT p.id
    FROM public.profiles p
    WHERE p.society_id = p_society_id
      AND (p_exclude_user_id IS NULL OR p.id IS DISTINCT FROM p_exclude_user_id)
      AND (
        p_include_unapproved
        OR COALESCE(p.verification_status, '') = 'approved'
      )
  LOOP
    INSERT INTO public.notification_queue (
      user_id, title, body, type, reference_path, action_url, payload
    ) VALUES (
      r.id,
      trim(p_title),
      trim(p_body),
      COALESCE(NULLIF(trim(p_type), ''), 'broadcast'),
      v_path,
      v_path,
      v_payload
    );
    v_count := v_count + 1;
  END LOOP;

  RETURN jsonb_build_object('notified_count', v_count, 'society_id', p_society_id);
END;
$$;

REVOKE ALL ON FUNCTION public.admin_notify_society_members(uuid, text, text, text, jsonb, boolean, text, uuid)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_notify_society_members(uuid, text, text, text, jsonb, boolean, text, uuid)
  TO authenticated, service_role;

-- ── Atomic emergency broadcast + fan-out ─────────────────────────────────────
CREATE OR REPLACE FUNCTION public.admin_send_emergency_broadcast(
  p_society_id uuid,
  p_category text,
  p_title text,
  p_body text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_broadcast_id uuid;
  v_category text := COALESCE(NULLIF(trim(p_category), ''), 'general');
  v_notify jsonb;
BEGIN
  IF v_uid IS NULL OR NOT public.is_admin(v_uid) THEN
    RAISE EXCEPTION 'Not authorized' USING ERRCODE = '42501';
  END IF;
  IF p_society_id IS NULL THEN
    RAISE EXCEPTION 'Select a society before sending a broadcast';
  END IF;
  IF NULLIF(trim(p_title), '') IS NULL OR NULLIF(trim(p_body), '') IS NULL THEN
    RAISE EXCEPTION 'title and body required';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.societies s WHERE s.id = p_society_id) THEN
    RAISE EXCEPTION 'Society not found';
  END IF;

  INSERT INTO public.emergency_broadcasts (
    society_id, sender_id, sent_by, type, category, title, message, body
  ) VALUES (
    p_society_id,
    v_uid,
    v_uid,
    v_category,
    v_category,
    trim(p_title),
    trim(p_body),
    trim(p_body)
  )
  RETURNING id INTO v_broadcast_id;

  v_notify := public.admin_notify_society_members(
    p_society_id,
    trim(p_title),
    trim(p_body),
    'broadcast',
    jsonb_build_object(
      'category', v_category,
      'broadcast_id', v_broadcast_id,
      'type', 'broadcast'
    ),
    true,
    NULL,
    NULL
  );

  RETURN jsonb_build_object(
    'broadcast_id', v_broadcast_id,
    'notified_count', COALESCE((v_notify->>'notified_count')::int, 0),
    'society_id', p_society_id
  );
END;
$$;

REVOKE ALL ON FUNCTION public.admin_send_emergency_broadcast(uuid, text, text, text)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_send_emergency_broadcast(uuid, text, text, text)
  TO authenticated, service_role;

-- ── Review prompt guards ─────────────────────────────────────────────────────
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
  _payment_type TEXT;
BEGIN
  IF TG_OP != 'UPDATE' OR OLD.status IS NOT DISTINCT FROM NEW.status THEN
    RETURN NEW;
  END IF;

  -- Never review unfinished / failed checkouts
  IF NEW.status::text IN (
    'payment_pending', 'placed', 'cancelled', 'rejected', 'failed', 'expired'
  ) THEN
    RETURN NEW;
  END IF;

  _payment_type := lower(COALESCE(NEW.payment_type, ''));
  IF _payment_type IN ('online', 'razorpay', 'upi', 'upi_deep_link', 'prepaid')
     AND COALESCE(NEW.payment_status, '') IS DISTINCT FROM 'paid'
     AND COALESCE(NEW.payment_status, '') IS DISTINCT FROM 'buyer_confirmed' THEN
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

CREATE OR REPLACE FUNCTION public.fn_create_review_prompt()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  _seller_name text;
  _has_review boolean;
  _payment_type text;
BEGIN
  IF NEW.status::text NOT IN ('delivered', 'completed', 'buyer_received', 'picked_up') THEN
    RETURN NEW;
  END IF;
  IF OLD.status IS NOT DISTINCT FROM NEW.status THEN
    RETURN NEW;
  END IF;

  _payment_type := lower(COALESCE(NEW.payment_type, ''));
  IF _payment_type IN ('online', 'razorpay', 'upi', 'upi_deep_link', 'prepaid')
     AND COALESCE(NEW.payment_status, '') IS DISTINCT FROM 'paid'
     AND COALESCE(NEW.payment_status, '') IS DISTINCT FROM 'buyer_confirmed' THEN
    RETURN NEW;
  END IF;

  SELECT EXISTS(
    SELECT 1 FROM public.reviews WHERE order_id = NEW.id AND buyer_id = NEW.buyer_id
  ) INTO _has_review;

  IF NOT _has_review THEN
    SELECT business_name INTO _seller_name FROM public.seller_profiles WHERE id = NEW.seller_id;
    INSERT INTO public.review_prompts (order_id, buyer_id, seller_id, seller_name, prompt_at)
    VALUES (NEW.id, NEW.buyer_id, NEW.seller_id, _seller_name, now() + interval '2 hours')
    ON CONFLICT (order_id, buyer_id) DO NOTHING;
  END IF;
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.get_pending_review_prompts()
RETURNS TABLE(
  id uuid,
  order_id uuid,
  seller_id uuid,
  seller_name text,
  prompt_at timestamp with time zone
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT rp.id, rp.order_id, rp.seller_id, rp.seller_name, rp.prompt_at
  FROM public.review_prompts rp
  JOIN public.orders o ON o.id = rp.order_id
  WHERE rp.buyer_id = auth.uid()
    AND rp.status = 'pending'
    AND rp.prompt_at <= now()
    AND o.status::text IN ('delivered', 'completed', 'buyer_received', 'picked_up')
    AND NOT (
      lower(COALESCE(o.payment_type, '')) IN ('online', 'razorpay', 'upi', 'upi_deep_link', 'prepaid')
      AND COALESCE(o.payment_status, '') IS DISTINCT FROM 'paid'
      AND COALESCE(o.payment_status, '') IS DISTINCT FROM 'buyer_confirmed'
    )
  ORDER BY rp.prompt_at ASC
  LIMIT 3;
$function$;

CREATE OR REPLACE FUNCTION public.fn_send_review_nudges()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  _count integer := 0;
  _prompt record;
BEGIN
  FOR _prompt IN
    SELECT rp.id, rp.buyer_id, rp.seller_name, rp.order_id
    FROM public.review_prompts rp
    JOIN public.orders o ON o.id = rp.order_id
    WHERE rp.status = 'pending' AND rp.nudge_sent = false
      AND rp.prompt_at < now() - interval '24 hours'
      AND rp.prompt_at > now() - interval '7 days'
      AND o.status::text IN ('delivered', 'completed', 'buyer_received', 'picked_up')
      AND NOT (
        lower(COALESCE(o.payment_type, '')) IN ('online', 'razorpay', 'upi', 'upi_deep_link', 'prepaid')
        AND COALESCE(o.payment_status, '') IS DISTINCT FROM 'paid'
        AND COALESCE(o.payment_status, '') IS DISTINCT FROM 'buyer_confirmed'
      )
    LIMIT 50
  LOOP
    INSERT INTO public.notification_queue (user_id, title, body, type, reference_path, payload)
    VALUES (
      _prompt.buyer_id,
      'How was your order?',
      'Rate your experience with ' || COALESCE(_prompt.seller_name, 'the seller') || ' — your review helps the community!',
      'review_nudge',
      '/orders/' || _prompt.order_id::text,
      jsonb_build_object(
        'orderId', _prompt.order_id,
        'order_id', _prompt.order_id,
        'status', 'review_reminder',
        'target_role', 'buyer',
        'action', 'review',
        'sellerName', _prompt.seller_name,
        'wa_template', 'sociva_order_update'
      )
    );
    UPDATE public.review_prompts SET nudge_sent = true, updated_at = now() WHERE id = _prompt.id;
    _count := _count + 1;
  END LOOP;

  UPDATE public.review_prompts rp
  SET status = 'expired', updated_at = now()
  WHERE rp.status = 'pending'
    AND (
      rp.prompt_at < now() - interval '14 days'
      OR EXISTS (
        SELECT 1 FROM public.orders o
        WHERE o.id = rp.order_id
          AND o.status::text IN ('cancelled', 'rejected', 'payment_pending')
      )
    );

  RETURN _count;
END;
$function$;

COMMIT;
