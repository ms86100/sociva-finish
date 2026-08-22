-- Stable contact debit identity: buyer + store + product (no clock in the charge key).
-- Concurrent contacts in the same debounce window share one ledger reference.

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

  v_hours := COALESCE(NULLIF(public.seller_credit_setting('contact_debounce_hours'), '')::int, 24);
  IF v_hours < 1 OR v_hours > 168 THEN
    v_hours := 24;
  END IF;
  v_product := COALESCE(p_product_id, '00000000-0000-0000-0000-000000000000'::uuid);
  v_ref := 'contact:' || p_seller_id::text || ':' || v_buyer::text || ':' || v_product::text;

  INSERT INTO public.seller_contact_interactions(buyer_id, seller_id, product_id, interaction_type)
  VALUES (v_buyer, p_seller_id, p_product_id, p_interaction_type)
  RETURNING id INTO v_id;

  IF NOT public.seller_credit_spend_active() THEN
    RETURN jsonb_build_object('ok', true, 'interaction_id', v_id, 'charged', false);
  END IF;

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
      UPDATE public.seller_credit_ledger
      SET metadata = jsonb_build_object(
        'buyer_id', v_buyer,
        'product_id', p_product_id,
        'interaction_type', p_interaction_type,
        'debounce_hours', v_hours
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

  RETURN jsonb_build_object('ok', true, 'interaction_id', v_id, 'charged', COALESCE(v_claimed, false));
END;
$$;

CREATE OR REPLACE FUNCTION public.seller_credit_test_contact_claim(
  p_seller_id uuid,
  p_buyer_id uuid,
  p_product_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_claimed boolean := false;
  v_ref text;
  v_hours int := 24;
  v_result jsonb;
BEGIN
  IF current_setting('app.seller_credit_test_spend', true) IS DISTINCT FROM 'on'
     AND NOT EXISTS (
       SELECT 1 FROM public.seller_profiles
       WHERE id = p_seller_id AND business_name LIKE 'CREDIT-VERIFY-%'
     ) THEN
    RAISE EXCEPTION 'credit test harness forbidden';
  END IF;

  PERFORM set_config('app.seller_credit_test_spend', 'on', true);
  v_ref := 'contact:' || p_seller_id::text || ':' || p_buyer_id::text || ':' || p_product_id::text;

  INSERT INTO public.seller_credit_contact_debits(
    seller_id, buyer_id, product_id, window_hours, charged_at, reference_id
  ) VALUES (
    p_seller_id, p_buyer_id, p_product_id, v_hours, now(), v_ref
  )
  ON CONFLICT (seller_id, buyer_id, product_id) DO UPDATE
  SET charged_at = EXCLUDED.charged_at,
      window_hours = EXCLUDED.window_hours,
      reference_id = EXCLUDED.reference_id
  WHERE public.seller_credit_contact_debits.charged_at
        < now() - make_interval(hours => public.seller_credit_contact_debits.window_hours)
  RETURNING true INTO v_claimed;

  IF COALESCE(v_claimed, false) THEN
    v_result := public.record_seller_billable_event(
      p_seller_id, 'CONTACT_REQUEST', 'contact', v_ref, 'charge',
      'Contact request', p_buyer_id
    );
    RETURN jsonb_build_object('ok', true, 'charged', true, 'result', v_result);
  END IF;

  RETURN jsonb_build_object('ok', true, 'charged', false);
END;
$$;

REVOKE ALL ON FUNCTION public.seller_credit_test_contact_claim(uuid, uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.seller_credit_test_contact_claim(uuid, uuid, uuid) TO service_role;
