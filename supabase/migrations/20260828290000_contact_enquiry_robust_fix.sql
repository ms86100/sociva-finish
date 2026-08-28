-- Contact Enquiry robust fix: unified order + interaction, seller notify, credit integrity, lead inbox.

ALTER TABLE public.seller_contact_interactions
  ADD COLUMN IF NOT EXISTS order_id uuid REFERENCES public.orders(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS conversation_id uuid REFERENCES public.seller_conversations(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'new';

ALTER TABLE public.seller_contact_interactions
  DROP CONSTRAINT IF EXISTS seller_contact_interactions_status_check;

ALTER TABLE public.seller_contact_interactions
  ADD CONSTRAINT seller_contact_interactions_status_check
  CHECK (status IN ('new', 'viewed', 'contacted', 'quoted', 'closed'));

CREATE INDEX IF NOT EXISTS idx_sci_seller_created
  ON public.seller_contact_interactions (seller_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_sci_order_id
  ON public.seller_contact_interactions (order_id)
  WHERE order_id IS NOT NULL;

-- Contact enquiry orders bill via CONTACT_REQUEST on interaction, not ENQUIRY_CREATED on insert.
CREATE OR REPLACE FUNCTION public.seller_credit_on_order_insert()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_event text;
  v_gate jsonb;
BEGIN
  IF NEW.seller_id IS NULL THEN
    RETURN NEW;
  END IF;
  -- contact_enquiry lifecycle orders are billed when buyer initiates contact (CONTACT_REQUEST).
  IF NEW.transaction_type = 'contact_enquiry' THEN
    RETURN NEW;
  END IF;
  v_event := public.seller_credit_event_for_order(NEW);
  IF v_event = 'ENQUIRY_CREATED' THEN
    PERFORM public.record_seller_billable_event(
      NEW.seller_id, v_event, 'order', NEW.id::text, 'charge',
      'New enquiry delivered to seller', NEW.buyer_id
    );
  ELSIF v_event = 'SERVICE_BOOKING' THEN
    v_gate := public.seller_credit_can_accept(NEW.seller_id, v_event);
    IF COALESCE((v_gate->>'ok')::boolean, false) IS NOT TRUE THEN
      RAISE EXCEPTION '%', COALESCE(v_gate->>'reason', public.seller_credit_customer_reason(v_event));
    END IF;
  ELSE
    PERFORM public.record_seller_billable_event(
      NEW.seller_id, v_event, 'order', NEW.id::text, 'reserve',
      'Reserved for successful order', NEW.buyer_id
    );
  END IF;
  RETURN NEW;
END;
$$;

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
BEGIN
  v_key := 'contact_enquiry:' || p_buyer_id::text || ':' || p_seller_id::text || ':' || COALESCE(p_product_id::text, '00000000-0000-0000-0000-000000000000');

  SELECT id INTO v_order
  FROM public.orders
  WHERE buyer_id = p_buyer_id
    AND seller_id = p_seller_id
    AND order_type = 'enquiry'
    AND transaction_type = 'contact_enquiry'
    AND status IN ('enquired', 'quoted')
    AND (
      p_product_id IS NULL
      OR EXISTS (
        SELECT 1 FROM public.order_items oi
        WHERE oi.order_id = orders.id AND oi.product_id = p_product_id
      )
    )
  ORDER BY created_at DESC
  LIMIT 1;

  IF v_order IS NOT NULL THEN
    RETURN v_order;
  END IF;

  SELECT user_id INTO v_seller_user FROM public.seller_profiles WHERE id = p_seller_id;
  IF v_seller_user IS NULL THEN
    RAISE EXCEPTION 'seller not found';
  END IF;

  v_name := COALESCE(NULLIF(btrim(p_product_name), ''), 'listing');

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

CREATE OR REPLACE FUNCTION public.notify_contact_lead_parties(
  p_seller_user_id uuid,
  p_buyer_id uuid,
  p_seller_id uuid,
  p_product_id uuid,
  p_product_name text,
  p_interaction_type text,
  p_order_id uuid,
  p_interaction_id uuid,
  p_conversation_id uuid DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_buyer_name text;
  v_type_label text;
  v_seller_key text;
  v_buyer_key text;
BEGIN
  SELECT name INTO v_buyer_name FROM public.profiles WHERE id = p_buyer_id;
  v_type_label := CASE p_interaction_type WHEN 'call' THEN 'called' ELSE 'messaged' END;

  v_seller_key := 'contact-lead-seller-' || p_interaction_id::text;
  INSERT INTO public.notification_queue (
    user_id, title, body, type, reference_path, payload, idempotency_key
  ) VALUES (
    p_seller_user_id,
    '📞 New contact lead',
    COALESCE(v_buyer_name, 'A buyer') || ' ' || v_type_label || ' about ' || COALESCE(p_product_name, 'your listing') || '.',
    'contact_request',
    '/seller/messages?tab=contacts',
    jsonb_build_object(
      'type', 'contact_request',
      'target_role', 'seller',
      'seller_id', p_seller_id,
      'buyer_id', p_buyer_id,
      'product_id', p_product_id,
      'order_id', p_order_id,
      'interaction_id', p_interaction_id,
      'conversation_id', p_conversation_id,
      'interaction_type', p_interaction_type,
      'wa_template', 'sociva_new_enquiry'
    ),
    v_seller_key
  )
  ON CONFLICT (user_id, idempotency_key) WHERE idempotency_key IS NOT NULL DO NOTHING;

  v_buyer_key := 'contact-lead-buyer-' || p_interaction_id::text;
  INSERT INTO public.notification_queue (
    user_id, title, body, type, reference_path, payload, idempotency_key
  ) VALUES (
    p_buyer_id,
    '✅ Contact request sent',
    'Your contact request reached the seller. They will respond soon.',
    'order_status',
    '/orders/' || p_order_id::text,
    jsonb_build_object(
      'type', 'order_status',
      'target_role', 'buyer',
      'order_id', p_order_id,
      'orderId', p_order_id,
      'status', 'enquired',
      'seller_id', p_seller_id
    ),
    v_buyer_key
  )
  ON CONFLICT (user_id, idempotency_key) WHERE idempotency_key IS NOT NULL DO NOTHING;
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
BEGIN
  IF v_buyer IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;
  IF p_interaction_type NOT IN ('call', 'message') THEN
    RAISE EXCEPTION 'invalid interaction type';
  END IF;

  v_gate := public.seller_credit_can_accept(p_seller_id, 'CONTACT_REQUEST');
  IF COALESCE((v_gate->>'ok')::boolean, false) IS NOT TRUE THEN
    RAISE EXCEPTION '%', COALESCE(v_gate->>'reason', public.seller_credit_customer_reason('CONTACT_REQUEST'));
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

  -- Dedupe rapid duplicate taps (60s window, same type).
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

CREATE OR REPLACE FUNCTION public.mark_contact_interaction_status(
  p_interaction_id uuid,
  p_status text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row public.seller_contact_interactions%ROWTYPE;
BEGIN
  IF p_status NOT IN ('new', 'viewed', 'contacted', 'quoted', 'closed') THEN
    RAISE EXCEPTION 'invalid status';
  END IF;
  SELECT * INTO v_row FROM public.seller_contact_interactions WHERE id = p_interaction_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'interaction not found';
  END IF;
  IF v_row.buyer_id <> auth.uid()
     AND NOT EXISTS (
       SELECT 1 FROM public.seller_profiles sp
       WHERE sp.id = v_row.seller_id AND sp.user_id = auth.uid()
     ) THEN
    RAISE EXCEPTION 'not authorized';
  END IF;
  UPDATE public.seller_contact_interactions
  SET status = p_status
  WHERE id = p_interaction_id;
  RETURN jsonb_build_object('ok', true, 'status', p_status);
END;
$$;

GRANT EXECUTE ON FUNCTION public.mark_contact_interaction_status(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.log_seller_contact_interaction(uuid, uuid, text) TO authenticated, service_role;
