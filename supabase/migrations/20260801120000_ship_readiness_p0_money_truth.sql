-- Ship readiness P0: money truth, notify RLS, booking sync, settlements ledger

-- ============================================================
-- 1. Fix approve_refund / reject_refund seller identity
--    orders.seller_id is seller_profiles.id, not auth.uid()
-- ============================================================
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

  RETURN r;
END;
$$;

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

  RETURN r;
END;
$$;

-- ============================================================
-- 2. complete_refund also marks order + payment_records refunded
-- ============================================================
CREATE OR REPLACE FUNCTION public.complete_refund(p_refund_id uuid, p_gateway_ref text, p_gateway_status text)
RETURNS public.refund_requests
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  r public.refund_requests;
  v_before text;
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
    AND payment_status = 'paid';

  UPDATE public.payment_records
  SET payment_status = 'refunded'
  WHERE order_id = r.order_id
    AND payment_status = 'paid';

  INSERT INTO public.refund_audit_log(refund_id, action, actor_role, before_state, after_state, metadata)
  VALUES (p_refund_id, 'complete', 'system', v_before, 'refund_completed',
          jsonb_build_object('gateway_ref', p_gateway_ref, 'gateway_status', p_gateway_status));

  INSERT INTO public.notification_queue(user_id, title, body, type, reference_path, payload)
  VALUES (r.buyer_id,
          'Refund completed',
          'Your refund of ₹' || r.amount || ' has been settled to your original payment method. Ref: ' || p_gateway_ref,
          'order',
          '/orders/' || r.order_id,
          jsonb_build_object('orderId', r.order_id, 'refundId', r.id, 'status', 'refund_completed', 'target_role', 'buyer'));

  RETURN r;
END;
$$;

-- ============================================================
-- 3. notification_queue INSERT — self only (service_role bypasses RLS)
-- ============================================================
DROP POLICY IF EXISTS "Authenticated users can enqueue notifications" ON public.notification_queue;
DROP POLICY IF EXISTS "Authenticated users can enqueue their own notifications" ON public.notification_queue;
CREATE POLICY "Authenticated users can enqueue their own notifications"
  ON public.notification_queue FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid());

-- ============================================================
-- 4. release_service_slot
-- ============================================================
CREATE OR REPLACE FUNCTION public.release_service_slot(_slot_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.service_slots
  SET booked_count = GREATEST(booked_count - 1, 0)
  WHERE id = _slot_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.release_service_slot(uuid) TO authenticated, service_role;

-- ============================================================
-- 5. Restore booking status sync impl
-- ============================================================
CREATE OR REPLACE FUNCTION public.sync_booking_status_on_order_update_impl(p_old orders, p_new orders)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF p_new.status IS DISTINCT FROM p_old.status
     AND (p_new.order_type = 'booking' OR p_new.transaction_type IN ('service_booking', 'request_service')) THEN
    UPDATE public.service_bookings
    SET status = p_new.status::text,
        updated_at = now()
    WHERE order_id = p_new.id;
  END IF;
END;
$$;

-- ============================================================
-- 6. Restore settlement creation on delivery (ledger row only)
-- ============================================================
CREATE OR REPLACE FUNCTION public.create_settlement_on_delivery_impl(p_old orders, p_new orders)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _cooldown_hours integer;
  _platform_fee numeric;
  _gross numeric;
  _net numeric;
  _society_id uuid;
BEGIN
  IF p_old.status IS NOT DISTINCT FROM p_new.status THEN RETURN; END IF;
  IF p_new.status NOT IN ('delivered', 'completed') THEN RETURN; END IF;

  IF EXISTS (SELECT 1 FROM public.seller_settlements WHERE order_id = p_new.id) THEN
    RETURN;
  END IF;

  SELECT COALESCE(value::integer, 48) INTO _cooldown_hours
  FROM public.system_settings WHERE key = 'settlement_cooldown_hours';
  IF _cooldown_hours IS NULL THEN _cooldown_hours := 48; END IF;

  SELECT COALESCE(pr.platform_fee, 0) INTO _platform_fee
  FROM public.payment_records pr WHERE pr.order_id = p_new.id LIMIT 1;
  IF _platform_fee IS NULL THEN _platform_fee := 0; END IF;

  _gross := COALESCE(p_new.total_amount, 0);
  _net := _gross - _platform_fee;

  SELECT society_id INTO _society_id FROM public.profiles WHERE id = p_new.buyer_id;

  INSERT INTO public.seller_settlements (
    order_id, seller_id, society_id,
    gross_amount, platform_fee, delivery_fee_share, net_amount,
    settlement_status, eligible_at
  ) VALUES (
    p_new.id, p_new.seller_id, COALESCE(_society_id, p_new.buyer_society_id),
    _gross, _platform_fee, COALESCE(p_new.delivery_fee, 0), _net,
    'pending',
    now() + (_cooldown_hours || ' hours')::interval
  );
END;
$$;
