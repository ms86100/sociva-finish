-- Seller WhatsApp can move only the next legal step, or complete delivery
-- with the real 4-digit code. The sender phone must be that seller.
-- Free text and group chats cannot call these functions.

CREATE OR REPLACE FUNCTION public.seller_whatsapp_next_step(p_order_id uuid)
RETURNS TABLE (
  order_status text,
  next_status text,
  needs_otp boolean,
  seller_user_id uuid,
  seller_id uuid,
  transaction_type text,
  parent_group text
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_status text;
  v_seller_user uuid;
  v_seller uuid;
  v_txn text;
  v_parent text;
  v_sort int;
  v_next text;
  v_otp boolean;
BEGIN
  SELECT o.status::text,
         sp.user_id,
         o.seller_id,
         COALESCE(
           NULLIF(o.transaction_type, ''),
           CASE
             WHEN o.fulfillment_type IN ('delivery', 'seller_delivery') THEN 'seller_delivery'
             ELSE 'self_fulfillment'
           END
         ),
         COALESCE(public.resolve_transition_parent_group(sp.primary_group), 'default')
  INTO v_status, v_seller_user, v_seller, v_txn, v_parent
  FROM public.orders o
  LEFT JOIN public.seller_profiles sp ON sp.id = o.seller_id
  WHERE o.id = p_order_id;

  IF NOT FOUND THEN
    RETURN;
  END IF;

  SELECT csf.sort_order INTO v_sort
  FROM public.category_status_flows csf
  WHERE csf.status_key = v_status
    AND csf.transaction_type = v_txn
    AND csf.parent_group = v_parent
    AND NOT COALESCE(csf.is_deprecated, false)
  ORDER BY csf.sort_order
  LIMIT 1;

  IF v_sort IS NULL THEN
    v_parent := 'default';
    SELECT csf.sort_order INTO v_sort
    FROM public.category_status_flows csf
    WHERE csf.status_key = v_status
      AND csf.transaction_type = v_txn
      AND csf.parent_group = 'default'
      AND NOT COALESCE(csf.is_deprecated, false)
    ORDER BY csf.sort_order
    LIMIT 1;
  END IF;

  IF v_sort IS NOT NULL THEN
    SELECT t.to_status INTO v_next
    FROM public.category_status_transitions t
    JOIN public.category_status_flows csf
      ON csf.status_key = t.to_status
     AND csf.transaction_type = v_txn
     AND csf.parent_group = v_parent
     AND NOT COALESCE(csf.is_deprecated, false)
    WHERE t.from_status = v_status
      AND t.transaction_type = v_txn
      AND t.parent_group = v_parent
      AND COALESCE(t.is_side_action, false) = false
      AND t.to_status NOT IN ('cancelled', 'rejected', 'no_show')
      AND (t.allowed_actor = 'seller' OR strpos(COALESCE(t.allowed_actor, ''), 'seller') > 0)
      AND csf.sort_order > v_sort
    ORDER BY csf.sort_order ASC
    LIMIT 1;
  END IF;

  v_otp := false;
  IF v_next IS NOT NULL THEN
    SELECT COALESCE(csf.otp_type, '') = 'delivery' INTO v_otp
    FROM public.category_status_flows csf
    WHERE csf.status_key = v_next
      AND csf.transaction_type = v_txn
      AND csf.parent_group IN (v_parent, 'default')
      AND NOT COALESCE(csf.is_deprecated, false)
    ORDER BY CASE WHEN csf.parent_group = v_parent THEN 0 ELSE 1 END
    LIMIT 1;
  END IF;

  order_status := v_status;
  next_status := v_next;
  needs_otp := COALESCE(v_otp, false);
  seller_user_id := v_seller_user;
  seller_id := v_seller;
  transaction_type := v_txn;
  parent_group := v_parent;
  RETURN NEXT;
END;
$function$;

REVOKE ALL ON FUNCTION public.seller_whatsapp_next_step(uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.seller_whatsapp_next_step(uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.seller_whatsapp_order_context(p_order_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_step record;
  v_name text;
  v_flat text;
  v_block text;
  v_society text;
  v_address text;
  v_items text;
  v_amount numeric;
  v_note text;
  v_terminal boolean;
BEGIN
  SELECT * INTO v_step FROM public.seller_whatsapp_next_step(p_order_id) LIMIT 1;
  IF v_step.order_status IS NULL THEN
    RETURN NULL;
  END IF;

  SELECT pr.name, NULLIF(btrim(pr.flat_number), ''), NULLIF(btrim(pr.block), ''),
         NULLIF(btrim(s.name), ''),
         NULLIF(btrim(o.delivery_address), ''),
         public.seller_order_item_summary(o.id),
         o.total_amount,
         NULLIF(btrim(o.notes), '')
  INTO v_name, v_flat, v_block, v_society, v_address, v_items, v_amount, v_note
  FROM public.orders o
  LEFT JOIN public.profiles pr ON pr.id = o.buyer_id
  LEFT JOIN public.societies s ON s.id = COALESCE(o.society_id, pr.society_id)
  WHERE o.id = p_order_id;

  v_terminal := v_step.order_status IN (
    'cancelled', 'rejected', 'delivered', 'completed', 'expired',
    'refunded', 'buyer_received', 'no_show', 'payment_failed'
  );

  RETURN jsonb_build_object(
    'order_id', p_order_id,
    'order_ref', upper(right(p_order_id::text, 6)),
    'status', v_step.order_status,
    'buyer_name', COALESCE(v_name, 'Customer'),
    'society', v_society,
    'block', v_block,
    'flat', v_flat,
    'address', v_address,
    'items', v_items,
    'amount', v_amount,
    'note', v_note,
    'next_status', CASE WHEN v_terminal THEN NULL ELSE v_step.next_status END,
    'needs_otp', CASE WHEN v_terminal THEN false ELSE COALESCE(v_step.needs_otp, false) END,
    'can_reject', v_step.order_status IN ('placed', 'enquired', 'requested', 'quoted'),
    'terminal', v_terminal
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.seller_whatsapp_order_context(uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.seller_whatsapp_order_context(uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.seller_whatsapp_apply_step(
  p_order_id uuid,
  p_to_status text,
  p_phone text
)
RETURNS order_status
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_step record;
  v_incoming text;
  v_seller_phone text;
  v_target order_status;
  v_result order_status;
BEGIN
  v_incoming := right(regexp_replace(COALESCE(p_phone, ''), '\D', '', 'g'), 10);
  IF length(v_incoming) <> 10 THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;

  SELECT * INTO v_step FROM public.seller_whatsapp_next_step(p_order_id) LIMIT 1;
  IF v_step.order_status IS NULL OR v_step.seller_user_id IS NULL THEN
    RAISE EXCEPTION 'Order not found';
  END IF;

  SELECT right(regexp_replace(COALESCE(pr.phone, ''), '\D', '', 'g'), 10)
  INTO v_seller_phone
  FROM public.profiles pr
  WHERE pr.id = v_step.seller_user_id;

  IF v_seller_phone IS DISTINCT FROM v_incoming OR length(v_seller_phone) <> 10 THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;

  IF v_step.order_status IN (
    'cancelled', 'rejected', 'delivered', 'completed', 'expired',
    'refunded', 'buyer_received', 'no_show'
  ) THEN
    RAISE EXCEPTION 'Order is no longer waiting';
  END IF;

  IF v_step.next_status IS NULL OR v_step.next_status IS DISTINCT FROM lower(btrim(p_to_status)) THEN
    RAISE EXCEPTION 'Order is no longer waiting';
  END IF;

  IF COALESCE(v_step.needs_otp, false) THEN
    RAISE EXCEPTION 'Send the delivery code';
  END IF;

  BEGIN
    v_target := lower(btrim(p_to_status))::order_status;
  EXCEPTION WHEN invalid_text_representation THEN
    RAISE EXCEPTION 'Invalid decision';
  END;

  PERFORM set_config('request.jwt.claim.sub', v_step.seller_user_id::text, true);
  v_result := public.seller_advance_order(p_order_id, v_target, NULL);
  RETURN v_result;
END;
$function$;

REVOKE ALL ON FUNCTION public.seller_whatsapp_apply_step(uuid, text, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.seller_whatsapp_apply_step(uuid, text, text) TO service_role;

CREATE OR REPLACE FUNCTION public.seller_whatsapp_apply_otp(
  p_phone text,
  p_code text
)
RETURNS TABLE (result text, order_id uuid, new_status text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_incoming text;
  v_code text;
  v_seller_user uuid;
  v_order uuid;
  v_count int;
  v_row record;
  v_assignment_id uuid;
  v_saved_code text;
  v_attempts int;
  v_locked_until timestamptz;
BEGIN
  v_incoming := right(regexp_replace(COALESCE(p_phone, ''), '\D', '', 'g'), 10);
  v_code := btrim(COALESCE(p_code, ''));
  IF length(v_incoming) <> 10 OR v_code !~ '^[0-9]{4}$' THEN
    result := 'none';
    RETURN NEXT;
    RETURN;
  END IF;

  SELECT pr.id INTO v_seller_user
  FROM public.profiles pr
  WHERE right(regexp_replace(COALESCE(pr.phone, ''), '\D', '', 'g'), 10) = v_incoming
  LIMIT 1;

  IF v_seller_user IS NULL THEN
    result := 'none';
    RETURN NEXT;
    RETURN;
  END IF;

  v_count := 0;
  FOR v_row IN
    SELECT o.id
    FROM public.orders o
    JOIN public.seller_profiles sp ON sp.id = o.seller_id
    WHERE sp.user_id = v_seller_user
      AND o.status::text NOT IN (
        'cancelled', 'rejected', 'delivered', 'completed', 'expired',
        'refunded', 'buyer_received', 'no_show', 'payment_pending', 'payment_failed'
      )
      AND o.created_at > now() - interval '2 days'
  LOOP
    IF EXISTS (
      SELECT 1
      FROM public.seller_whatsapp_next_step(v_row.id) n
      WHERE n.needs_otp = true
    ) AND EXISTS (
      SELECT 1
      FROM (
        SELECT da.delivery_code, da.otp_verified
        FROM public.delivery_assignments da
        WHERE da.order_id = v_row.id
        ORDER BY da.created_at DESC
        LIMIT 1
      ) latest
      WHERE latest.delivery_code IS NOT NULL
        AND COALESCE(latest.otp_verified, false) = false
    ) THEN
      v_count := v_count + 1;
      v_order := v_row.id;
    END IF;
  END LOOP;

  IF v_count = 0 THEN
    result := 'none';
    RETURN NEXT;
    RETURN;
  END IF;

  IF v_count > 1 THEN
    result := 'multiple';
    RETURN NEXT;
    RETURN;
  END IF;

  SELECT da.id, da.delivery_code, da.otp_attempt_count, da.otp_locked_until
  INTO v_assignment_id, v_saved_code, v_attempts, v_locked_until
  FROM public.delivery_assignments da
  WHERE da.order_id = v_order
  ORDER BY da.created_at DESC
  LIMIT 1
  FOR UPDATE;

  order_id := v_order;
  IF v_locked_until IS NOT NULL AND v_locked_until > now() THEN
    result := 'locked';
    RETURN NEXT;
    RETURN;
  END IF;

  IF v_saved_code IS DISTINCT FROM v_code THEN
    v_attempts := COALESCE(v_attempts, 0) + 1;
    IF v_attempts >= 5 THEN
      UPDATE public.delivery_assignments
      SET otp_attempt_count = 0,
          otp_locked_until = now() + interval '15 minutes'
      WHERE id = v_assignment_id;
      result := 'locked';
    ELSE
      UPDATE public.delivery_assignments
      SET otp_attempt_count = v_attempts
      WHERE id = v_assignment_id;
      result := 'invalid';
    END IF;
    RETURN NEXT;
    RETURN;
  END IF;

  PERFORM set_config('request.jwt.claim.sub', v_seller_user::text, true);

  BEGIN
    SELECT c.new_status::text INTO new_status
    FROM public.verify_delivery_otp_and_complete(v_order, v_code, NULL) c
    LIMIT 1;
    result := 'delivered';
    RETURN NEXT;
  EXCEPTION WHEN OTHERS THEN
    new_status := NULL;
    IF SQLERRM ILIKE '%15 minutes%' THEN
      result := 'locked';
    ELSIF SQLERRM ILIKE '%Invalid delivery code%' THEN
      result := 'invalid';
    ELSE
      result := 'failed';
    END IF;
    RETURN NEXT;
  END;
END;
$function$;

REVOKE ALL ON FUNCTION public.seller_whatsapp_apply_otp(text, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.seller_whatsapp_apply_otp(text, text) TO service_role;
