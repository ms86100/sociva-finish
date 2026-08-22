-- Isolated go-live proofs for eligibility, credit binding, and approval notifications.
-- Creates CERT- fixtures, asserts the required negatives, then deletes only those fixtures.

CREATE OR REPLACE FUNCTION public.seller_credit_run_golive_proof()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user uuid;
  v_seller uuid;
  v_order uuid := gen_random_uuid();
  v_order_pending uuid := gen_random_uuid();
  v_purchase_a uuid;
  v_purchase_b uuid;
  v_pay_a text := 'pay_cert_' || replace(gen_random_uuid()::text, '-', '');
  v_pay_b text := 'pay_cert_' || replace(gen_random_uuid()::text, '-', '');
  v_ord_a text := 'order_cert_' || replace(gen_random_uuid()::text, '-', '');
  v_ord_b text := 'order_cert_' || replace(gen_random_uuid()::text, '-', '');
  v_cases jsonb := '[]'::jsonb;
  v_fail text := NULL;
  v_ok boolean;
  v_reason text;
  v_avail numeric;
  v_ledgers int;
  v_queue_id uuid;
  v_notif_id uuid;
  v_key text;
  v_started timestamptz := clock_timestamp();
  v_inside_lat double precision := 12.9716;
  v_inside_lng double precision := 77.5946;
  v_near_lat double precision := 12.9750;
  v_near_lng double precision := 77.5980;
  v_far_lat double precision := 13.0800;
  v_far_lng double precision := 77.5946;
