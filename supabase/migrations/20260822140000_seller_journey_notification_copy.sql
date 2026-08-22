-- Calmer seller-journey copy for submit / review / approve / recharge.
-- Dual-write behavior is unchanged; only titles, bodies, and action labels.

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
  v_store text := COALESCE(NULLIF(btrim(p_business_name), ''), 'your store');
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
    v_title := 'We''re reviewing your store';
    v_body := 'Thank you for submitting ' || v_store || '. We''ll notify you as soon as the review is complete — usually within a day. You don''t need to do anything right now.';
    v_type := 'seller_store_submitted';
    v_path := '/become-seller';
  ELSIF p_status = 'approved' THEN
    v_title := 'Your store is approved';
    v_body := 'Welcome to selling on Sociva. Recharge Sociva Credits to make ' || v_store || ' visible to buyers nearby.';
    v_type := 'seller_approved';
    v_path := '/seller/credits';
  ELSIF p_status = 'rejected' THEN
    v_title := 'We need a small update';
    v_body := CASE
      WHEN NULLIF(btrim(COALESCE(p_rejection_note, '')), '') IS NOT NULL
        THEN 'We couldn''t approve ' || v_store || ' yet. ' || p_rejection_note
      ELSE 'We couldn''t approve ' || v_store || ' yet. Update your application and resubmit when you''re ready.'
    END;
    v_type := 'seller_rejected';
    v_path := '/become-seller';
  ELSIF p_status = 'suspended' THEN
    v_title := 'Your store is temporarily paused';
    v_body := v_store || ' has been paused. Please contact support and we''ll help you get back on track.';
    v_type := 'seller_suspended';
    v_path := '/seller';
  ELSIF p_status = 'credit_success' THEN
    v_title := 'Sociva Credits are ready';
    v_body := v_store || ' can now be discovered by buyers in your selling area.';
    v_type := 'seller_credit_purchased';
    v_path := '/seller/credits';
  ELSIF p_status = 'credit_failed' THEN
    v_title := 'We couldn''t complete your recharge';
    v_body := 'Your account has not been charged unless the payment was verified. You can try again whenever you''re ready.';
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
    'seller_id', p_seller_id,
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
