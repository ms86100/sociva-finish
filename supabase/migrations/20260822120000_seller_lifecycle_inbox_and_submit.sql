-- Seller store lifecycle: submit/review/approve stay in the bell, not only push.
-- Dual-write inbox + queue so sellers see the event even if the processor is delayed.

CREATE OR REPLACE FUNCTION public.enqueue_seller_lifecycle_notification(
  p_user_id uuid,
  p_business_name text,
  p_status text,
  p_seller_id uuid DEFAULT NULL,
  p_rejection_note text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_title text;
  v_body text;
  v_type text;
  v_path text;
  v_key text;
  v_payload jsonb;
  v_queue_id uuid;
  v_is_owner boolean := false;
  v_is_admin boolean := false;
BEGIN
  IF p_user_id IS NULL OR p_status IS NULL THEN
    RETURN;
  END IF;

  IF p_seller_id IS NOT NULL THEN
    SELECT EXISTS (
      SELECT 1 FROM public.seller_profiles
      WHERE id = p_seller_id AND user_id = auth.uid()
    ) INTO v_is_owner;
  END IF;

  v_is_admin :=
    current_setting('request.jwt.claim.role', true) = 'service_role'
    OR public.is_admin(auth.uid())
    OR (
      p_seller_id IS NOT NULL
      AND EXISTS (
        SELECT 1
        FROM public.seller_profiles sp
        WHERE sp.id = p_seller_id
          AND public.is_society_admin(auth.uid(), sp.society_id)
      )
    );

  IF auth.uid() IS NOT NULL
     AND current_setting('request.jwt.claim.role', true) IS DISTINCT FROM 'service_role'
     AND NOT v_is_admin
     AND NOT (p_status IN ('pending', 'submitted') AND v_is_owner) THEN
    RAISE EXCEPTION 'admin only';
  END IF;

  IF p_status IN ('pending', 'submitted') THEN
    v_title := 'Your store has been submitted for review.';
    v_body := 'We''ll notify you once the review is complete.';
    v_type := 'seller_store_submitted';
    v_path := '/become-seller';
  ELSIF p_status = 'approved' THEN
    v_title := 'Your store has been approved!';
    v_body := 'Recharge Sociva Credits to start selling.';
    v_type := 'seller_approved';
    v_path := '/seller/credits';
  ELSIF p_status = 'rejected' THEN
    v_title := 'Store application rejected';
    v_body := CASE
      WHEN NULLIF(btrim(COALESCE(p_rejection_note, '')), '') IS NOT NULL
        THEN 'Your store application for "' || COALESCE(p_business_name, 'your store') || '" was rejected. Reason: ' || p_rejection_note
      ELSE 'Your store application for "' || COALESCE(p_business_name, 'your store') || '" was rejected. Please review and resubmit.'
    END;
    v_type := 'seller_rejected';
    v_path := '/become-seller';
  ELSIF p_status = 'suspended' THEN
    v_title := 'Store suspended';
    v_body := 'Your store "' || COALESCE(p_business_name, '') || '" has been suspended. Please contact support.';
    v_type := 'seller_suspended';
    v_path := '/seller';
  ELSIF p_status = 'credit_success' THEN
    v_title := 'Sociva Credits added successfully.';
    v_body := 'Your store can now be discovered by buyers in your selling area.';
    v_type := 'seller_credit_purchased';
    v_path := '/seller/credits';
  ELSIF p_status = 'credit_failed' THEN
    v_title := 'We couldn''t complete your recharge. Please try again.';
    v_body := 'Your account has not been charged unless the payment was verified.';
    v_type := 'seller_credit_failed';
    v_path := '/seller/credits';
  ELSE
    RETURN;
  END IF;

  v_key := md5(COALESCE(p_seller_id::text, p_user_id::text) || '-' || p_status || '-' || v_type);
  v_payload := jsonb_build_object(
    'type', v_type,
    'action', CASE p_status
      WHEN 'pending' THEN 'STORE_SUBMITTED'
      WHEN 'submitted' THEN 'STORE_SUBMITTED'
      WHEN 'approved' THEN 'STORE_APPROVED'
      WHEN 'rejected' THEN 'STORE_REJECTED'
      WHEN 'credit_success' THEN 'CREDIT_RECHARGE_SUCCESS'
      WHEN 'credit_failed' THEN 'CREDIT_RECHARGE_FAILED'
      ELSE 'STORE_SUSPENDED'
    END,
    'status', v_type,
    'target_role', 'seller',
    'wa_template', 'sociva_store_status',
    'cta', v_path
  );

  INSERT INTO public.notification_queue (
    user_id, title, body, type, reference_path, payload, idempotency_key
  ) VALUES (
    p_user_id, v_title, v_body, v_type, v_path, v_payload, v_key
  )
  ON CONFLICT (user_id, idempotency_key) WHERE idempotency_key IS NOT NULL DO NOTHING
  RETURNING id INTO v_queue_id;

  IF v_queue_id IS NULL THEN
    SELECT id INTO v_queue_id
    FROM public.notification_queue
    WHERE user_id = p_user_id AND idempotency_key = v_key
    LIMIT 1;
  END IF;

  IF v_queue_id IS NOT NULL THEN
    INSERT INTO public.user_notifications (
      user_id, title, body, type, reference_path, action_url,
      queue_item_id, payload, data, is_read
    ) VALUES (
      p_user_id, v_title, v_body, v_type, v_path, v_path,
      v_queue_id, v_payload, v_payload, false
    )
    ON CONFLICT (queue_item_id) WHERE queue_item_id IS NOT NULL DO NOTHING;
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.trg_enqueue_seller_status_notification()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.verification_status IS DISTINCT FROM OLD.verification_status
     AND NEW.verification_status IN ('pending', 'approved', 'rejected', 'suspended') THEN
    BEGIN
      PERFORM public.enqueue_seller_lifecycle_notification(
        NEW.user_id,
        NEW.business_name,
        NEW.verification_status,
        NEW.id,
        NEW.rejection_note
      );
    EXCEPTION WHEN others THEN
      RAISE WARNING 'enqueue seller lifecycle failed: %', SQLERRM;
    END;
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.seller_credit_notify(
  p_seller_id uuid,
  p_type text,
  p_title text,
  p_body text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user uuid;
  v_key text;
  v_payload jsonb;
  v_queue_id uuid;
BEGIN
  SELECT user_id INTO v_user FROM public.seller_profiles WHERE id = p_seller_id;
  IF v_user IS NULL THEN RETURN; END IF;
  v_key := md5(p_seller_id::text || '-' || p_type || '-' || date_trunc('hour', now())::text);
  v_payload := jsonb_build_object('seller_id', p_seller_id, 'target_role', 'seller', 'type', p_type);
  INSERT INTO public.notification_queue(user_id, title, body, type, reference_path, action_url, payload, idempotency_key)
  VALUES (
    v_user, p_title, p_body, p_type, '/seller/credits', '/seller/credits', v_payload, v_key
  )
  ON CONFLICT (user_id, idempotency_key) WHERE idempotency_key IS NOT NULL DO NOTHING
  RETURNING id INTO v_queue_id;
  IF v_queue_id IS NULL THEN
    SELECT id INTO v_queue_id
    FROM public.notification_queue
    WHERE user_id = v_user AND idempotency_key = v_key
    LIMIT 1;
  END IF;
  IF v_queue_id IS NOT NULL THEN
    INSERT INTO public.user_notifications (
      user_id, title, body, type, reference_path, action_url,
      queue_item_id, payload, data, is_read
    ) VALUES (
      v_user, p_title, p_body, p_type, '/seller/credits', '/seller/credits',
      v_queue_id, v_payload, v_payload, false
    )
    ON CONFLICT (queue_item_id) WHERE queue_item_id IS NOT NULL DO NOTHING;
  END IF;
EXCEPTION WHEN others THEN
  NULL;
END;
$$;

CREATE OR REPLACE FUNCTION public.fail_seller_credit_purchase(p_purchase_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_seller uuid;
BEGIN
  UPDATE public.seller_credit_purchases
  SET status = 'failed',
      failed_at = now(),
      failure_reason = COALESCE(failure_reason, 'payment_failed'),
      updated_at = now()
  WHERE id = p_purchase_id AND status = 'created'
  RETURNING seller_id INTO v_seller;

  IF v_seller IS NOT NULL THEN
    PERFORM public.seller_credit_notify(
      v_seller,
      'seller_credit_failed',
      'We couldn''t complete your recharge. Please try again.',
      'Your account has not been charged unless the payment was verified.'
    );
  END IF;
END;
$$;
