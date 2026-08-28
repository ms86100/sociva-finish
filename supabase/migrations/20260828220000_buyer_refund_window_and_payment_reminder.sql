-- Buyer refund window (2h after delivery) + seller payment-verify reminder (10 min after buyer confirms)

ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS seller_payment_verify_reminder_at timestamptz;

COMMENT ON COLUMN public.orders.seller_payment_verify_reminder_at IS
  'When the 10-minute payment-verify push/WA reminder was sent to the seller.';

-- ── Refund eligibility helper ────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.get_buyer_refund_eligibility(p_order_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_order record;
  v_anchor timestamptz;
  v_window interval := interval '2 hours';
  v_expires timestamptz;
BEGIN
  SELECT
    o.id,
    o.buyer_id,
    o.status,
    o.payment_status,
    o.delivered_at,
    o.completed_at,
    o.status_changed_at
  INTO v_order
  FROM public.orders o
  WHERE o.id = p_order_id;

  IF v_order IS NULL THEN
    RETURN jsonb_build_object(
      'eligible', false,
      'reason', 'not_found',
      'expires_at', null,
      'window_hours', 2
    );
  END IF;

  IF auth.uid() IS NOT NULL AND v_order.buyer_id IS DISTINCT FROM auth.uid() THEN
    RETURN jsonb_build_object(
      'eligible', false,
      'reason', 'not_buyer',
      'expires_at', null,
      'window_hours', 2
    );
  END IF;

  IF v_order.payment_status NOT IN ('paid', 'buyer_confirmed', 'seller_verified', 'completed') THEN
    RETURN jsonb_build_object(
      'eligible', false,
      'reason', 'no_payment',
      'expires_at', null,
      'window_hours', 2
    );
  END IF;

  IF v_order.status NOT IN ('delivered', 'completed', 'buyer_received') THEN
    RETURN jsonb_build_object(
      'eligible', false,
      'reason', 'not_delivered',
      'expires_at', null,
      'window_hours', 2
    );
  END IF;

  v_anchor := COALESCE(v_order.delivered_at, v_order.completed_at, v_order.status_changed_at);
  IF v_anchor IS NULL THEN
    RETURN jsonb_build_object(
      'eligible', false,
      'reason', 'missing_delivery_timestamp',
      'expires_at', null,
      'window_hours', 2
    );
  END IF;

  v_expires := v_anchor + v_window;
  IF now() > v_expires THEN
    RETURN jsonb_build_object(
      'eligible', false,
      'reason', 'window_closed',
      'expires_at', v_expires,
      'window_hours', 2
    );
  END IF;

  RETURN jsonb_build_object(
    'eligible', true,
    'reason', 'ok',
    'expires_at', v_expires,
    'window_hours', 2
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.get_buyer_refund_eligibility(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_buyer_refund_eligibility(uuid) TO authenticated, service_role;

-- ── request_refund: enforce delivery window ──────────────────────────────────
CREATE OR REPLACE FUNCTION public.request_refund(
  p_order_id uuid,
  p_reason text,
  p_category text DEFAULT 'order_issue'::text,
  p_evidence_urls text[] DEFAULT NULL::text[],
  p_refund_destination text DEFAULT 'original_payment'::text
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_order record;
  v_refund_id uuid;
  v_existing uuid;
  v_seller_user uuid;
  v_dest text;
  v_eligibility jsonb;
  v_valid_categories text[] := ARRAY[
    'order_issue','quality_issue','wrong_item','not_received','seller_cancelled','other'
  ];
BEGIN
  IF p_category IS NULL OR NOT (p_category = ANY(v_valid_categories)) THEN
    RAISE EXCEPTION 'Invalid refund category: %', COALESCE(p_category, 'NULL');
  END IF;

  v_dest := lower(COALESCE(NULLIF(trim(p_refund_destination), ''), 'original_payment'));
  IF v_dest NOT IN ('original_payment', 'wallet') THEN
    RAISE EXCEPTION 'Invalid refund destination: %', v_dest;
  END IF;

  SELECT id, buyer_id, seller_id, society_id, total_amount, frozen_total, payment_status, status,
         payment_type, wallet_cash_amount, wallet_promo_amount
  INTO v_order
  FROM orders
  WHERE id = p_order_id AND buyer_id = auth.uid();

  IF v_order IS NULL THEN
    RAISE EXCEPTION 'Order not found or does not belong to you';
  END IF;

  IF v_order.payment_status NOT IN ('paid', 'buyer_confirmed', 'seller_verified', 'completed') THEN
    RAISE EXCEPTION 'No payment found for this order';
  END IF;

  v_eligibility := public.get_buyer_refund_eligibility(p_order_id);
  IF COALESCE((v_eligibility->>'eligible')::boolean, false) IS NOT TRUE THEN
    IF v_eligibility->>'reason' = 'window_closed' THEN
      RAISE EXCEPTION 'Refund window closed. Refunds must be requested within 2 hours of delivery.';
    ELSIF v_eligibility->>'reason' = 'not_delivered' THEN
      RAISE EXCEPTION 'Refunds can only be requested after the order is delivered';
    ELSE
      RAISE EXCEPTION 'This order is not eligible for a refund request';
    END IF;
  END IF;

  SELECT id INTO v_existing
  FROM refund_requests
  WHERE order_id = p_order_id
    AND refund_state NOT IN ('rejected', 'refund_completed')
  ORDER BY created_at DESC
  LIMIT 1
  FOR UPDATE;

  IF v_existing IS NOT NULL THEN
    RETURN v_existing;
  END IF;

  IF v_dest = 'original_payment'
     AND lower(COALESCE(v_order.payment_type, '')) IN ('cod', 'cash') THEN
    v_dest := 'wallet';
  END IF;

  BEGIN
    INSERT INTO refund_requests (
      order_id, buyer_id, seller_id, society_id, amount, reason, category,
      evidence_urls, refund_method, refund_destination, wallet_credit_amount,
      status, refund_state
    )
    VALUES (
      p_order_id,
      v_order.buyer_id,
      v_order.seller_id,
      v_order.society_id,
      COALESCE(
        NULLIF(v_order.frozen_total, 0),
        COALESCE(v_order.total_amount, 0)
          + COALESCE(v_order.wallet_cash_amount, 0)
          + COALESCE(v_order.wallet_promo_amount, 0)
      ),
      p_reason,
      p_category,
      p_evidence_urls,
      CASE WHEN v_dest = 'wallet' THEN 'wallet' ELSE 'original_payment' END,
      v_dest,
      CASE WHEN v_dest = 'wallet' THEN COALESCE(
        NULLIF(v_order.frozen_total, 0),
        COALESCE(v_order.total_amount, 0)
          + COALESCE(v_order.wallet_cash_amount, 0)
          + COALESCE(v_order.wallet_promo_amount, 0)
      ) ELSE NULL END,
      'requested',
      'requested'
    )
    RETURNING id INTO v_refund_id;
  EXCEPTION
    WHEN unique_violation THEN
      SELECT id INTO v_refund_id
      FROM refund_requests
      WHERE order_id = p_order_id
        AND refund_state NOT IN ('rejected', 'refund_completed')
      ORDER BY created_at DESC
      LIMIT 1;
      IF v_refund_id IS NULL THEN
        RAISE;
      END IF;
      RETURN v_refund_id;
  END;

  IF NOT EXISTS (
    SELECT 1 FROM dispute_tickets
    WHERE order_id = p_order_id AND status != 'resolved'
  ) THEN
    INSERT INTO dispute_tickets (order_id, raised_by, against_user, reason, category, status, society_id)
    VALUES (
      p_order_id,
      auth.uid(),
      (SELECT sp.user_id FROM seller_profiles sp WHERE sp.id = v_order.seller_id),
      p_reason,
      p_category,
      'open',
      v_order.society_id
    );
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
      'refund_request',
      '/seller?tab=refunds&refundId=' || v_refund_id::text,
      jsonb_build_object(
        'orderId', p_order_id,
        'refundId', v_refund_id,
        'status', 'refund_requested',
        'target_role', 'seller',
        'wa_template', 'sociva_refund_update',
        'refund_destination', v_dest
      )
    );
  END IF;

  RETURN v_refund_id;
END;
$function$;

GRANT EXECUTE ON FUNCTION public.request_refund(uuid, text, text, text[], text) TO authenticated, service_role;

-- ── Seller payment-verify reminder (10 min after buyer confirms) ─────────────
CREATE OR REPLACE FUNCTION public.enqueue_seller_payment_verify_reminders()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  r record;
  v_sent int := 0;
  v_item_line text;
  v_title text;
  v_body text;
  v_idem text;
BEGIN
  FOR r IN
    SELECT
      o.id,
      o.buyer_id,
      o.total_amount,
      o.buyer_confirmed_at,
      sp.user_id AS seller_user_id,
      sp.business_name,
      p.name AS buyer_name
    FROM public.orders o
    JOIN public.seller_profiles sp ON sp.id = o.seller_id
    LEFT JOIN public.profiles p ON p.id = o.buyer_id
    WHERE o.payment_status = 'buyer_confirmed'
      AND o.payment_confirmed_by_seller IS NULL
      AND o.buyer_confirmed_at IS NOT NULL
      AND o.buyer_confirmed_at <= now() - interval '10 minutes'
      AND o.seller_payment_verify_reminder_at IS NULL
      AND o.status NOT IN ('cancelled'::order_status)
    FOR UPDATE OF o SKIP LOCKED
  LOOP
    v_item_line := public.seller_order_item_summary(r.id);
    v_title := 'Mark payment received';
    v_body := COALESCE(r.buyer_name, 'Buyer')
      || ' confirmed payment'
      || CASE WHEN COALESCE(r.total_amount, 0) > 0
           THEN ' (Rs ' || trim(to_char(r.total_amount, 'FM9999990')) || ')'
           ELSE ''
         END
      || '. Tap to verify and accept the order.';
    IF v_item_line IS NOT NULL THEN
      v_body := v_item_line || ' · ' || v_body;
    END IF;
    v_idem := md5(r.id::text || '-payment_verify_reminder');

    INSERT INTO public.notification_queue (
      user_id, type, title, body, reference_path, payload, idempotency_key
    )
    VALUES (
      r.seller_user_id,
      'order',
      v_title,
      left(v_body, 240),
      '/orders/' || r.id::text,
      jsonb_build_object(
        'orderId', r.id::text,
        'order_id', r.id::text,
        'status', 'payment_verify_pending',
        'reminder_type', 'payment_verify',
        'type', 'order',
        'target_role', 'seller',
        'buyer_name', COALESCE(r.buyer_name, 'Buyer'),
        'seller_business_name', COALESCE(r.business_name, 'Store'),
        'item_summary', v_item_line,
        'high_priority', true,
        'wa_template', 'sociva_payment_update',
        'action', 'verify_payment',
        'reference_path', '/orders/' || r.id::text
      ),
      v_idem
    )
    ON CONFLICT ON CONSTRAINT idx_notification_queue_idempotency DO NOTHING;

    UPDATE public.orders
    SET seller_payment_verify_reminder_at = now(),
        updated_at = now()
    WHERE id = r.id
      AND seller_payment_verify_reminder_at IS NULL;

    IF FOUND THEN
      v_sent := v_sent + 1;
    END IF;
  END LOOP;

  IF v_sent > 0 THEN
    PERFORM public.fn_wakeup_notification_queue_if_pending();
  END IF;

  RETURN jsonb_build_object('reminders_sent', v_sent);
END;
$function$;

REVOKE ALL ON FUNCTION public.enqueue_seller_payment_verify_reminders() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.enqueue_seller_payment_verify_reminders() TO service_role;

DO $$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT jobid
    FROM cron.job
    WHERE jobname IN (
      'seller_payment_verify_reminder_every_2m',
      'enqueue_seller_payment_verify_reminders'
    )
  LOOP
    PERFORM cron.unschedule(r.jobid);
  END LOOP;
END $$;

SELECT cron.schedule(
  'seller_payment_verify_reminder_every_2m',
  '*/2 * * * *',
  $cron$ SELECT public.enqueue_seller_payment_verify_reminders(); $cron$
);
