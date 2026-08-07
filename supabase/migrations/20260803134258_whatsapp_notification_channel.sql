-- WhatsApp as a notification channel + refund notify gaps

ALTER TABLE public.notification_preferences
  ADD COLUMN IF NOT EXISTS whatsapp boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS whatsapp_opted_in_at timestamptz;

COMMENT ON COLUMN public.notification_preferences.whatsapp IS
  'When true, eligible order/booking/moderation notifications may also be sent via WhatsApp Cloud API';

-- ---------------------------------------------------------------------------
-- request_refund: notify seller
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.request_refund(
  p_order_id uuid,
  p_reason text,
  p_category text DEFAULT 'order_issue'::text,
  p_evidence_urls text[] DEFAULT NULL::text[]
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_order record;
  v_refund_id uuid;
  v_seller_user uuid;
  v_valid_categories text[] := ARRAY[
    'order_issue','quality_issue','wrong_item','not_received','seller_cancelled','other'
  ];
BEGIN
  IF p_category IS NULL OR NOT (p_category = ANY(v_valid_categories)) THEN
    RAISE EXCEPTION 'Invalid refund category: %', COALESCE(p_category, 'NULL');
  END IF;

  SELECT id, buyer_id, seller_id, society_id, total_amount, frozen_total, payment_status, status
  INTO v_order
  FROM orders
  WHERE id = p_order_id AND buyer_id = auth.uid();

  IF v_order IS NULL THEN
    RAISE EXCEPTION 'Order not found or does not belong to you';
  END IF;

  IF v_order.payment_status NOT IN ('paid', 'buyer_confirmed', 'seller_verified', 'completed') THEN
    RAISE EXCEPTION 'No payment found for this order';
  END IF;

  IF EXISTS (SELECT 1 FROM refund_requests WHERE order_id = p_order_id AND status NOT IN ('rejected', 'completed')) THEN
    RAISE EXCEPTION 'A refund request already exists for this order';
  END IF;

  INSERT INTO refund_requests (order_id, buyer_id, seller_id, society_id, amount, reason, category, evidence_urls)
  VALUES (
    p_order_id,
    v_order.buyer_id,
    v_order.seller_id,
    v_order.society_id,
    COALESCE(v_order.frozen_total, v_order.total_amount),
    p_reason,
    p_category,
    p_evidence_urls
  )
  RETURNING id INTO v_refund_id;

  IF NOT EXISTS (SELECT 1 FROM dispute_tickets WHERE order_id = p_order_id AND status != 'resolved') THEN
    INSERT INTO dispute_tickets (order_id, raised_by, against_user, reason, category, status, society_id)
    VALUES (p_order_id, auth.uid(), v_order.seller_id, p_reason, p_category, 'open', v_order.society_id);
  END IF;

  SELECT sp.user_id INTO v_seller_user
  FROM seller_profiles sp
  WHERE sp.id = v_order.seller_id;

  IF v_seller_user IS NOT NULL THEN
    INSERT INTO public.notification_queue (user_id, title, body, type, reference_path, payload)
    VALUES (
      v_seller_user,
      'Refund requested',
      'A buyer requested a refund. Reason: ' || left(coalesce(p_reason, ''), 120),
      'order',
      '/orders/' || p_order_id,
      jsonb_build_object(
        'orderId', p_order_id,
        'refundId', v_refund_id,
        'status', 'refund_requested',
        'target_role', 'seller',
        'wa_template', 'sociva_refund_update'
      )
    );
  END IF;

  RETURN v_refund_id;
END;
$function$;

-- ---------------------------------------------------------------------------
-- approve_refund: notify buyer
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.approve_refund(p_refund_id uuid)
RETURNS public.refund_requests
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  r public.refund_requests;
  v_seller_profile uuid;
  v_seller_user uuid;
BEGIN
  SELECT * INTO r FROM public.refund_requests WHERE id = p_refund_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Refund not found'; END IF;

  SELECT o.seller_id INTO v_seller_profile FROM public.orders o WHERE o.id = r.order_id;
  SELECT sp.user_id INTO v_seller_user FROM public.seller_profiles sp WHERE sp.id = v_seller_profile;

  IF v_seller_user IS DISTINCT FROM auth.uid() AND NOT public.is_admin(auth.uid()) THEN
    RAISE EXCEPTION 'Only the seller can approve this refund' USING ERRCODE = '42501';
  END IF;

  IF r.refund_state <> 'requested' THEN
    RAISE EXCEPTION 'Refund cannot be approved from state: %', r.refund_state;
  END IF;

  UPDATE public.refund_requests
  SET refund_state = 'approved',
      status = 'approved',
      approved_at = now(),
      approved_by = auth.uid(),
      sla_deadline = now() + interval '72 hours',
      updated_at = now()
  WHERE id = p_refund_id
  RETURNING * INTO r;

  INSERT INTO public.refund_audit_log(refund_id, action, actor_id, actor_role, before_state, after_state)
  VALUES (p_refund_id, 'approve', auth.uid(), 'seller', 'requested', 'approved');

  INSERT INTO public.notification_queue (user_id, title, body, type, reference_path, payload)
  VALUES (
    r.buyer_id,
    'Refund approved',
    'Your refund of ₹' || r.amount || ' was approved and will be processed shortly.',
    'order',
    '/orders/' || r.order_id,
    jsonb_build_object(
      'orderId', r.order_id,
      'refundId', r.id,
      'status', 'refund_approved',
      'target_role', 'buyer',
      'wa_template', 'sociva_refund_update'
    )
  );

  RETURN r;
END;
$$;

-- ---------------------------------------------------------------------------
-- reject_refund: notify buyer
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.reject_refund(p_refund_id uuid, p_reason text)
RETURNS public.refund_requests
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  r public.refund_requests;
  v_seller_profile uuid;
  v_seller_user uuid;
BEGIN
  IF p_reason IS NULL OR length(trim(p_reason)) < 5 THEN
    RAISE EXCEPTION 'Rejection reason must be at least 5 characters';
  END IF;

  SELECT * INTO r FROM public.refund_requests WHERE id = p_refund_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Refund not found'; END IF;

  SELECT o.seller_id INTO v_seller_profile FROM public.orders o WHERE o.id = r.order_id;
  SELECT sp.user_id INTO v_seller_user FROM public.seller_profiles sp WHERE sp.id = v_seller_profile;

  IF v_seller_user IS DISTINCT FROM auth.uid() AND NOT public.is_admin(auth.uid()) THEN
    RAISE EXCEPTION 'Only the seller can reject this refund' USING ERRCODE = '42501';
  END IF;

  IF r.refund_state <> 'requested' THEN
    RAISE EXCEPTION 'Refund cannot be rejected from state: %', r.refund_state;
  END IF;

  UPDATE public.refund_requests
  SET refund_state = 'rejected',
      status = 'rejected',
      rejection_reason = trim(p_reason),
      updated_at = now()
  WHERE id = p_refund_id
  RETURNING * INTO r;

  INSERT INTO public.refund_audit_log(refund_id, action, actor_id, actor_role, before_state, after_state, metadata)
  VALUES (p_refund_id, 'reject', auth.uid(), 'seller', 'requested', 'rejected',
          jsonb_build_object('reason', trim(p_reason)));

  INSERT INTO public.notification_queue (user_id, title, body, type, reference_path, payload)
  VALUES (
    r.buyer_id,
    'Refund rejected',
    'Your refund request was rejected. Reason: ' || left(trim(p_reason), 120),
    'order',
    '/orders/' || r.order_id,
    jsonb_build_object(
      'orderId', r.order_id,
      'refundId', r.id,
      'status', 'refund_rejected',
      'target_role', 'buyer',
      'wa_template', 'sociva_refund_update'
    )
  );

  RETURN r;
END;
$$;
