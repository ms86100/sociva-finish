-- A new contact must not reuse a weeks-old enquiry, and a cancelled
-- enquiry must not keep the idempotency key that blocks the next one.
-- A repeat inside the free window must not be stopped by the credit gate.

CREATE OR REPLACE FUNCTION public.ensure_contact_enquiry_order(
  p_buyer_id uuid,
  p_seller_id uuid,
  p_product_id uuid,
  p_product_name text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_order uuid;
  v_key text;
  v_seller_user uuid;
  v_name text;
  v_hours int;
BEGIN
  v_hours := COALESCE(NULLIF(public.seller_credit_setting('contact_debounce_hours'), '')::int, 24);
  IF v_hours < 1 OR v_hours > 168 THEN
    v_hours := 24;
  END IF;

  v_key := 'contact_enquiry:' || p_buyer_id::text || ':' || p_seller_id::text || ':' || COALESCE(p_product_id::text, '00000000-0000-0000-0000-000000000000');

  SELECT id INTO v_order
  FROM public.orders
  WHERE buyer_id = p_buyer_id
    AND seller_id = p_seller_id
    AND order_type = 'enquiry'
    AND transaction_type = 'contact_enquiry'
    AND status IN ('enquired', 'quoted')
    AND COALESCE(updated_at, created_at) > now() - make_interval(hours => v_hours)
    AND (
      p_product_id IS NULL
      OR EXISTS (
        SELECT 1 FROM public.order_items oi
        WHERE oi.order_id = orders.id AND oi.product_id = p_product_id
      )
    )
  ORDER BY COALESCE(updated_at, created_at) DESC
  LIMIT 1;

  IF v_order IS NOT NULL THEN
    RETURN v_order;
  END IF;

  SELECT user_id INTO v_seller_user FROM public.seller_profiles WHERE id = p_seller_id;
  IF v_seller_user IS NULL THEN
    RAISE EXCEPTION 'seller not found';
  END IF;

  v_name := COALESCE(NULLIF(btrim(p_product_name), ''), 'listing');

  -- A cancelled or stale enquiry still owns the stable key. A new row needs its own key.
  IF EXISTS (
    SELECT 1 FROM public.orders
    WHERE buyer_id = p_buyer_id AND idempotency_key = v_key
  ) THEN
    v_key := v_key || ':' || gen_random_uuid()::text;
  END IF;

  INSERT INTO public.orders(
    buyer_id, seller_id, total_amount, order_type, status, transaction_type,
    notes, idempotency_key
  ) VALUES (
    p_buyer_id, p_seller_id, 0, 'enquiry', 'enquired', 'contact_enquiry',
    'Contact enquiry for: ' || v_name,
    v_key
  )
  RETURNING id INTO v_order;

  IF p_product_id IS NOT NULL THEN
    INSERT INTO public.order_items(order_id, product_id, product_name, quantity, unit_price)
    VALUES (v_order, p_product_id, v_name, 1, 0);
  END IF;

  INSERT INTO public.chat_messages(order_id, sender_id, receiver_id, message_text)
  VALUES (
    v_order, p_buyer_id, v_seller_user,
    'Contact enquiry started for "' || v_name || '".'
  );

  RETURN v_order;
END;
$$;

CREATE OR REPLACE FUNCTION public.log_seller_contact_interaction(
  p_seller_id uuid,
  p_product_id uuid,
  p_interaction_type text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_buyer uuid := auth.uid();
  v_id uuid;
  v_gate jsonb;
  v_hours int;
  v_product uuid;
  v_claimed boolean := false;
  v_ref text;
  v_order uuid;
  v_conv uuid;
  v_seller_user uuid;
  v_product_name text;
  v_phone text;
  v_recent uuid;
  v_charged boolean := false;
  v_in_window boolean := false;
BEGIN
  IF v_buyer IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;
  IF p_interaction_type NOT IN ('call', 'message') THEN
    RAISE EXCEPTION 'invalid interaction type';
  END IF;

  SELECT name, contact_phone INTO v_product_name, v_phone
  FROM public.products
  WHERE id = p_product_id;

  IF v_phone IS NULL OR btrim(v_phone) = '' THEN
    SELECT p.phone INTO v_phone
    FROM public.seller_profiles sp
    JOIN public.profiles p ON p.id = sp.user_id
    WHERE sp.id = p_seller_id;
  END IF;

  IF v_phone IS NULL OR btrim(v_phone) = '' THEN
    RAISE EXCEPTION 'Seller phone not available';
  END IF;

  SELECT id INTO v_recent
  FROM public.seller_contact_interactions
  WHERE buyer_id = v_buyer
    AND seller_id = p_seller_id
    AND product_id IS NOT DISTINCT FROM p_product_id
    AND interaction_type = p_interaction_type
    AND created_at > now() - interval '60 seconds'
  ORDER BY created_at DESC
  LIMIT 1;

  IF v_recent IS NOT NULL THEN
    SELECT order_id, conversation_id INTO v_order, v_conv
    FROM public.seller_contact_interactions WHERE id = v_recent;
    RETURN jsonb_build_object(
      'ok', true,
      'interaction_id', v_recent,
      'order_id', v_order,
      'conversation_id', v_conv,
      'phone', v_phone,
      'charged', false,
      'deduped', true
    );
  END IF;

  v_hours := COALESCE(NULLIF(public.seller_credit_setting('contact_debounce_hours'), '')::int, 24);
  IF v_hours < 1 OR v_hours > 168 THEN
    v_hours := 24;
  END IF;
  v_product := COALESCE(p_product_id, '00000000-0000-0000-0000-000000000000'::uuid);
  v_ref := 'contact:' || p_seller_id::text || ':' || v_buyer::text || ':' || v_product::text;

  SELECT d.charged_at >= now() - make_interval(hours => d.window_hours)
  INTO v_in_window
  FROM public.seller_credit_contact_debits d
  WHERE d.seller_id = p_seller_id
    AND d.buyer_id = v_buyer
    AND d.product_id = v_product;

  IF NOT COALESCE(v_in_window, false) THEN
    v_gate := public.seller_credit_can_accept(p_seller_id, 'CONTACT_REQUEST');
    IF COALESCE((v_gate->>'ok')::boolean, false) IS NOT TRUE THEN
      RAISE EXCEPTION '%', COALESCE(v_gate->>'reason', public.seller_credit_customer_reason('CONTACT_REQUEST'));
    END IF;
  END IF;

  v_order := public.ensure_contact_enquiry_order(v_buyer, p_seller_id, p_product_id, v_product_name);

  IF p_interaction_type = 'message' THEN
    INSERT INTO public.seller_conversations (buyer_id, seller_id, product_id)
    VALUES (v_buyer, p_seller_id, p_product_id)
    ON CONFLICT (buyer_id, seller_id, product_id) DO UPDATE
      SET last_message_at = now()
    RETURNING id INTO v_conv;
  END IF;

  INSERT INTO public.seller_contact_interactions(
    buyer_id, seller_id, product_id, interaction_type, order_id, conversation_id, status
  )
  VALUES (v_buyer, p_seller_id, p_product_id, p_interaction_type, v_order, v_conv, 'new')
  RETURNING id INTO v_id;

  IF public.seller_credit_spend_active() THEN
    PERFORM public.seller_credit_ensure_account(p_seller_id);

    INSERT INTO public.seller_credit_contact_debits(
      seller_id, buyer_id, product_id, window_hours, charged_at, reference_id
    ) VALUES (
      p_seller_id, v_buyer, v_product, v_hours, now(), v_ref
    )
    ON CONFLICT (seller_id, buyer_id, product_id) DO UPDATE
    SET charged_at = EXCLUDED.charged_at,
        window_hours = EXCLUDED.window_hours,
        reference_id = EXCLUDED.reference_id
    WHERE public.seller_credit_contact_debits.charged_at
          < now() - make_interval(hours => public.seller_credit_contact_debits.window_hours)
    RETURNING true INTO v_claimed;

    IF COALESCE(v_claimed, false) THEN
      BEGIN
        PERFORM public.record_seller_billable_event(
          p_seller_id, 'CONTACT_REQUEST', 'contact', v_ref, 'charge',
          'Contact request', v_buyer
        );
        v_charged := true;
        UPDATE public.seller_credit_ledger
        SET metadata = jsonb_build_object(
          'buyer_id', v_buyer,
          'product_id', p_product_id,
          'interaction_type', p_interaction_type,
          'debounce_hours', v_hours,
          'order_id', v_order
        )
        WHERE seller_id = p_seller_id
          AND type = 'event_charge'
          AND event_type = 'CONTACT_REQUEST'
          AND reference_id = v_ref;
      EXCEPTION WHEN others THEN
        IF SQLERRM LIKE 'SELLER_CREDIT_INSUFFICIENT%' THEN
          DELETE FROM public.seller_credit_contact_debits
          WHERE seller_id = p_seller_id AND buyer_id = v_buyer AND product_id = v_product
            AND reference_id = v_ref;
          DELETE FROM public.seller_contact_interactions WHERE id = v_id;
          RAISE;
        END IF;
        RAISE;
      END;
    END IF;
  END IF;

  SELECT user_id INTO v_seller_user FROM public.seller_profiles WHERE id = p_seller_id;
  IF v_seller_user IS NOT NULL THEN
    PERFORM public.notify_contact_lead_parties(
      v_seller_user, v_buyer, p_seller_id, p_product_id, v_product_name,
      p_interaction_type, v_order, v_id, v_conv
    );
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'interaction_id', v_id,
    'order_id', v_order,
    'conversation_id', v_conv,
    'phone', v_phone,
    'charged', v_charged,
    'product_name', v_product_name
  );
END;
$$;