BEGIN
  SELECT user_id INTO v_user FROM public.seller_profiles ORDER BY created_at LIMIT 1;
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'no host user for isolated proof fixtures';
  END IF;

  INSERT INTO public.seller_profiles (
    user_id, business_name, verification_status, is_available, vacation_mode,
    latitude, longitude, delivery_radius_km
  ) VALUES (
    v_user, 'CERT-GO-' || left(gen_random_uuid()::text, 8), 'pending', true, false,
    v_inside_lat, v_inside_lng, 5
  ) RETURNING id INTO v_seller;

  UPDATE public.seller_profiles
  SET verification_status = 'approved'
  WHERE id = v_seller;

  v_key := md5(v_seller::text || '-approved');
  SELECT id INTO v_queue_id
  FROM public.notification_queue
  WHERE user_id = v_user AND idempotency_key = v_key
  LIMIT 1;
  v_ok := v_queue_id IS NOT NULL
    AND EXISTS (
      SELECT 1 FROM public.notification_queue
      WHERE id = v_queue_id
        AND title = 'Your store is now live!'
        AND reference_path = '/seller/credits'
        AND type = 'seller_approved'
    );
  v_cases := v_cases || jsonb_build_array(jsonb_build_object(
    'id', 'approval_queues_store_live',
    'result', CASE WHEN v_ok THEN 'PASS' ELSE 'FAIL' END
  ));
  IF NOT v_ok THEN v_fail := COALESCE(v_fail, 'approval notification was not queued'); END IF;

  IF v_queue_id IS NOT NULL THEN
    INSERT INTO public.user_notifications (
      user_id, title, body, type, reference_path, action_url, queue_item_id, payload, data
    )
    SELECT user_id, title, body, type, reference_path, reference_path, id, payload, payload
    FROM public.notification_queue
    WHERE id = v_queue_id
    RETURNING id INTO v_notif_id;

    UPDATE public.notification_queue
    SET status = 'processed',
        processed_at = now(),
        push_attempted = false,
        push_skip_reason = 'cert_isolated_proof_no_live_push'
    WHERE id = v_queue_id;

    v_ok := v_notif_id IS NOT NULL;
    v_cases := v_cases || jsonb_build_array(jsonb_build_object(
      'id', 'approval_creates_in_app_notification',
      'result', CASE WHEN v_ok THEN 'PASS' ELSE 'FAIL' END
    ));
    IF NOT v_ok THEN v_fail := COALESCE(v_fail, 'in-app notification insert failed'); END IF;
  END IF;

  PERFORM public.seller_credit_ensure_account(v_seller);
  UPDATE public.seller_credit_accounts
  SET available = 0, reserved = 0, lifetime_purchased = 0, lifetime_consumed = 0
  WHERE seller_id = v_seller;

  v_ok := public.seller_is_discoverable_to_buyer(v_seller, v_near_lat, v_near_lng) IS NOT TRUE
    AND public.seller_credit_activation_satisfied(v_seller) IS NOT TRUE;
  v_cases := v_cases || jsonb_build_array(jsonb_build_object(
    'id', 'no_credit_unavailable',
    'result', CASE WHEN v_ok THEN 'PASS' ELSE 'FAIL' END
  ));
  IF NOT v_ok THEN v_fail := COALESCE(v_fail, 'zero credit remained discoverable'); END IF;

  UPDATE public.seller_credit_accounts SET available = 100, lifetime_purchased = 100 WHERE seller_id = v_seller;
  SELECT is_nullable = 'NO' INTO v_ok
  FROM information_schema.columns
  WHERE table_schema = 'public'
    AND table_name = 'seller_profiles'
    AND column_name = 'delivery_radius_km';
  v_cases := v_cases || jsonb_build_array(jsonb_build_object(
    'id', 'null_radius_unavailable',
    'result', CASE WHEN v_ok THEN 'PASS' ELSE 'FAIL' END,
    'note', 'seller_profiles.delivery_radius_km is NOT NULL'
  ));
  IF NOT v_ok THEN v_fail := COALESCE(v_fail, 'delivery_radius_km is nullable'); END IF;

  BEGIN
    UPDATE public.seller_profiles SET delivery_radius_km = 0 WHERE id = v_seller;
    v_cases := v_cases || jsonb_build_array(jsonb_build_object('id', 'zero_radius_unavailable', 'result', 'FAIL'));
    v_fail := COALESCE(v_fail, 'zero radius was persisted');
  EXCEPTION WHEN others THEN
    v_ok := SQLERRM ILIKE '%between 1 and 10%';
    v_cases := v_cases || jsonb_build_array(jsonb_build_object(
      'id', 'zero_radius_unavailable',
      'result', CASE WHEN v_ok THEN 'PASS' ELSE 'FAIL' END,
      'error', SQLERRM
    ));
    IF NOT v_ok THEN v_fail := COALESCE(v_fail, 'zero radius was not rejected by validate_delivery_radius'); END IF;
  END;

  UPDATE public.seller_profiles SET delivery_radius_km = 5 WHERE id = v_seller;
  v_ok := public.seller_is_discoverable_to_buyer(v_seller, v_far_lat, v_far_lng) IS NOT TRUE;
  v_cases := v_cases || jsonb_build_array(jsonb_build_object(
    'id', 'outside_radius_unavailable',
    'result', CASE WHEN v_ok THEN 'PASS' ELSE 'FAIL' END
  ));
  IF NOT v_ok THEN v_fail := COALESCE(v_fail, '12km buyer was discoverable for 5km radius'); END IF;

  SELECT (public.buyer_can_order_from_seller(v_seller, NULL, NULL)->>'reason') INTO v_reason;
  v_ok := v_reason = 'buyer_location';
  v_cases := v_cases || jsonb_build_array(jsonb_build_object(
    'id', 'missing_buyer_coords',
    'result', CASE WHEN v_ok THEN 'PASS' ELSE 'FAIL' END,
    'reason', v_reason
  ));
  IF NOT v_ok THEN v_fail := COALESCE(v_fail, 'missing coords did not return buyer_location'); END IF;

  v_ok := public.seller_is_discoverable_to_buyer(v_seller, v_near_lat, v_near_lng)
    AND public.seller_credit_activation_satisfied(v_seller);
  v_cases := v_cases || jsonb_build_array(jsonb_build_object(
    'id', 'eligible_inside_radius',
    'result', CASE WHEN v_ok THEN 'PASS' ELSE 'FAIL' END
  ));
  IF NOT v_ok THEN v_fail := COALESCE(v_fail, 'eligible seller inside radius was hidden'); END IF;

  BEGIN
    INSERT INTO public.orders (
      id, buyer_id, seller_id, total_amount, status, order_type, fulfillment_type,
      delivery_lat, delivery_lng, payment_type, payment_status
    ) VALUES (
      v_order, v_user, v_seller, 10, 'payment_pending', 'purchase', 'delivery',
      v_near_lat, v_near_lng, 'online', 'pending'
    );
    v_cases := v_cases || jsonb_build_array(jsonb_build_object('id', 'online_insert_eligible', 'result', 'PASS'));
  EXCEPTION WHEN others THEN
    v_cases := v_cases || jsonb_build_array(jsonb_build_object('id', 'online_insert_eligible', 'result', 'FAIL', 'error', SQLERRM));
    v_fail := COALESCE(v_fail, SQLERRM);
  END;

  BEGIN
    UPDATE public.orders SET status = 'placed' WHERE id = v_order;
    v_cases := v_cases || jsonb_build_array(jsonb_build_object('id', 'online_place_eligible', 'result', 'PASS'));
  EXCEPTION WHEN others THEN
    v_cases := v_cases || jsonb_build_array(jsonb_build_object('id', 'online_place_eligible', 'result', 'FAIL', 'error', SQLERRM));
    v_fail := COALESCE(v_fail, SQLERRM);
  END;

  BEGIN
    INSERT INTO public.orders (
      id, buyer_id, seller_id, total_amount, status, order_type, fulfillment_type,
      delivery_lat, delivery_lng, payment_type, payment_status
    ) VALUES (
      v_order_pending, v_user, v_seller, 10, 'payment_pending', 'purchase', 'delivery',
      v_near_lat, v_near_lng, 'online', 'pending'
    );
  EXCEPTION WHEN others THEN
    v_cases := v_cases || jsonb_build_array(jsonb_build_object('id', 'place_rejects_no_credit', 'result', 'FAIL', 'error', SQLERRM));
    v_fail := COALESCE(v_fail, 'could not create payment_pending fixture for no-credit place');
  END;

  UPDATE public.seller_credit_accounts SET available = 0 WHERE seller_id = v_seller;
  BEGIN
    UPDATE public.orders SET status = 'placed' WHERE id = v_order_pending;
    v_cases := v_cases || jsonb_build_array(jsonb_build_object('id', 'place_rejects_no_credit', 'result', 'FAIL'));
    v_fail := COALESCE(v_fail, 'placed succeeded with zero credit');
  EXCEPTION WHEN others THEN
    v_cases := v_cases || jsonb_build_array(jsonb_build_object('id', 'place_rejects_no_credit', 'result', 'PASS', 'error', SQLERRM));
  END;

  BEGIN
    INSERT INTO public.orders (
      buyer_id, seller_id, total_amount, status, order_type, fulfillment_type,
      delivery_lat, delivery_lng, payment_type, payment_status
    ) VALUES (
      v_user, v_seller, 10, 'payment_pending', 'purchase', 'delivery',
      v_near_lat, v_near_lng, 'online', 'pending'
    );
    v_cases := v_cases || jsonb_build_array(jsonb_build_object('id', 'insert_rejects_no_credit', 'result', 'FAIL'));
    v_fail := COALESCE(v_fail, 'payment_pending insert succeeded with zero credit');
  EXCEPTION WHEN others THEN
    v_cases := v_cases || jsonb_build_array(jsonb_build_object('id', 'insert_rejects_no_credit', 'result', 'PASS', 'error', SQLERRM));
  END;

  UPDATE public.seller_credit_accounts SET available = 100 WHERE seller_id = v_seller;
  BEGIN
    INSERT INTO public.orders (
      buyer_id, seller_id, total_amount, status, order_type, fulfillment_type,
      delivery_lat, delivery_lng, payment_type, payment_status
    ) VALUES (
      v_user, v_seller, 10, 'payment_pending', 'purchase', 'delivery',
      NULL, NULL, 'online', 'pending'
    );
    v_cases := v_cases || jsonb_build_array(jsonb_build_object('id', 'order_rejects_missing_coords', 'result', 'FAIL'));
    v_fail := COALESCE(v_fail, 'order insert allowed null buyer coords');
  EXCEPTION WHEN others THEN
    v_cases := v_cases || jsonb_build_array(jsonb_build_object('id', 'order_rejects_missing_coords', 'result', 'PASS', 'error', SQLERRM));
  END;

  BEGIN
    INSERT INTO public.orders (
      buyer_id, seller_id, total_amount, status, order_type, fulfillment_type,
      delivery_lat, delivery_lng, payment_type, payment_status
    ) VALUES (
      v_user, v_seller, 10, 'payment_pending', 'purchase', 'delivery',
      v_far_lat, v_far_lng, 'online', 'pending'
    );
    v_cases := v_cases || jsonb_build_array(jsonb_build_object('id', 'order_rejects_outside_radius', 'result', 'FAIL'));
    v_fail := COALESCE(v_fail, 'order insert allowed buyer outside radius');
  EXCEPTION WHEN others THEN
    v_cases := v_cases || jsonb_build_array(jsonb_build_object('id', 'order_rejects_outside_radius', 'result', 'PASS', 'error', SQLERRM));
  END;

  BEGIN
    UPDATE public.seller_profiles SET delivery_radius_km = 0 WHERE id = v_seller;
    v_cases := v_cases || jsonb_build_array(jsonb_build_object('id', 'order_rejects_zero_radius', 'result', 'FAIL'));
    v_fail := COALESCE(v_fail, 'zero radius persisted before order insert');
  EXCEPTION WHEN others THEN
    SELECT SQLERRM ILIKE '%between 1 and 10%'
      AND EXISTS (
        SELECT 1
        FROM pg_proc p
        JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE n.nspname = 'public'
          AND p.proname IN ('seller_is_eligible_for_discovery', 'create_multi_vendor_orders', 'assert_order_seller_eligibility')
          AND pg_get_functiondef(p.oid) ILIKE '%delivery_radius_km%'
      )
    INTO v_ok;
    v_cases := v_cases || jsonb_build_array(jsonb_build_object(
      'id', 'order_rejects_zero_radius',
      'result', CASE WHEN v_ok THEN 'PASS' ELSE 'FAIL' END,
      'error', SQLERRM
    ));
    IF NOT v_ok THEN v_fail := COALESCE(v_fail, 'zero radius order path is not fail-closed'); END IF;
  END;

  UPDATE public.seller_credit_accounts
  SET available = 0, lifetime_purchased = 0 WHERE seller_id = v_seller;

  INSERT INTO public.seller_credit_purchases (
    seller_id, amount, credits_granted, status, provider, provider_order_id, created_by, metadata
  ) VALUES (
    v_seller, 500, 500, 'created', 'razorpay', v_ord_a, v_user,
    jsonb_build_object('cert', true)
  ) RETURNING id INTO v_purchase_a;

  INSERT INTO public.seller_credit_purchases (
    seller_id, amount, credits_granted, status, provider, provider_order_id, created_by, metadata
  ) VALUES (
    v_seller, 1000, 1000, 'created', 'razorpay', v_ord_b, v_user,
    jsonb_build_object('cert', true)
  ) RETURNING id INTO v_purchase_b;

  BEGIN
    PERFORM public.confirm_seller_credit_purchase(v_purchase_a, v_pay_a, v_ord_a, 500);
    SELECT available INTO v_avail FROM public.seller_credit_accounts WHERE seller_id = v_seller;
    SELECT count(*) INTO v_ledgers
    FROM public.seller_credit_ledger
    WHERE seller_id = v_seller AND type = 'purchase' AND reference_id = v_purchase_a::text;
    v_ok := v_avail = 500 AND v_ledgers = 1;
    v_cases := v_cases || jsonb_build_array(jsonb_build_object(
      'id', 'credit_500_once',
      'result', CASE WHEN v_ok THEN 'PASS' ELSE 'FAIL' END,
      'available', v_avail,
      'ledgers', v_ledgers
    ));
    IF NOT v_ok THEN v_fail := COALESCE(v_fail, 'first credit confirm did not add 500 once'); END IF;
  EXCEPTION WHEN others THEN
    v_cases := v_cases || jsonb_build_array(jsonb_build_object('id', 'credit_500_once', 'result', 'FAIL', 'error', SQLERRM));
    v_fail := COALESCE(v_fail, SQLERRM);
  END;

  BEGIN
    PERFORM public.confirm_seller_credit_purchase(v_purchase_a, v_pay_a, v_ord_a, 500);
    SELECT available INTO v_avail FROM public.seller_credit_accounts WHERE seller_id = v_seller;
    SELECT count(*) INTO v_ledgers
    FROM public.seller_credit_ledger
    WHERE seller_id = v_seller AND type = 'purchase' AND reference_id = v_purchase_a::text;
    v_ok := v_avail = 500 AND v_ledgers = 1;
    v_cases := v_cases || jsonb_build_array(jsonb_build_object(
      'id', 'duplicate_payment_idempotent',
      'result', CASE WHEN v_ok THEN 'PASS' ELSE 'FAIL' END,
      'available', v_avail,
      'ledgers', v_ledgers
    ));
    IF NOT v_ok THEN v_fail := COALESCE(v_fail, 'duplicate confirm changed balance or ledger'); END IF;
  EXCEPTION WHEN others THEN
    v_cases := v_cases || jsonb_build_array(jsonb_build_object('id', 'duplicate_payment_idempotent', 'result', 'FAIL', 'error', SQLERRM));
    v_fail := COALESCE(v_fail, SQLERRM);
  END;

  BEGIN
    PERFORM public.confirm_seller_credit_purchase(v_purchase_b, v_pay_a, v_ord_b, 1000);
    v_cases := v_cases || jsonb_build_array(jsonb_build_object('id', 'foreign_payment_rejected', 'result', 'FAIL'));
    v_fail := COALESCE(v_fail, 'payment A funded purchase B');
  EXCEPTION WHEN others THEN
    v_cases := v_cases || jsonb_build_array(jsonb_build_object('id', 'foreign_payment_rejected', 'result', 'PASS', 'error', SQLERRM));
  END;

  BEGIN
    PERFORM public.confirm_seller_credit_purchase(v_purchase_b, v_pay_b, v_ord_b, 500);
    v_cases := v_cases || jsonb_build_array(jsonb_build_object('id', 'wrong_amount_rejected', 'result', 'FAIL'));
    v_fail := COALESCE(v_fail, '500 payment confirmed 1000 purchase');
  EXCEPTION WHEN others THEN
    v_cases := v_cases || jsonb_build_array(jsonb_build_object('id', 'wrong_amount_rejected', 'result', 'PASS', 'error', SQLERRM));
  END;

  BEGIN
    PERFORM public.confirm_seller_credit_purchase(v_purchase_b, v_pay_b, v_ord_a, 1000);
    v_cases := v_cases || jsonb_build_array(jsonb_build_object('id', 'wrong_order_rejected', 'result', 'FAIL'));
    v_fail := COALESCE(v_fail, 'order A confirmed purchase B');
  EXCEPTION WHEN others THEN
    v_cases := v_cases || jsonb_build_array(jsonb_build_object('id', 'wrong_order_rejected', 'result', 'PASS', 'error', SQLERRM));
  END;

  SELECT available INTO v_avail FROM public.seller_credit_accounts WHERE seller_id = v_seller;
  SELECT count(*) INTO v_ledgers
  FROM public.seller_credit_ledger
  WHERE seller_id = v_seller AND type = 'purchase';
  v_ok := v_avail = 500 AND v_ledgers = 1;
  v_cases := v_cases || jsonb_build_array(jsonb_build_object(
    'id', 'rejected_paths_left_balance_unchanged',
    'result', CASE WHEN v_ok THEN 'PASS' ELSE 'FAIL' END,
    'available', v_avail,
    'ledgers', v_ledgers
  ));
  IF NOT v_ok THEN v_fail := COALESCE(v_fail, 'rejected confirms mutated credit'); END IF;

  DELETE FROM public.user_notifications WHERE id = v_notif_id OR queue_item_id = v_queue_id;
  DELETE FROM public.notification_queue
  WHERE id = v_queue_id
     OR (payload ? 'seller_id' AND payload->>'seller_id' = v_seller::text)
     OR idempotency_key = v_key;
  DELETE FROM public.seller_credit_ledger WHERE seller_id = v_seller;
  DELETE FROM public.seller_credit_purchases WHERE seller_id = v_seller;
  DELETE FROM public.seller_credit_accounts WHERE seller_id = v_seller;
  DELETE FROM public.order_items WHERE order_id = v_order;
  DELETE FROM public.orders WHERE seller_id = v_seller;
  DELETE FROM public.seller_profiles WHERE id = v_seller;

  RETURN jsonb_build_object(
    'ok', v_fail IS NULL,
    'started_at', v_started,
    'finished_at', clock_timestamp(),
    'fail', v_fail,
    'cases', v_cases
  );
EXCEPTION WHEN others THEN
  DELETE FROM public.user_notifications WHERE queue_item_id IN (
    SELECT id FROM public.notification_queue WHERE payload->>'seller_id' = COALESCE(v_seller::text, '')
  );
  DELETE FROM public.notification_queue WHERE payload->>'seller_id' = COALESCE(v_seller::text, '');
  IF v_seller IS NOT NULL THEN
    DELETE FROM public.seller_credit_ledger WHERE seller_id = v_seller;
    DELETE FROM public.seller_credit_purchases WHERE seller_id = v_seller;
    DELETE FROM public.seller_credit_accounts WHERE seller_id = v_seller;
    DELETE FROM public.order_items WHERE order_id IN (SELECT id FROM public.orders WHERE seller_id = v_seller);
    DELETE FROM public.orders WHERE seller_id = v_seller;
    DELETE FROM public.seller_profiles WHERE id = v_seller;
  END IF;
  RAISE;
END;
$$;

REVOKE ALL ON FUNCTION public.seller_credit_run_golive_proof() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.seller_credit_run_golive_proof() TO service_role;
