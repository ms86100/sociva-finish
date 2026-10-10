-- Seller order alerts must leave a durable row.
-- A committed order either has a notification_queue row or a notification_failures row.
-- Payload format is unchanged by this file. Android data-only is a separate per-token gate.

CREATE TABLE IF NOT EXISTS public.notification_failures (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid,
  seller_user_id uuid,
  stage text NOT NULL DEFAULT 'enqueue',
  error text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_notification_failures_order
  ON public.notification_failures (order_id, created_at DESC);

ALTER TABLE public.notification_failures ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.notification_failures FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT ON TABLE public.notification_failures TO service_role;

CREATE INDEX IF NOT EXISTS idx_notification_queue_due
  ON public.notification_queue (created_at)
  WHERE status IN ('pending', 'blocked');

CREATE OR REPLACE FUNCTION public.enqueue_seller_new_order_notification(p_order_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_order public.orders;
  v_seller_user_id uuid;
  v_seller_business_name text;
  v_buyer_name text;
  v_buyer_flat_no text;
  v_order_items jsonb;
  v_item_line text;
  v_location text;
  v_amount numeric;
  v_title text;
  v_body text;
  v_idem_key text;
BEGIN
  SELECT * INTO v_order FROM public.orders WHERE id = p_order_id;
  IF NOT FOUND THEN
    RETURN;
  END IF;

  IF v_order.status IN ('payment_pending', 'cancelled') THEN
    RETURN;
  END IF;

  SELECT sp.user_id, sp.business_name INTO v_seller_user_id, v_seller_business_name
  FROM public.seller_profiles sp WHERE sp.id = v_order.seller_id;

  IF v_seller_user_id IS NULL THEN
    INSERT INTO public.notification_failures (order_id, seller_user_id, stage, error)
    VALUES (p_order_id, NULL, 'enqueue', 'seller user id missing');
    RETURN;
  END IF;

  SELECT p.name, p.flat_number INTO v_buyer_name, v_buyer_flat_no
  FROM public.profiles p WHERE p.id = v_order.buyer_id;

  SELECT jsonb_agg(jsonb_build_object(
    'product_name', p.name,
    'quantity', oi.quantity,
    'unit_price', oi.unit_price,
    'total_price', oi.quantity * oi.unit_price
  )) INTO v_order_items
  FROM public.order_items oi
  JOIN public.products p ON p.id = oi.product_id
  WHERE oi.order_id = v_order.id;

  IF v_order_items IS NULL THEN
    v_order_items := '[]'::jsonb;
  END IF;

  v_item_line := public.seller_order_item_summary(v_order.id);
  v_location := public.seller_order_buyer_location_summary(
    v_order.seller_id,
    v_order.buyer_id,
    v_order.delivery_address,
    v_order.delivery_lat,
    v_order.delivery_lng,
    v_order.society_id
  );
  v_amount := v_order.total_amount;
  v_idem_key := md5(v_order.id::text || '-new_order-' || v_order.status::text);

  v_title := CASE
    WHEN v_item_line IS NOT NULL THEN left('New order: ' || v_item_line, 65)
    ELSE 'New order received'
  END;

  v_body := COALESCE(v_item_line, 'New order');
  IF COALESCE(v_amount, 0) > 0 THEN
    v_body := v_body || ' - Rs ' || trim(to_char(v_amount, 'FM9999990'));
  END IF;
  v_body := v_body || ' - ' || COALESCE(v_buyer_name, 'Customer');
  IF v_location IS NOT NULL THEN
    v_body := v_body || ' - ' || v_location;
  END IF;
  v_body := v_body || '. Tap to review and accept.';

  BEGIN
    INSERT INTO public.notification_queue (
      user_id, type, title, body, reference_path, payload, idempotency_key
    )
    VALUES (
      v_seller_user_id,
      'order',
      v_title,
      left(v_body, 240),
      '/orders/' || v_order.id::text,
      jsonb_build_object(
        'orderId', v_order.id::text,
        'order_id', v_order.id::text,
        'status', v_order.status::text,
        'type', 'order',
        'target_role', 'seller',
        'wa_template', 'sociva_new_order_seller',
        'buyer_name', COALESCE(v_buyer_name, 'Customer'),
        'seller_business_name', COALESCE(v_seller_business_name, 'Store'),
        'seller_flat_number', COALESCE(v_buyer_flat_no, ''),
        'buyer_location', v_location,
        'item_summary', v_item_line,
        'items', v_order_items,
        'item_count', COALESCE(jsonb_array_length(v_order_items), 0)
      ),
      v_idem_key
    )
    ON CONFLICT (user_id, idempotency_key) WHERE idempotency_key IS NOT NULL DO UPDATE
      SET title = EXCLUDED.title,
          body = EXCLUDED.body,
          payload = EXCLUDED.payload,
          status = CASE
            WHEN notification_queue.status IN ('processed', 'failed', 'blocked') THEN 'pending'
            ELSE notification_queue.status
          END,
          push_skip_reason = NULL,
          next_retry_at = CASE
            WHEN notification_queue.status IN ('processed', 'failed', 'blocked') THEN NULL
            ELSE notification_queue.next_retry_at
          END,
          processed_at = NULL,
          updated_at = now();
  EXCEPTION WHEN OTHERS THEN
    BEGIN
      INSERT INTO public.notification_failures (order_id, seller_user_id, stage, error)
      VALUES (p_order_id, v_seller_user_id, 'enqueue', SQLERRM);
    EXCEPTION WHEN OTHERS THEN
      RAISE EXCEPTION 'enqueue_seller_new_order_notification could not record failure for order %: %', p_order_id, SQLERRM;
    END;
  END;
END;
$$;

CREATE OR REPLACE FUNCTION public.fn_enqueue_new_order_notification()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF NOT (OLD.status = 'payment_pending' AND NEW.status IN ('placed', 'preparing')) THEN
      RETURN NEW;
    END IF;
    PERFORM public.enqueue_seller_new_order_notification(NEW.id);
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.fn_enqueue_new_order_on_item()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_status public.order_status;
BEGIN
  SELECT status INTO v_status FROM public.orders WHERE id = NEW.order_id;
  IF v_status IS NULL OR v_status IN ('payment_pending', 'cancelled') THEN
    RETURN NEW;
  END IF;
  PERFORM public.enqueue_seller_new_order_notification(NEW.order_id);
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.fn_enqueue_new_order_on_insert()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.status IN ('placed', 'preparing', 'enquired', 'requested', 'quoted') THEN
    PERFORM public.enqueue_seller_new_order_notification(NEW.id);
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_enqueue_new_order_on_insert ON public.orders;

CREATE TRIGGER trg_enqueue_new_order_on_insert
  AFTER INSERT ON public.orders
  FOR EACH ROW
  EXECUTE FUNCTION public.fn_enqueue_new_order_on_insert();

CREATE OR REPLACE FUNCTION public.claim_notification_queue(_batch_size integer DEFAULT 50)
RETURNS SETOF notification_queue
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE notification_queue
  SET status = 'pending', updated_at = now()
  WHERE status = 'processing'
    AND updated_at < (now() - interval '3 minutes');

  RETURN QUERY
  UPDATE notification_queue SET status = 'processing', updated_at = now()
  WHERE id IN (
    SELECT nq.id FROM notification_queue nq
    WHERE nq.status IN ('pending', 'blocked')
      AND (nq.next_retry_at IS NULL OR nq.next_retry_at <= now())
    ORDER BY nq.created_at ASC
    LIMIT _batch_size
    FOR UPDATE SKIP LOCKED
  )
  RETURNING *;
END;
$$;

CREATE OR REPLACE FUNCTION public.fn_wakeup_notification_queue_if_pending()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  did_claim boolean := false;
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM public.notification_queue
    WHERE status IN ('pending', 'blocked')
      AND (next_retry_at IS NULL OR next_retry_at <= now())
  ) THEN
    RETURN;
  END IF;

  UPDATE public._pnq_wakeup_gate
  SET last_wakeup_at = now()
  WHERE id = 1
    AND last_wakeup_at < now() - interval '15 seconds'
  RETURNING true INTO did_claim;

  IF COALESCE(did_claim, false) THEN
    PERFORM public.fn_invoke_notification_worker('cron_pending_safety');
  END IF;
END;
$function$;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'wakeup_notification_queue_if_pending') THEN
    PERFORM cron.unschedule((SELECT jobid FROM cron.job WHERE jobname = 'wakeup_notification_queue_if_pending' LIMIT 1));
  END IF;
END $$;

SELECT cron.schedule(
  'wakeup_notification_queue_if_pending',
  '* * * * *',
  $$SELECT public.fn_wakeup_notification_queue_if_pending();$$
);
